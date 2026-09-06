-- ============================================================================
-- Voizy — 0011 Modèle économique (sept. 2026)
--  1. Commission par défaut : 3 % → 5 %.
--  2. Frais de traitement Stripe à la charge du commerçant (mécanique côté
--     Edge Functions : `transfer_data.amount` = montant − commission − frais).
-- ============================================================================

-- Réglage global par défaut.
update public.app_config
   set value = jsonb '0.05', updated_at = now()
 where key = 'commission_default';

-- Nouveaux commerçants / nouvelles commandes : 5 % par défaut.
alter table public.merchants   alter column commission_rate set default 0.05;
alter table public.group_orders alter column commission_rate set default 0.05;

-- Commerçants encore au taux par défaut 3 % → 5 %. Les snapshots des
-- commandes déjà créées restent figés (principe des snapshots) : seules les
-- nouvelles commandes héritent du nouveau taux via create_group_order.
update public.merchants
   set commission_rate = 0.05
 where commission_rate = 0.03;