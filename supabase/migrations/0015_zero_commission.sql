-- ============================================================================
-- Voizy — 0015 Zéro commission sur les ventes + abonnement commerçant
--                                                              (sept. 2026)
--
-- BASCULE DÉFINITIVE DU MODÈLE ÉCONOMIQUE — à lire avant toute modification :
--
--   * Voizy ne prélève JAMAIS de pourcentage sur les ventes. Le commerçant
--     reçoit 100 % du prix produit, moins les SEULS frais de traitement Stripe
--     (au coût réel, sans marge Voizy) — exactement comme avec un terminal
--     bancaire classique. La commission est 0 %, définitivement : ce n'est pas
--     un taux par défaut que l'on pourrait remonter.
--   * Voizy se rémunère par un ABONNEMENT mensuel du commerçant (Stripe
--     Billing, facturé sur sa propre carte, hors flux marketplace) :
--       - palier « free »  : 1 commande groupée active à la fois ;
--       - palier « pro »   : commandes illimitées + mis en avant dans Découvrir.
--   * `billing_enabled` (app_config) = false pendant la phase pilote : tous les
--     commerçants sont traités comme « pro » gratuitement (aucune limite,
--     aucune facturation réelle) — l'infrastructure est prête et s'active en
--     changeant ce seul réglage (voir README).
--
-- Les colonnes commission_rate / commission_amount sont CONSERVÉES : elles
-- servent la compta historique du pilote (commandes d'avant la bascule). Toute
-- ligne créée après cette migration a commission_rate = 0 et
-- commission_amount = 0.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Commission sur les ventes : 0 %, définitivement
-- ---------------------------------------------------------------------------
update public.app_config
   set value = jsonb '0', updated_at = now()
 where key = 'commission_default';

alter table public.merchants    alter column commission_rate set default 0;
alter table public.group_orders alter column commission_rate set default 0;

-- Les commerçants encore au taux pilote (5 %) passent à 0. Les taux étant des
-- snapshots, les commandes déjà créées gardent le leur (traçage historique).
update public.merchants set commission_rate = 0 where commission_rate <> 0;

comment on column public.merchants.commission_rate is
  'Commission Voizy — TOUJOURS 0 : Voizy ne prend jamais de pourcentage sur les ventes. Colonne conservée pour la compta historique du pilote (5 %).';
comment on column public.group_orders.commission_rate is
  'Snapshot de merchants.commission_rate — TOUJOURS 0 pour les commandes créées après la migration 0015.';
comment on column public.transactions.commission_amount is
  'Commission Voizy prélevée : TOUJOURS 0 (jamais de pourcentage sur les ventes). Colonne conservée pour la compta historique du pilote.';

-- ---------------------------------------------------------------------------
-- 2. merchant_plan : abonnement commerçant (Stripe Billing, hors Connect)
--    Voizy facture directement le commerçant, séparément du flux marketplace.
-- ---------------------------------------------------------------------------
create table if not exists public.merchant_plan (
  merchant_id            uuid primary key references public.merchants (id) on delete cascade,
  plan                   text not null default 'free' check (plan in ('free', 'pro')),
  status                 text not null default 'inactive'
                         check (status in ('inactive', 'active', 'past_due', 'canceled')),
  stripe_customer_id     text,                -- customer de facturation (compte Voizy, PAS Connect)
  stripe_subscription_id text,
  current_period_end     timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table public.merchant_plan is
  'Palier d''abonnement du commerçant. Voizy se rémunère UNIQUEMENT ici (jamais sur les transactions). free = 1 commande active / pro = illimité + mis en avant.';
comment on column public.merchant_plan.status is
  'inactive (jamais abonné) | active | past_due (grâce) | canceled. Seuls plan=pro + status active/past_due donnent la priorité.';

create unique index if not exists merchant_plan_subscription_idx
  on public.merchant_plan (stripe_subscription_id)
  where stripe_subscription_id is not null;

create trigger merchant_plan_set_updated_at
  before update on public.merchant_plan
  for each row execute function public.set_updated_at();

alter table public.merchant_plan enable row level security;

-- Lecture : le gestionnaire du commerce (back-office). Aucune policy d'écriture
-- → toutes les mutations passent par les Edge Functions (service_role).
drop policy if exists "merchant_plan_select_manager" on public.merchant_plan;
create policy "merchant_plan_select_manager" on public.merchant_plan
  for select to authenticated
  using (exists (
    select 1 from public.merchants m
    where m.id = merchant_plan.merchant_id and m.manager_id = auth.uid()
  ));

-- Tout commerçant existant démarre au palier gratuit (jamais abonné).
insert into public.merchant_plan (merchant_id)
select m.id from public.merchants m
on conflict (merchant_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Réglages : facturation désactivée (phase pilote) + tarif du palier pro
-- ---------------------------------------------------------------------------
insert into public.app_config (key, value) values
  ('billing_enabled',    jsonb 'false'),  -- false : tous « pro » gratuitement, aucune facturation
  ('pro_plan_price_eur', jsonb '29')      -- tarif mensuel affiché/estimé du palier pro
on conflict (key) do nothing;

comment on table public.app_config is
  'Réglages métier sans migration. billing_enabled=false (pilote) : pas de limite ni de facturation, tous les commerçants traités comme pro.';

-- ---------------------------------------------------------------------------
-- 4. Helpers paliers
-- ---------------------------------------------------------------------------

-- billing_enabled : la facturation est-elle active ? (false pendant le pilote)
create or replace function public.billing_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select value::boolean from public.app_config where key = 'billing_enabled'),
    false
  );
$$;

-- merchant_plan_is_pro : le commerçant a-t-il un abonnement pro en cours ?
-- (abonnements en retard tolérés quelques jours : status = past_due)
create or replace function public.merchant_plan_is_pro(p_merchant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.merchant_plan mp
    where mp.merchant_id = p_merchant_id
      and mp.plan = 'pro'
      and mp.status in ('active', 'past_due')
  );
$$;

grant execute on function public.billing_enabled() to authenticated, service_role;
grant execute on function public.merchant_plan_is_pro(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. nearby_merchants : commerçants pro mis en avant (tri) + badge is_pro
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
    select jsonb_agg(to_jsonb(s))
    from (
      select m.id, m.name, m.description, m.category, m.address,
             m.lat, m.lng, m.commission_rate,
             round(st_distance(m.location, v_origin)::numeric, 0) as distance_m,
             (select count(*) from public.offers o
               where o.merchant_id = m.id and o.active) as active_offers,
             -- Badge « mis en avant » : abonnement pro en cours. Pendant le
             -- pilote (billing_enabled = false) personne n'est pro — donc tri
             -- par distance, sans mise en avant artificielle.
             public.merchant_plan_is_pro(m.id) as is_pro
      from public.merchants m
      where m.status = 'active'
        and m.location is not null
        and st_dwithin(m.location, v_origin, v_max_radius)
      -- Les commerçants pro passent devant, à distance comparable.
      order by public.merchant_plan_is_pro(m.id) desc, distance_m asc
      limit p_limit
    ) s
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. open_orders_feed : commandes des commerçants pro mises en avant
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
    select jsonb_agg(to_jsonb(s))
    from (
      select o.id, o.status, o.participants_current, o.threshold, o.title,
             o.unit_label, o.base_price, o.group_price, o.deposit_amount,
             o.pickup_at, o.pickup_location, o.share_token, o.created_at,
             m.id as merchant_id, m.name as merchant_name, m.category as merchant_category,
             m.address as merchant_address,
             coalesce(nullif(trim(u.full_name), ''), 'Un voisin') as organizer_name,
             round(st_distance(m.location, v_origin)::numeric, 0) as distance_m,
             public.merchant_plan_is_pro(m.id) as merchant_is_pro
      from public.group_orders o
      join public.merchants m on m.id = o.merchant_id
      join public.users u on u.id = o.organizer_id
      where o.status = 'open'
        and m.status = 'active'
        and m.location is not null
        and st_dwithin(m.location, v_origin, v_max_radius)
      -- Mise en avant des commerçants pro, puis retrait le plus proche.
      order by public.merchant_plan_is_pro(m.id) desc, o.pickup_at asc
      limit p_limit
    ) s
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. create_group_order : palier gratuit = 1 commande active à la fois
--    (la limite ne s'applique QUE si la facturation est activée ; pendant le
--    pilote, billing_enabled = false → tout le monde est traité comme pro)
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
  v_billing_enabled boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.';
  end if;

  -- Verrou sur le commerçant : deux créations simultanées ne peuvent pas
  -- franchir la limite du palier gratuit toutes les deux.
  select * into v_merchant from public.merchants where id = p_merchant_id for update;
  if not found then
    raise exception 'Commerçant introuvable.';
  end if;
  if v_merchant.status <> 'active' then
    raise exception 'Ce commerçant n''est pas encore actif sur Voizy.';
  end if;

  -- Palier « free » : une seule commande groupée active à la fois. Voizy se
  -- rémunère par abonnement (jamais par commission) : la limite est le levier
  -- du palier pro. Désactivée tant que billing_enabled = false (pilote).
  v_billing_enabled := public.billing_enabled();
  if v_billing_enabled and not public.merchant_plan_is_pro(v_merchant.id) then
    if exists (
      select 1 from public.group_orders o
      where o.merchant_id = v_merchant.id and o.status = 'open'
    ) then
      raise exception
        'Palier gratuit : une seule commande active à la fois. Terminez la commande en cours ou passez au plan Pro pour des commandes illimitées.';
    end if;
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
     v_offer.deposit_amount, v_merchant.commission_rate,  -- TOUJOURS 0 (voir 0015)
     p_pickup_at, coalesce(nullif(trim(p_pickup_location), ''), v_merchant.address))
  returning * into v_order;

  return jsonb_build_object('ok', true, 'order', to_jsonb(v_order));
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Compta : le revenu transactionnel est nul PAR DESIGN ; le revenu Voizy
--    vient des abonnements (colonnes séparées).
-- ---------------------------------------------------------------------------
drop view if exists public.v_voizy_revenue_monthly;
create view public.v_voizy_revenue_monthly as
with months as (
  select distinct date_trunc('month', t.created_at)::date as month
    from public.transactions t
   where t.type = 'product_payment'
  union
  select distinct date_trunc('month', coalesce(mp.current_period_end, mp.updated_at))::date as month
    from public.merchant_plan mp
   where mp.plan = 'pro'
),
tx as (
  select date_trunc('month', t.created_at)::date as month,
         count(*)                              as transactions,
         coalesce(sum(t.gross_amount), 0)      as volume,
         coalesce(sum(t.net_transfer), 0)      as net_merchants,
         coalesce(sum(t.stripe_fee_estimated), 0) as fees_estimated,
         coalesce(sum(t.stripe_fee_real), 0)   as fees_real,
         coalesce(sum(t.commission_amount), 0) as commission_history
    from public.transactions t
   where t.type = 'product_payment'
   group by 1
),
subs as (
  select date_trunc('month', coalesce(mp.current_period_end, mp.updated_at))::date as month,
         count(*) as merchants,
         count(*) * coalesce(
           (select (value::numeric) from public.app_config where key = 'pro_plan_price_eur'),
           0
         ) as revenue
    from public.merchant_plan mp
   where mp.plan = 'pro'
     and mp.status in ('active', 'past_due')
   group by 1
)
select mo.month,
       coalesce(tx.transactions, 0)          as transactions,
       coalesce(tx.volume, 0)                as volume,
       -- 0 % : Voizy ne prélève JAMAIS de pourcentage sur les ventes. Cette
       -- colonne vaut 0 pour toute la période post-bascule ; elle n'est non
       -- nulle que pour les mois du pilote, à l'ancien modèle (5 %).
       coalesce(tx.commission_history, 0)    as commission,
       coalesce(tx.fees_estimated, 0)        as fees_estimated,
       coalesce(tx.fees_real, 0)             as fees_real,
       coalesce(tx.net_merchants, 0)         as net_merchants,
       coalesce(s.merchants, 0)              as subscription_merchants,
       coalesce(s.revenue, 0)                as subscription_revenue,
       -- Revenu Voizy = abonnements UNIQUEMENT (+ commission historique du
       -- pilote). Les frais Stripe ne sont jamais supportés par Voizy : ils
       -- sont retenus sur le transfert du commerçant.
       coalesce(s.revenue, 0) + coalesce(tx.commission_history, 0) as voizy_net
  from months mo
  left join tx   on tx.month = mo.month
  left join subs s on s.month = mo.month
 order by mo.month desc;

grant select on public.v_voizy_transaction_breakdown to service_role;
grant select on public.v_voizy_revenue_monthly      to service_role;

-- ---------------------------------------------------------------------------
-- 9. RPC back-office : transparence « 0 % » + état de l'abonnement
-- ---------------------------------------------------------------------------
create or replace function public.merchant_commission_summary(p_merchant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_volume numeric(12, 2);
  v_commission numeric(12, 2);
  v_fees numeric(12, 2);
  v_fees_real numeric(12, 2);
  v_net numeric(12, 2);
  v_n int;
  v_plan text;
  v_status text;
  v_period_end timestamptz;
begin
  select coalesce(sum(t.gross_amount), 0),
         coalesce(sum(t.commission_amount), 0),
         coalesce(sum(t.stripe_fee_estimated), 0),
         coalesce(sum(t.stripe_fee_real), 0),
         coalesce(sum(t.net_transfer), 0),
         count(*)
    into v_volume, v_commission, v_fees, v_fees_real, v_net, v_n
  from public.transactions t
  join public.participations p on p.id = t.participation_id
  join public.group_orders o   on o.id = p.group_order_id
 where o.merchant_id = p_merchant_id
   and t.type = 'product_payment'
   and t.created_at >= date_trunc('month', now());

  select mp.plan, mp.status, mp.current_period_end
    into v_plan, v_status, v_period_end
  from public.merchant_plan mp
  where mp.merchant_id = p_merchant_id;

  return jsonb_build_object(
    'current_month', jsonb_build_object(
      'volume',         v_volume,
      'commission',     v_commission,   -- 0 : jamais de pourcentage sur les ventes
      'fees_estimated', v_fees,
      'fees_real',      v_fees_real,
      'net',            v_net,
      'transactions',   v_n
    ),
    -- Transparence affichée au commerçant : le taux est TOUJOURS 0.
    'commission_rate_percent', 0,
    'policy', 'Voizy ne prend jamais de pourcentage sur les ventes — 0 %, pour toujours.',
    'billing', jsonb_build_object(
      'enabled',            public.billing_enabled(),
      'plan',               coalesce(v_plan, 'free'),
      'status',             coalesce(v_status, 'inactive'),
      'is_pro',             public.merchant_plan_is_pro(p_merchant_id),
      'current_period_end', v_period_end,
      'pro_price_eur',
        (select (value::numeric) from public.app_config where key = 'pro_plan_price_eur')
    )
  );
end;
$$;

grant execute on function public.merchant_commission_summary(uuid) to authenticated, service_role;
