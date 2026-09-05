-- ============================================================================
-- Voizy — 0008 RPC : appels métier (clients mobile / web / Edge Functions)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- nearby_merchants : commerçants actifs autour d'un point (PostGIS)
-- ---------------------------------------------------------------------------
create or replace function public.nearby_merchants(
  p_lat      double precision,
  p_lng      double precision,
  p_radius_m integer default 3000,
  p_limit    integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_origin geography := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
  v_max_radius integer := greatest(least(p_radius_m, 50000), 100);
begin
  return coalesce((
    select jsonb_agg(to_jsonb(s) order by s.distance_m asc)
    from (
      select m.id, m.name, m.description, m.category, m.address,
             m.lat, m.lng, m.commission_rate,
             round(st_distance(m.location, v_origin)::numeric, 0) as distance_m,
             (select count(*) from public.offers o
               where o.merchant_id = m.id and o.active) as active_offers
      from public.merchants m
      where m.status = 'active'
        and m.location is not null
        and st_dwithin(m.location, v_origin, v_max_radius)
      limit p_limit
    ) s
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- open_orders_feed : commandes groupées ouvertes autour d'un point,
-- avec commerçant + offre + progression du seuil (fil « Découvrir »).
-- ---------------------------------------------------------------------------
create or replace function public.open_orders_feed(
  p_lat      double precision,
  p_lng      double precision,
  p_radius_m integer default 3000,
  p_limit    integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_origin geography := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
  v_max_radius integer := greatest(least(p_radius_m, 50000), 100);
begin
  return coalesce((
    select jsonb_agg(to_jsonb(s) order by s.pickup_at asc)
    from (
      select o.id, o.status, o.participants_current, o.threshold, o.title,
             o.unit_label, o.base_price, o.group_price, o.deposit_amount,
             o.pickup_at, o.pickup_location, o.share_token, o.created_at,
             m.id as merchant_id, m.name as merchant_name, m.category as merchant_category,
             m.address as merchant_address,
             coalesce(nullif(trim(u.full_name), ''), 'Un voisin') as organizer_name,
             round(st_distance(m.location, v_origin)::numeric, 0) as distance_m
      from public.group_orders o
      join public.merchants m on m.id = o.merchant_id
      join public.users u on u.id = o.organizer_id
      where o.status = 'open'
        and m.status = 'active'
        and m.location is not null
        and st_dwithin(m.location, v_origin, v_max_radius)
      limit p_limit
    ) s
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- create_group_order : l'organisateur crée une commande groupée.
-- Les prix / seuil / caution / commission sont des snapshots de l'offre.
-- ---------------------------------------------------------------------------
create or replace function public.create_group_order(
  p_merchant_id      uuid,
  p_offer_id         uuid,
  p_pickup_at        timestamptz,
  p_pickup_location  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_merchant public.merchants%rowtype;
  v_offer    public.offers%rowtype;
  v_order    public.group_orders;
  v_min_hours int;
  v_max_days  int;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;

  select * into v_merchant from public.merchants where id = p_merchant_id;
  if not found then
    raise exception 'Commerçant introuvable.';
  end if;
  if v_merchant.status <> 'active' then
    raise exception 'Ce commerçant n''est pas encore actif sur Voizy.';
  end if;

  select * into v_offer from public.offers where id = p_offer_id;
  if not found or v_offer.merchant_id <> v_merchant.id then
    raise exception 'Offre introuvable pour ce commerçant.';
  end if;
  if not v_offer.active then
    raise exception 'Cette offre n''est plus disponible.';
  end if;

  select (value::int) into v_min_hours from public.app_config where key = 'order_min_duration_hours';
  select (value::int) into v_max_days  from public.app_config where key = 'order_max_duration_days';
  v_min_hours := coalesce(v_min_hours, 1);
  v_max_days  := coalesce(v_max_days, 30);

  if p_pickup_at is null or p_pickup_at < now() + make_interval(hours => v_min_hours) then
    raise exception 'La date de retrait doit être dans au moins % heure(s).', v_min_hours;
  end if;
  if p_pickup_at > now() + make_interval(days => v_max_days) then
    raise exception 'La date de retrait doit être dans au plus % jours.', v_max_days;
  end if;

  insert into public.group_orders
    (merchant_id, offer_id, organizer_id, threshold, title, unit_label,
     base_price, group_price, deposit_amount, commission_rate,
     pickup_at, pickup_location)
  values
    (v_merchant.id, v_offer.id, auth.uid(), v_offer.threshold, v_offer.title,
     v_offer.unit_label, v_offer.base_price, v_offer.group_price,
     v_offer.deposit_amount, v_merchant.commission_rate,
     p_pickup_at, coalesce(nullif(trim(p_pickup_location), ''), v_merchant.address))
  returning * into v_order;

  return jsonb_build_object('ok', true, 'order', to_jsonb(v_order));
end;
$$;

-- ---------------------------------------------------------------------------
-- join_group_order : le participant rejoint une commande ouverte.
-- ATOMIQUE : la ligne commande est verrouillée (SELECT ... FOR UPDATE) pour
-- éviter toute double validation de seuil. La participation naît en
-- « pending_payment » ; le compteur n'est incrémenté que lorsque les
-- PaymentIntents Stripe sont créés (confirm_participation).
--
-- p_user_id est passé explicitement : ces RPC sont appelées par les Edge
-- Functions avec le rôle service_role (auth.uid() y est NULL). Garde : un
-- appelant authentifié ne peut agir que pour lui-même.
-- ---------------------------------------------------------------------------
create or replace function public.join_group_order(
  p_group_order_id uuid,
  p_user_id        uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.group_orders;
  v_part  public.participations;
begin
  if p_user_id is null then
    raise exception 'Identifiant utilisateur manquant.';
  end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Accès refusé.';
  end if;

  select * into v_order
  from public.group_orders
  where id = p_group_order_id
  for update;  -- verrou : un seul participant passe le seuil à la fois

  if not found then
    raise exception 'Commande introuvable.';
  end if;

  if v_order.status <> 'open' then
    raise exception 'Cette commande n''est plus ouverte.';
  end if;
  if v_order.pickup_at <= now() then
    raise exception 'Le délai de participation est dépassé.';
  end if;
  if v_order.organizer_id = p_user_id then
    raise exception 'Vous organisez cette commande : impossible d''y participer.';
  end if;
  if exists (
    select 1 from public.participations p
    where p.group_order_id = p_group_order_id and p.user_id = p_user_id
  ) then
    raise exception 'Vous participez déjà à cette commande.';
  end if;

  insert into public.participations
    (group_order_id, user_id, amount, deposit_amount)
  values
    (p_group_order_id, p_user_id, v_order.group_price, v_order.deposit_amount)
  returning * into v_part;

  return jsonb_build_object('ok', true, 'participation', to_jsonb(v_part),
                            'order', to_jsonb(v_order));
end;
$$;

-- ---------------------------------------------------------------------------
-- confirm_participation : appelée par join-order (Edge Function) quand les
-- PaymentIntents Stripe sont créés. Incrémente le compteur de façon atomique
-- et verrouille la commande si le seuil est atteint (statut → confirmed).
-- ---------------------------------------------------------------------------
create or replace function public.confirm_participation(
  p_group_order_id uuid,
  p_user_id        uuid,
  p_product_pi     text,
  p_deposit_pi     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.group_orders;
  v_part  public.participations;
  v_threshold_reached boolean := false;
begin
  if p_user_id is null then
    raise exception 'Identifiant utilisateur manquant.';
  end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Accès refusé.';
  end if;

  select * into v_order
  from public.group_orders
  where id = p_group_order_id
  for update;

  if not found then
    raise exception 'Commande introuvable.';
  end if;

  -- Incrément du compteur AVANT la mise à jour de la participation : le
  -- trigger de notification (order_joined) lit ainsi le compteur à jour.
  update public.group_orders
     set participants_current = participants_current + 1
   where id = p_group_order_id
  returning * into v_order;

  update public.participations p
     set status = 'paid',
         product_pi_id = p_product_pi,
         deposit_pi_id = p_deposit_pi,
         deposit_status = case when p.deposit_amount > 0 then 'held' else 'pending' end
   where p.group_order_id = p_group_order_id
     and p.user_id = p_user_id
     and p.status = 'pending_payment'
  returning * into v_part;

  if not found then
    raise exception 'Participation introuvable ou déjà confirmée.';
  end if;

  -- Seuil atteint → confirmation immédiate (validation automatique).
  if v_order.participants_current >= v_order.threshold and v_order.status = 'open' then
    update public.group_orders
       set status = 'confirmed', confirmed_at = now()
     where id = p_group_order_id
    returning * into v_order;
    v_threshold_reached := true;
  end if;

  return jsonb_build_object('ok', true, 'threshold_reached', v_threshold_reached,
                            'order', to_jsonb(v_order), 'participation', to_jsonb(v_part));
end;
$$;

-- ---------------------------------------------------------------------------
-- cancel_participation : annule une participation en attente de paiement
-- (échec Stripe côté join-order). Ne touche pas le compteur (non incrémenté).
-- ---------------------------------------------------------------------------
create or replace function public.cancel_participation(
  p_group_order_id uuid,
  p_user_id        uuid,
  p_reason         text default 'payment_failed'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_part public.participations;
begin
  if p_user_id is null then
    raise exception 'Identifiant utilisateur manquant.';
  end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Accès refusé.';
  end if;

  update public.participations p
     set status = 'cancelled', cancelled_at = now()
   where p.group_order_id = p_group_order_id
     and p.user_id = p_user_id
     and p.status = 'pending_payment'
  returning * into v_part;

  if not found then
    raise exception 'Participation introuvable ou déjà traitée.';
  end if;

  return jsonb_build_object('ok', true, 'participation', to_jsonb(v_part));
end;
$$;

-- ---------------------------------------------------------------------------
-- close_expired_order : appelée par le cron close-order pour chaque commande
-- arrivée à échéance. Verrouillage atomique, puis :
--   seuil atteint → confirmed (les paiements sont capturés ensuite côté Edge)
--   sinon        → cancelled (les pré-autorisations sont annulées côté Edge)
-- ---------------------------------------------------------------------------
create or replace function public.close_expired_order(p_group_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.group_orders;
begin
  select * into v_order
  from public.group_orders
  where id = p_group_order_id
  for update;

  if not found then
    raise exception 'Commande introuvable.';
  end if;
  if v_order.status <> 'open' then
    return jsonb_build_object('ok', true, 'status', v_order.status);
  end if;
  if v_order.pickup_at > now() then
    return jsonb_build_object('ok', true, 'status', 'open', 'reason', 'not_expired');
  end if;

  if v_order.participants_current >= v_order.threshold then
    update public.group_orders
       set status = 'confirmed', confirmed_at = now()
     where id = p_group_order_id
    returning * into v_order;
    return jsonb_build_object('ok', true, 'status', 'confirmed');
  else
    update public.group_orders
       set status = 'cancelled', cancelled_at = now(),
           cancelled_reason = 'threshold_not_reached'
     where id = p_group_order_id
    returning * into v_order;
    return jsonb_build_object('ok', true, 'status', 'cancelled');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- queue_pickup_reminders : insère les notifications « rappel de retrait »
-- pour les commandes confirmées dont le créneau approche (cron close-order).
-- Dédupliqué : jamais deux rappels pour la même (commande, utilisateur).
-- ---------------------------------------------------------------------------
create or replace function public.queue_pickup_reminders()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hours_before int;
  v_count int := 0;
begin
  select (value::int) into v_hours_before
  from public.app_config where key = 'pickup_reminder_hours_before';
  v_hours_before := coalesce(v_hours_before, 3);

  with target_orders as (
    select o.id, o.pickup_at, o.merchant_id, o.organizer_id,
           m.name as merchant_name
    from public.group_orders o
    join public.merchants m on m.id = o.merchant_id
    where o.status = 'confirmed'
      and o.pickup_at between now() and now() + make_interval(hours => v_hours_before)
  ),
  recipients as (
    select distinct t.id as order_id, t.pickup_at, t.merchant_name,
           u.id as user_id, u.full_name
    from target_orders t
    join lateral (
      select user_id from public.participations p
      where p.group_order_id = t.id and p.status = 'paid'
      union
      select t.organizer_id
    ) u on true
    where not exists (
      select 1 from public.notifications n
      where n.type = 'pickup_reminder'
        and n.payload ->> 'group_order_id' = t.id::text
        and n.user_id = u.id
    )
  )
  insert into public.notifications (user_id, type, payload)
  select r.user_id, 'pickup_reminder',
         jsonb_build_object(
           'group_order_id', r.order_id,
           'merchant_name', r.merchant_name,
           'pickup_at', r.pickup_at
         )
  from recipients r;

  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', true, 'reminders', v_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- set_notifications_read : marque des notifications comme lues.
-- ---------------------------------------------------------------------------
create or replace function public.set_notifications_read(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.notifications
     set read = true
   where id = any(p_ids)
     and user_id = auth.uid();
  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', true, 'count', v_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- merchant_stats : statistiques du back-office commerçant
-- ---------------------------------------------------------------------------
create or replace function public.merchant_stats(p_merchant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_total_orders       int;
  v_confirmed_orders   int;
  v_cancelled_orders   int;
  v_open_orders        int;
  v_revenue            numeric(12, 2);
  v_unique_participants int;
  v_avg_fill           numeric(4, 2);
begin
  select count(*),
         count(*) filter (where status in ('confirmed', 'completed')),
         count(*) filter (where status = 'cancelled'),
         count(*) filter (where status = 'open')
    into v_total_orders, v_confirmed_orders, v_cancelled_orders, v_open_orders
  from public.group_orders
  where merchant_id = p_merchant_id;

  select coalesce(sum(p.amount), 0)
    into v_revenue
  from public.participations p
  join public.group_orders o on o.id = p.group_order_id
  where o.merchant_id = p_merchant_id
    and p.status in ('paid', 'completed', 'no_show');

  select count(distinct p.user_id)
    into v_unique_participants
  from public.participations p
  join public.group_orders o on o.id = p.group_order_id
  where o.merchant_id = p_merchant_id
    and p.status in ('paid', 'completed', 'no_show');

  select round(avg(participants_current::numeric / threshold::numeric), 2)
    into v_avg_fill
  from public.group_orders
  where merchant_id = p_merchant_id
    and status in ('confirmed', 'completed');

  return jsonb_build_object(
    'total_orders',        coalesce(v_total_orders, 0),
    'confirmed_orders',    coalesce(v_confirmed_orders, 0),
    'cancelled_orders',    coalesce(v_cancelled_orders, 0),
    'open_orders',         coalesce(v_open_orders, 0),
    'threshold_rate',      case when v_total_orders > 0
                                then round((v_confirmed_orders + 0.0) / v_total_orders * 100)
                                else 0
                           end,
    'revenue',             coalesce(v_revenue, 0),
    'unique_participants', coalesce(v_unique_participants, 0),
    'avg_fill',            coalesce(v_avg_fill, 0)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant execute on function public.nearby_merchants(double precision, double precision, integer, integer) to authenticated;
grant execute on function public.open_orders_feed(double precision, double precision, integer, integer) to authenticated;
grant execute on function public.create_group_order(uuid, uuid, timestamptz, text) to authenticated;
grant execute on function public.join_group_order(uuid, uuid) to authenticated;
grant execute on function public.confirm_participation(uuid, uuid, text, text) to authenticated;
grant execute on function public.cancel_participation(uuid, uuid, text) to authenticated;
grant execute on function public.close_expired_order(uuid) to service_role;
grant execute on function public.queue_pickup_reminders() to service_role;
grant execute on function public.set_notifications_read(uuid[]) to authenticated;
grant execute on function public.merchant_stats(uuid) to authenticated;