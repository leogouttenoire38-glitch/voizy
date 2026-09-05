-- ============================================================================
-- Voizy — 0009 Triggers : notifications (in-app) générées par la base
--
-- Les triggers créent des lignes notifications (in-app). L'envoi push est
-- fait par l'Edge Function planifiée dispatch-notifications (sent_at est null).
-- ============================================================================

create or replace function public.insert_notification(
  p_user_id uuid,
  p_type    text,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, payload)
  values (p_user_id, p_type, coalesce(p_payload, '{}'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Quelqu'un a rejoint (paiement confirmé) → notifier l'organisateur
-- ---------------------------------------------------------------------------
create or replace function public.notify_order_joined()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order      public.group_orders;
  v_participant_name text;
begin
  if new.status <> 'paid' or old.status = 'paid' then
    return new;
  end if;

  select * into v_order from public.group_orders where id = new.group_order_id;

  select coalesce(nullif(trim(full_name), ''), 'Un voisin') into v_participant_name
  from public.users where id = new.user_id;

  perform public.insert_notification(
    v_order.organizer_id,
    'order_joined',
    jsonb_build_object(
      'group_order_id', v_order.id,
      'title', v_order.title,
      'actor_id', new.user_id,
      'actor_name', v_participant_name,
      'participants_current', v_order.participants_current,
      'threshold', v_order.threshold
    )
  );
  return new;
end;
$$;

drop trigger if exists participations_notify_joined on public.participations;
create trigger participations_notify_joined
  after update of status on public.participations
  for each row execute function public.notify_order_joined();

-- ---------------------------------------------------------------------------
-- Statut de commande → notifications aux participants + organisateur
-- ---------------------------------------------------------------------------
create or replace function public.notify_order_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_merchant_name text;
  v_recipients uuid[];
  v_uid uuid;
begin
  select coalesce(nullif(trim(name), ''), 'Le commerçant') into v_merchant_name
  from public.merchants where id = new.merchant_id;

  -- confirmed : seuil atteint → tout le monde est prévenu
  if new.status = 'confirmed' and old.status <> 'confirmed' then
    select array_agg(distinct user_id) into v_recipients
    from public.participations
    where group_order_id = new.id and status in ('paid', 'completed', 'no_show');

    v_recipients := array_append(coalesce(v_recipients, '{}'), new.organizer_id);

    foreach v_uid in array coalesce(v_recipients, '{}') loop
      perform public.insert_notification(
        v_uid, 'order_confirmed',
        jsonb_build_object(
          'group_order_id', new.id,
          'title', new.title,
          'merchant_name', v_merchant_name,
          'pickup_at', new.pickup_at,
          'pickup_location', new.pickup_location,
          'participants_current', new.participants_current,
          'threshold', new.threshold
        )
      );
    end loop;
  end if;

  -- cancelled : seuil non atteint → participants prévenus (rien n'est débité)
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    select array_agg(distinct user_id) into v_recipients
    from public.participations
    where group_order_id = new.id and status in ('paid', 'completed', 'no_show');

    v_recipients := array_append(coalesce(v_recipients, '{}'), new.organizer_id);

    foreach v_uid in array coalesce(v_recipients, '{}') loop
      perform public.insert_notification(
        v_uid, 'order_cancelled',
        jsonb_build_object(
          'group_order_id', new.id,
          'title', new.title,
          'merchant_name', v_merchant_name
        )
      );
    end loop;
  end if;

  -- completed : tout le monde a récupéré sa commande
  if new.status = 'completed' and old.status <> 'completed' then
    select array_agg(distinct user_id) into v_recipients
    from public.participations
    where group_order_id = new.id;

    v_recipients := array_append(coalesce(v_recipients, '{}'), new.organizer_id);

    foreach v_uid in array coalesce(v_recipients, '{}') loop
      perform public.insert_notification(
        v_uid, 'order_completed',
        jsonb_build_object(
          'group_order_id', new.id,
          'title', new.title,
          'merchant_name', v_merchant_name
        )
      );
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists group_orders_notify_status on public.group_orders;
create trigger group_orders_notify_status
  after update of status on public.group_orders
  for each row execute function public.notify_order_status();