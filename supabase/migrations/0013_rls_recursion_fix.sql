-- ============================================================================
-- Voizy — 0013 correctif : récursion infinie des policies RLS
--
-- PROBLÈME (bug de production « infinite recursion detected in policy for
-- relation group_orders ») :
--   * policy group_orders_select_visible   → sous-requête EXISTS sur participations
--   * policy participations_select_visible → sous-requête EXISTS sur group_orders
--   Les sous-requêtes d'une policy sont elles-mêmes soumises au RLS des tables
--   qu'elles lisent : évaluer l'une demande d'évaluer l'autre, indéfiniment.
--   Postgres détecte la boucle au planning et rejette TOUTE lecture de
--   group_orders et participations côté client (même les commandes « open »),
--   ce qui bloquait l'écran « Découvrir », le détail de commande et donc
--   l'accès au paiement.
--
-- CORRECTIF : les vérifications croisées passent par des fonctions
--   SECURITY DEFINER (mêmes propriétaires que les tables → RLS contourné),
--   sur le modèle des RPC de feed (open_orders_feed / nearby_merchants).
--   Les policies ne référencent plus jamais l'autre table directement :
--   le cycle est cassé, la lecture redevient légitime pour qui de droit.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helpers d'autorisation (SECURITY DEFINER : contournent le RLS, pas de boucle)
-- ---------------------------------------------------------------------------

-- L'utilisateur courant est-il participant de cette commande ?
create or replace function public.is_order_participant(p_group_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.participations p
    where p.group_order_id = p_group_order_id
      and p.user_id = auth.uid()
  );
$$;

-- L'utilisateur courant organise-t-il cette commande ?
create or replace function public.is_order_organizer(p_group_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_orders o
    where o.id = p_group_order_id
      and o.organizer_id = auth.uid()
  );
$$;

-- L'utilisateur courant est-il le gestionnaire (back-office) du commerçant
-- de cette commande ?
create or replace function public.is_order_manager(p_group_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_orders o
    join public.merchants m on m.id = o.merchant_id
    where o.id = p_group_order_id
      and m.manager_id = auth.uid()
  );
$$;

revoke all on function public.is_order_participant(uuid) from public, anon;
revoke all on function public.is_order_organizer(uuid) from public, anon;
revoke all on function public.is_order_manager(uuid) from public, anon;
grant execute on function public.is_order_participant(uuid) to authenticated;
grant execute on function public.is_order_organizer(uuid) to authenticated;
grant execute on function public.is_order_manager(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- group_orders : plus aucune référence directe à participations
-- ---------------------------------------------------------------------------
drop policy if exists "group_orders_select_visible" on public.group_orders;
create policy "group_orders_select_visible" on public.group_orders
  for select to authenticated
  using (
    status = 'open'
    or organizer_id = auth.uid()
    or public.is_order_manager(id)
    or public.is_order_participant(id)
  );

-- ---------------------------------------------------------------------------
-- participations : plus aucune référence directe à group_orders
-- ---------------------------------------------------------------------------
drop policy if exists "participations_select_visible" on public.participations;
create policy "participations_select_visible" on public.participations
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_order_organizer(group_order_id)
    or public.is_order_manager(group_order_id)
  );
