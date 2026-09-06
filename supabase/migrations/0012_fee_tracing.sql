-- ============================================================================
-- Voizy — 0012 Traçage commission & frais par transaction (sept. 2026)
--
-- Depuis l'abandon d'application_fee_amount (mutuellement exclusif avec
-- transfer_data[amount]), la commission Voizy et les frais Stripe ne sont plus
-- portés par Stripe : ils sont nets du transfert au commerçant. Pour la compta
-- et la transparence, chaque paiement produit capturé est désormais tracé en
-- base avec sa décomposition :
--   gross_amount         = montant brut payé par le client
--   commission_amount    = commission Voizy (snapshot group_orders.commission_rate)
--   stripe_fee_estimated = frais Stripe estimés (1,5 % + 0,25 €) retenus sur le
--                          transfert (égaux à ceux calculés par join-order)
--   stripe_fee_real      = frais réellement facturés par Stripe (lu sur le
--                          balance_transaction ; NULL si indisponible)
--   net_transfer         = montant net transféré au commerçant
--                          (= gross − commission − fee_estimated, miroir de
--                          transfer_data.amount côté Stripe)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Colonnes de décomposition sur transactions (nullable : seules les lignes
--    product_payment sont ventilées ; caution/release gardent amount signé).
-- ---------------------------------------------------------------------------
alter table public.transactions
  add column if not exists gross_amount         numeric(10, 2),
  add column if not exists commission_amount    numeric(10, 2),
  add column if not exists stripe_fee_estimated numeric(10, 2),
  add column if not exists stripe_fee_real      numeric(10, 2),
  add column if not exists net_transfer         numeric(10, 2);

comment on column public.transactions.gross_amount is
  'Montant brut payé par le client (paiements produit capturés).';
comment on column public.transactions.commission_amount is
  'Commission Voizy prélevée (snapshot group_orders.commission_rate).';
comment on column public.transactions.stripe_fee_estimated is
  'Frais Stripe estimés (1,5 % + 0,25 €) retenus sur le transfert commerçant.';
comment on column public.transactions.stripe_fee_real is
  'Frais Stripe réellement facturés (balance_transaction) — NULL si indispo.';
comment on column public.transactions.net_transfer is
  'Net transféré au commerçant = gross − commission − frais estimés.';

-- Rétro-remplissage des paiements capturés avant cette migration (mêmes
-- règles de calcul que join-order / settle).
update public.transactions t
   set gross_amount         = t.amount,
       commission_amount    = round(t.amount * 100 * o.commission_rate) / 100,
       stripe_fee_estimated = (floor(t.amount * 100 * 0.015) + 25) / 100,
       net_transfer         = t.amount
                              - round(t.amount * 100 * o.commission_rate) / 100
                              - (floor(t.amount * 100 * 0.015) + 25) / 100
  from public.participations p
  join public.group_orders o on o.id = p.group_order_id
 where t.participation_id = p.id
   and t.type = 'product_payment'
   and t.gross_amount is null;

-- ---------------------------------------------------------------------------
-- 2. Vues compta (réservées au service_role / éditeur SQL — PAS de grant aux
--    clients : le revenu Voizy agrégé est interne).
-- ---------------------------------------------------------------------------
drop view if exists public.v_voizy_transaction_breakdown;
create view public.v_voizy_transaction_breakdown as
select t.id,
       t.created_at,
       t.type,
       t.amount,
       t.gross_amount,
       t.commission_amount,
       t.stripe_fee_estimated,
       t.stripe_fee_real,
       t.net_transfer,
       p.group_order_id,
       o.merchant_id,
       m.name as merchant_name,
       o.title as order_title
  from public.transactions t
  join public.participations p on p.id = t.participation_id
  join public.group_orders o   on o.id = p.group_order_id
  left join public.merchants m on m.id = o.merchant_id
 where t.type = 'product_payment';

drop view if exists public.v_voizy_revenue_monthly;
create view public.v_voizy_revenue_monthly as
select date_trunc('month', created_at)::date as month,
       count(*)                             as transactions,
       coalesce(sum(gross_amount), 0)        as volume,
       coalesce(sum(commission_amount), 0)   as commission,
       coalesce(sum(stripe_fee_estimated), 0) as fees_estimated,
       coalesce(sum(stripe_fee_real), 0)     as fees_real,
       coalesce(sum(net_transfer), 0)        as net_merchants,
       -- Marge Voizy ≈ commission − frais Stripe réels (en test mode, pas de
       -- frais réels : fees_real = 0 → marge = commission).
       coalesce(sum(commission_amount), 0)
         - coalesce(sum(stripe_fee_real), 0) as voizy_net
  from public.transactions
 where type = 'product_payment'
 group by 1
 order by 1 desc;

grant select on public.v_voizy_transaction_breakdown to service_role;
grant select on public.v_voizy_revenue_monthly      to service_role;

-- ---------------------------------------------------------------------------
-- 3. RPC commerçant : décomposition du mois en cours + cumul (transparence
--    back-office : ce que Voizy prélève, ce qui est reversé après frais).
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
  v_net numeric(12, 2);
  v_n int;
begin
  select coalesce(sum(gross_amount), 0),
         coalesce(sum(commission_amount), 0),
         coalesce(sum(stripe_fee_estimated), 0),
         coalesce(sum(net_transfer), 0),
         count(*)
    into v_volume, v_commission, v_fees, v_net, v_n
  from public.transactions t
  join public.participations p on p.id = t.participation_id
  join public.group_orders o   on o.id = p.group_order_id
 where o.merchant_id = p_merchant_id
   and t.type = 'product_payment'
   and t.created_at >= date_trunc('month', now());

  return jsonb_build_object(
    'current_month', jsonb_build_object(
      'volume',        v_volume,
      'commission',    v_commission,
      'fees_estimated', v_fees,
      'net',           v_net,
      'transactions',  v_n
    )
  );
end;
$$;

grant execute on function public.merchant_commission_summary(uuid) to authenticated;