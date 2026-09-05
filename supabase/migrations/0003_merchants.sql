-- ============================================================================
-- Voizy — 0003 merchants (commerçants partenaires, onboarding concierge)
-- ============================================================================

create table if not exists public.merchants (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (char_length(name) between 2 and 120),
  description         text check (char_length(description) <= 2000),
  category            text not null default 'autres'
                      check (category in ('epicerie', 'primeur', 'torrefaction',
                                          'cave', 'epicerie_fine', 'autres')),
  address             text not null check (char_length(address) between 4 and 200),
  lat                 double precision check (lat between -90 and 90),
  lng                 double precision check (lng between -180 and 180),
  location            geography(Point, 4326)
                      generated always as (
                        case
                          when lat is null or lng is null then null
                          else st_setsrid(st_makepoint(lng, lat), 4326)::geography
                        end
                      ) stored,
  status              text not null default 'onboarding'
                      check (status in ('onboarding', 'pending', 'active', 'paused')),
  stripe_account_id   text,                -- compte Connect Express
  manager_id          uuid references public.users (id),  -- compte back-office (concierge)
  commission_rate     numeric(3, 2) not null default 0.03 check (commission_rate between 0 and 0.10),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists merchants_geo_idx on public.merchants using gist (location) where status = 'active';
create index if not exists merchants_status_idx on public.merchants (status);

create trigger merchants_set_updated_at
  before update on public.merchants
  for each row execute function public.set_updated_at();

alter table public.merchants enable row level security;

-- Lecture : tout utilisateur connecté voit les commerçants partenaires.
-- Les mutations passent par les Edge Functions (onboarding) et le service_role
-- (mode concierge) — aucune policy d'écriture = tout refusé.
drop policy if exists "merchants_select_visible" on public.merchants;
create policy "merchants_select_visible" on public.merchants
  for select to authenticated
  using (true);