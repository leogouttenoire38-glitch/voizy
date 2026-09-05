-- ============================================================================
-- Voizy — 0004 offers (offres éligibles au group buying + palier)
-- Restriction V1 : produits secs / épicerie / fruits & légumes non périssables.
-- ============================================================================

create table if not exists public.offers (
  id              uuid primary key default gen_random_uuid(),
  merchant_id     uuid not null references public.merchants (id) on delete cascade,
  title           text not null check (char_length(title) between 2 and 120),
  description     text check (char_length(description) <= 2000),
  unit_label      text not null default 'unité' check (char_length(unit_label) <= 40),
  base_price      numeric(10, 2) not null check (base_price > 0),
  group_price     numeric(10, 2) not null check (group_price > 0),
  -- Prix groupé inférieur ou égal au prix normal.
  check (group_price <= base_price),
  -- Seuil de participants requis pour débloquer le tarif groupé.
  threshold       integer not null check (threshold between 2 and 100),
  -- Caution remboursable (pré-autorisation, jamais débitée si retrait effectué).
  deposit_amount  numeric(10, 2) not null default 5 check (deposit_amount >= 0),
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists offers_merchant_active_idx on public.offers (merchant_id) where active;

create trigger offers_set_updated_at
  before update on public.offers
  for each row execute function public.set_updated_at();

alter table public.offers enable row level security;

drop policy if exists "offers_select_visible" on public.offers;
create policy "offers_select_visible" on public.offers
  for select to authenticated
  using (true);