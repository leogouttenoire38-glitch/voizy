-- ============================================================================
-- Voizy — 0006 participations + transactions
-- Une participation naît « pending_payment » (RPC join_group_order), devient
-- « paid » quand les deux PaymentIntents Stripe (produit + caution) sont créés
-- (confirm_participation), puis « completed » (retrait) ou « no_show ».
-- ============================================================================

create table if not exists public.participations (
  id                 uuid primary key default gen_random_uuid(),
  group_order_id     uuid not null references public.group_orders (id) on delete cascade,
  user_id            uuid not null references public.users (id),
  status             text not null default 'pending_payment'
                     check (status in ('pending_payment', 'paid',
                                       'completed', 'no_show', 'cancelled')),
  amount             numeric(10, 2) not null check (amount > 0),
  deposit_amount     numeric(10, 2) not null default 0 check (deposit_amount >= 0),
  deposit_status     text not null default 'pending'
                     check (deposit_status in ('pending', 'held', 'released',
                                               'captured', 'failed')),
  product_pi_id      text,          -- PaymentIntent produit (capture manuelle)
  deposit_pi_id      text,          -- PaymentIntent caution  (capture manuelle)
  product_captured_at timestamptz,
  picked_up_at       timestamptz,
  cancelled_at       timestamptz,
  created_at         timestamptz not null default now(),
  unique (group_order_id, user_id)
);

create index if not exists participations_order_idx on public.participations (group_order_id, status);
create index if not exists participations_user_idx  on public.participations (user_id, created_at desc);

alter table public.participations enable row level security;

-- Lecture : sa propre participation, ou celle d'une commande qu'on organise /
-- dont on est le commerçant gestionnaire.
drop policy if exists "participations_select_visible" on public.participations;
create policy "participations_select_visible" on public.participations
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.group_orders o
      where o.id = participations.group_order_id
        and (o.organizer_id = auth.uid()
             or exists (
               select 1 from public.merchants m
               where m.id = o.merchant_id and m.manager_id = auth.uid()
             ))
    )
  );

-- Mutations : uniquement via RPC et Edge Functions (service_role).

-- ---------------------------------------------------------------------------
-- group_orders : policy de lecture complète (dépend de participations)
-- ---------------------------------------------------------------------------
drop policy if exists "group_orders_select_visible" on public.group_orders;
create policy "group_orders_select_visible" on public.group_orders
  for select to authenticated
  using (
    status = 'open'
    or organizer_id = auth.uid()
    or exists (
      select 1 from public.merchants m
      where m.id = group_orders.merchant_id and m.manager_id = auth.uid()
    )
    or exists (
      select 1 from public.participations p
      where p.group_order_id = group_orders.id and p.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- transactions : journal des mouvements (paiement, caution, remboursement)
-- amount est SIGNÉ du point de vue de user_id : positif = débit, négatif = crédit.
-- ---------------------------------------------------------------------------
create table if not exists public.transactions (
  id               uuid primary key default gen_random_uuid(),
  participation_id uuid references public.participations (id) on delete set null,
  user_id          uuid not null references public.users (id),
  type             text not null
                   check (type in ('product_payment', 'product_release',
                                   'deposit_hold', 'deposit_release', 'deposit_capture')),
  amount           numeric(10, 2) not null,
  stripe_ref       text,
  status           text not null default 'pending'
                   check (status in ('pending', 'succeeded', 'failed', 'refunded')),
  created_at       timestamptz not null default now()
);

create index if not exists transactions_user_idx on public.transactions (user_id, created_at desc);
create index if not exists transactions_part_idx on public.transactions (participation_id);

alter table public.transactions enable row level security;

drop policy if exists "transactions_select_own" on public.transactions;
create policy "transactions_select_own" on public.transactions
  for select using (auth.uid() = user_id);
-- Insertions : uniquement serveur (Edge Functions avec service_role).