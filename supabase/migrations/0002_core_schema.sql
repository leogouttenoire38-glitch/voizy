-- ============================================================================
-- Voizy — 0002 Schéma de base : users (habitants) + quartier
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Trigger utilitaire : tient updated_at à jour
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- users : profil public lié à auth.users
-- ---------------------------------------------------------------------------
create table if not exists public.users (
  id                  uuid primary key references auth.users (id) on delete cascade,
  full_name           text not null default '',
  email               text,
  phone               text,
  neighborhood        text,               -- nom du quartier affiché (ex. « Aligre — Paris 12e »)
  lat                 double precision check (lat between -90 and 90),
  lng                 double precision check (lng between -180 and 180),
  location            geography(Point, 4326)
                      generated always as (
                        case
                          when lat is null or lng is null then null
                          else st_setsrid(st_makepoint(lng, lat), 4326)::geography
                        end
                      ) stored,
  stripe_customer_id  text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists users_location_idx on public.users using gist (location);
create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- Le profil public exposé aux voisins (jamais email / phone / stripe).
create or replace view public.profiles
with (security_invoker = false)
as
  select id, full_name, neighborhood, created_at
  from public.users;
comment on view public.profiles is
  'Profil exposé aux autres utilisateurs — colonnes sûres uniquement.';

grant select on public.profiles to anon, authenticated;

-- RLS : chacun ne voit/lit que sa propre ligne users ; les autres passent par profiles.
alter table public.users enable row level security;

drop policy if exists "users_select_own" on public.users;
create policy "users_select_own" on public.users
  for select using (auth.uid() = id);

drop policy if exists "users_update_own" on public.users;
create policy "users_update_own" on public.users
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- Création automatique de la ligne users lors de l'inscription auth
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, full_name, email, phone)
  values (
    new.id,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    new.email,
    new.phone
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- app_config : réglages métier modifiables sans migration
-- ---------------------------------------------------------------------------
create table if not exists public.app_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.app_config (key, value) values
  ('currency',                      jsonb '"eur"'),
  ('commission_default',            jsonb '0.03'),
  ('deposit_default',               jsonb '5'),
  ('order_min_duration_hours',      jsonb '1'),
  ('order_max_duration_days',       jsonb '30'),
  ('pickup_reminder_hours_before',  jsonb '3'),
  ('no_show_grace_hours',           jsonb '4')
on conflict (key) do nothing;