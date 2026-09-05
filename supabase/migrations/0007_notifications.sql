-- ============================================================================
-- Voizy — 0007 Notifications, push tokens, Realtime
-- ============================================================================

-- ---------------------------------------------------------------------------
-- push_tokens : jetons Expo Notifications des appareils
-- ---------------------------------------------------------------------------
create table if not exists public.push_tokens (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.users (id) on delete cascade,
  expo_token  text not null unique,
  platform    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger push_tokens_set_updated_at
  before update on public.push_tokens
  for each row execute function public.set_updated_at();

alter table public.push_tokens enable row level security;

drop policy if exists "push_tokens_select_own" on public.push_tokens;
create policy "push_tokens_select_own" on public.push_tokens
  for select using (auth.uid() = user_id);

drop policy if exists "push_tokens_insert_own" on public.push_tokens;
create policy "push_tokens_insert_own" on public.push_tokens
  for insert with check (auth.uid() = user_id);

drop policy if exists "push_tokens_update_own" on public.push_tokens;
create policy "push_tokens_update_own" on public.push_tokens
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- notifications : historique in-app + file d'attente push (sent_at)
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  type       text not null
             check (type in ('order_joined', 'order_confirmed', 'order_cancelled',
                             'pickup_reminder', 'deposit_released', 'deposit_captured',
                             'order_completed', 'no_show')),
  payload    jsonb not null default '{}'::jsonb,
  read       boolean not null default false,
  sent_at    timestamptz,             -- null = push non encore envoyé
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unsent_idx on public.notifications (sent_at) where sent_at is null;

alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications
  for select using (auth.uid() = user_id);

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Realtime : commandes + notifications poussées aux clients abonnés
-- ---------------------------------------------------------------------------
do $$
begin
  create publication supabase_realtime;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.group_orders;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.participations;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null;
end $$;