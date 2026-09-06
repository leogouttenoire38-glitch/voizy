-- ============================================================================
-- Voizy — 0005 group_orders (commandes groupées)
-- Statuts : open → confirmed → completed | cancelled
-- Les snapshots (prix, seuil, commission) sont figés à la création pour que
-- toute modification d'offre ne change pas les commandes en cours.
-- ============================================================================

create table if not exists public.group_orders (
  id                    uuid primary key default gen_random_uuid(),
  merchant_id           uuid not null references public.merchants (id),
  offer_id              uuid references public.offers (id) on delete set null,
  organizer_id          uuid not null references public.users (id),
  status                text not null default 'open'
                        check (status in ('open', 'confirmed', 'completed', 'cancelled')),
  participants_current  integer not null default 0 check (participants_current >= 0),
  threshold             integer not null check (threshold >= 2),
  title                 text not null,                    -- snapshot de l'offre
  unit_label            text not null default 'unité',
  base_price            numeric(10, 2) not null check (base_price > 0),
  group_price           numeric(10, 2) not null check (group_price > 0),
  deposit_amount        numeric(10, 2) not null default 0 check (deposit_amount >= 0),
  commission_rate       numeric(3, 2) not null default 0.05,
  pickup_at             timestamptz not null,             -- échéance = verrouillage automatique
  pickup_location       text not null,
  share_token           text not null unique default encode(extensions.gen_random_bytes(8), 'hex'),
  confirmed_at          timestamptz,
  completed_at          timestamptz,
  cancelled_at          timestamptz,
  cancelled_reason      text check (cancelled_reason in ('threshold_not_reached', 'merchant', 'organizer')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists group_orders_merchant_idx   on public.group_orders (merchant_id, status);
create index if not exists group_orders_organizer_idx  on public.group_orders (organizer_id, created_at desc);
create index if not exists group_orders_pickup_idx     on public.group_orders (status, pickup_at) where status = 'open';
create index if not exists group_orders_token_idx      on public.group_orders (share_token);

create trigger group_orders_set_updated_at
  before update on public.group_orders
  for each row execute function public.set_updated_at();

alter table public.group_orders enable row level security;

-- La policy de lecture complète est créée en 0006 (elle référence
-- public.participations, définie dans cette migration).
-- Mutations : uniquement via RPC (create/join/confirm/cancel) et Edge Functions.
-- Aucune policy d'écriture = tout refusé depuis le client.