-- ============================================================================
-- Voizy — 0016 Self-service commerçant (sept. 2026)
--
-- Objectif : un nouveau commerçant crée son compte SEUL, publie une offre et
-- reçoit un vrai paiement — sans intervention de l'équipe Voizy.
--
--   1. users.role         : un seul rôle actif à la fois (buyer | merchant).
--   2. choose_role()      : choix explicite du rôle juste après l'inscription.
--   3. create_my_merchant : crée la fiche commerce du compte connecté
--                           (manager_id = auth.uid(), commission 0, plan free).
--   4. create_offer / update_offer / deactivate_offer / activate_offer :
--                           gestion du catalogue par le gérant du commerce
--                           (mêmes règles pour le mobile et le web).
--
-- Rappel économique (0015) : commission TOUJOURS 0. Voizy se rémunère
-- uniquement par l'abonnement commerçant (merchant_plan).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Rôle utilisateur : une seule casquette à la fois
--    null = rôle pas encore choisi (l'app demande alors le choix juste après
--    l'inscription). Tout compte existant est rétro-rempli.
-- ---------------------------------------------------------------------------
alter table public.users add column if not exists role text
  check (role is null or role in ('buyer', 'merchant'));

comment on column public.users.role is
  'Rôle actif unique : buyer (voisin) | merchant (commerçant) | null (pas encore choisi). Un compte commerçant administre SON commerce ; aucun compte n''est les deux à la fois.';

update public.users u
   set role = case
                when exists (select 1 from public.merchants m where m.manager_id = u.id)
                  then 'merchant'
                else 'buyer'
              end
 where u.role is null;

-- Un seul commerce par compte gestionnaire : garde-fou au niveau base (le
-- self-service ne doit pas pouvoir créer deux fiches en double).
create unique index if not exists merchants_manager_unique_idx
  on public.merchants (manager_id)
  where manager_id is not null;

-- ---------------------------------------------------------------------------
-- 2. my_merchant : le commerce du compte connecté (null s'il n'en a pas)
-- ---------------------------------------------------------------------------
create or replace function public.my_merchant()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.id
    from public.merchants m
   where m.manager_id = auth.uid()
   order by m.created_at
   limit 1;
$$;

comment on function public.my_merchant() is
  'Identifiant du commerce géré par le compte connecté (null sinon). Utilisé par le mobile et le web pour retrouver le tableau de bord commerçant.';

grant execute on function public.my_merchant() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. choose_role : le rôle est choisi, jamais deviné
-- ---------------------------------------------------------------------------
create or replace function public.choose_role(p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := lower(trim(coalesce(p_role, '')));
begin
  if auth.uid() is null then
    raise exception 'Connectez-vous pour choisir votre profil.';
  end if;
  if v_role = 'voisin' then v_role := 'buyer'; end if;      -- vocabulaire affiché
  if v_role not in ('buyer', 'merchant') then
    raise exception 'Choisissez « voisin » ou « commerçant ».';
  end if;

  -- Revenir acheteur est possible tant qu'aucun commerce n'est rattaché : on ne
  -- laisse jamais un compte avec role = merchant et aucune fiche commerce.
  if v_role = 'buyer' and exists (select 1 from public.merchants where manager_id = auth.uid()) then
    raise exception 'Ce compte gère déjà un commerce : il reste un compte commerçant.';
  end if;

  update public.users set role = v_role where id = auth.uid();
  return jsonb_build_object('ok', true, 'role', v_role);
end;
$$;

grant execute on function public.choose_role(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. create_my_merchant : la fiche commerce créée par le commerçant lui-même
--    Commence en « onboarding » : les offres peuvent être publiées tout de
--    suite, la visibilité dans Découvrir arrive quand Stripe confirme le
--    compte de paiement (webhook account.updated → status = active).
-- ---------------------------------------------------------------------------
create or replace function public.create_my_merchant(
  p_name     text,
  p_category text,
  p_address  text,
  p_lat      double precision default null,
  p_lng      double precision default null,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name    text := nullif(trim(coalesce(p_name, '')), '');
  v_address text := nullif(trim(coalesce(p_address, '')), '');
  v_desc    text := nullif(trim(coalesce(p_description, '')), '');
  v_category text := lower(trim(coalesce(p_category, '')));
  v_merchant public.merchants;
begin
  if auth.uid() is null then
    raise exception 'Connectez-vous pour créer votre commerce.';
  end if;
  if v_name is null or char_length(v_name) < 2 then
    raise exception 'Indiquez le nom de votre commerce (2 caractères minimum).';
  end if;
  if char_length(v_name) > 120 then
    raise exception 'Le nom du commerce est trop long (120 caractères maximum).';
  end if;
  if v_category not in ('epicerie', 'primeur', 'torrefaction', 'cave', 'epicerie_fine', 'autres') then
    raise exception 'Choisissez la catégorie de votre commerce.';
  end if;
  if v_address is null or char_length(v_address) < 4 then
    raise exception 'Indiquez l''adresse de votre commerce.';
  end if;
  if char_length(v_address) > 200 then
    raise exception 'L''adresse est trop longue (200 caractères maximum).';
  end if;
  if v_desc is not null and char_length(v_desc) > 2000 then
    raise exception 'La description est trop longue (2000 caractères maximum).';
  end if;
  if p_lat is not null and (p_lat < -90 or p_lat > 90) then
    raise exception 'Position introuvable : vérifiez l''adresse de votre commerce.';
  end if;
  if p_lng is not null and (p_lng < -180 or p_lng > 180) then
    raise exception 'Position introuvable : vérifiez l''adresse de votre commerce.';
  end if;
  if exists (select 1 from public.merchants where manager_id = auth.uid()) then
    raise exception 'Un commerce est déjà rattaché à ce compte.';
  end if;

  insert into public.merchants
    (name, description, category, address, lat, lng, status, manager_id, commission_rate)
  values
    (v_name, v_desc, v_category, v_address, p_lat, p_lng, 'onboarding', auth.uid(), 0)
  returning * into v_merchant;

  -- Palier gratuit par défaut (jamais abonné) — la rémunération de Voizy.
  insert into public.merchant_plan (merchant_id)
  values (v_merchant.id)
  on conflict (merchant_id) do nothing;

  update public.users set role = 'merchant' where id = auth.uid();

  return jsonb_build_object('ok', true, 'merchant', to_jsonb(v_merchant));
end;
$$;

grant execute on function public.create_my_merchant(text, text, text, double precision, double precision, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Catalogue : règles de saisie partagées mobile / web
--    normalize_offer valide et normalise ; les messages sont en français et
--    destinés à l'écran (jamais de jargon PostgREST).
-- ---------------------------------------------------------------------------
create or replace function public.normalize_offer(
  p_title          text,
  p_description    text,
  p_unit_label     text,
  p_base_price     numeric,
  p_group_price    numeric,
  p_threshold      integer,
  p_deposit_amount numeric
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_title text := nullif(trim(coalesce(p_title, '')), '');
  v_unit  text := coalesce(nullif(trim(coalesce(p_unit_label, '')), ''), 'unité');
  v_desc  text := nullif(trim(coalesce(p_description, '')), '');
begin
  if v_title is null or char_length(v_title) < 2 then
    raise exception 'Indiquez le nom du produit (2 caractères minimum).';
  end if;
  if char_length(v_title) > 120 then
    raise exception 'Le nom du produit est trop long (120 caractères maximum).';
  end if;
  if v_desc is not null and char_length(v_desc) > 2000 then
    raise exception 'La description est trop longue (2000 caractères maximum).';
  end if;
  if char_length(v_unit) > 40 then
    raise exception 'L''unité est trop longue (40 caractères maximum).';
  end if;
  if p_base_price is null or p_base_price <= 0 then
    raise exception 'Indiquez le prix normal (en euros, supérieur à 0).';
  end if;
  if p_base_price > 10000 then
    raise exception 'Le prix normal dépasse 10 000 € — vérifiez la saisie.';
  end if;
  if p_group_price is null or p_group_price <= 0 then
    raise exception 'Indiquez le prix groupé (en euros, supérieur à 0).';
  end if;
  if p_group_price > p_base_price then
    raise exception 'Le prix groupé doit être inférieur ou égal au prix normal.';
  end if;
  if p_threshold is null or p_threshold < 2 or p_threshold > 100 then
    raise exception 'Le seuil de participants doit être compris entre 2 et 100.';
  end if;
  if p_deposit_amount is null or p_deposit_amount < 0 then
    raise exception 'La caution ne peut pas être négative.';
  end if;
  if p_deposit_amount > 200 then
    raise exception 'La caution dépasse 200 € — elle doit rester un montant symbolique, remboursé au retrait.';
  end if;

  return jsonb_build_object(
    'title',          v_title,
    'description',    v_desc,
    'unit_label',     v_unit,
    'base_price',     round(p_base_price, 2),
    'group_price',    round(p_group_price, 2),
    'threshold',      p_threshold,
    'deposit_amount', round(p_deposit_amount, 2)
  );
end;
$$;

-- assert_merchant_manager : seule autorisation d'écriture du catalogue.
create or replace function public.assert_merchant_manager(p_merchant_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Connectez-vous pour gérer votre catalogue.';
  end if;
  if p_merchant_id is null
     or not exists (
       select 1 from public.merchants
        where id = p_merchant_id and manager_id = auth.uid()
     ) then
    raise exception 'Seul le gérant de ce commerce peut gérer ses offres.';
  end if;
end;
$$;

-- create_offer : publier une offre (immédiatement visible dans le catalogue).
create or replace function public.create_offer(
  p_merchant_id    uuid,
  p_title          text,
  p_description    text default null,
  p_unit_label     text default 'unité',
  p_base_price     numeric default null,
  p_group_price    numeric default null,
  p_threshold      integer default 5,
  p_deposit_amount numeric default 5
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fields jsonb;
  v_offer  public.offers;
begin
  perform public.assert_merchant_manager(p_merchant_id);
  v_fields := public.normalize_offer(p_title, p_description, p_unit_label,
                                     p_base_price, p_group_price, p_threshold, p_deposit_amount);

  insert into public.offers
    (merchant_id, title, description, unit_label, base_price, group_price, threshold, deposit_amount, active)
  values
    (p_merchant_id,
     v_fields ->> 'title',
     v_fields ->> 'description',
     v_fields ->> 'unit_label',
     (v_fields ->> 'base_price')::numeric,
     (v_fields ->> 'group_price')::numeric,
     (v_fields ->> 'threshold')::integer,
     (v_fields ->> 'deposit_amount')::numeric,
     true)
  returning * into v_offer;

  return jsonb_build_object('ok', true, 'offer', to_jsonb(v_offer));
end;
$$;

-- update_offer : corriger une offre. Les commandes déjà ouvertes gardent le
-- prix figé à leur création (snapshot) : modifier une offre ne change jamais
-- ce qu'un voisin a déjà accepté.
create or replace function public.update_offer(
  p_offer_id       uuid,
  p_title          text,
  p_description    text default null,
  p_unit_label     text default 'unité',
  p_base_price     numeric default null,
  p_group_price    numeric default null,
  p_threshold      integer default 5,
  p_deposit_amount numeric default 5
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_merchant_id uuid;
  v_fields jsonb;
  v_offer  public.offers;
begin
  select merchant_id into v_merchant_id from public.offers where id = p_offer_id;
  if v_merchant_id is null then
    raise exception 'Cette offre n''existe plus.';
  end if;
  perform public.assert_merchant_manager(v_merchant_id);
  v_fields := public.normalize_offer(p_title, p_description, p_unit_label,
                                     p_base_price, p_group_price, p_threshold, p_deposit_amount);

  update public.offers
     set title          = v_fields ->> 'title',
         description    = v_fields ->> 'description',
         unit_label     = v_fields ->> 'unit_label',
         base_price     = (v_fields ->> 'base_price')::numeric,
         group_price    = (v_fields ->> 'group_price')::numeric,
         threshold      = (v_fields ->> 'threshold')::integer,
         deposit_amount = (v_fields ->> 'deposit_amount')::numeric
   where id = p_offer_id
  returning * into v_offer;

  return jsonb_build_object('ok', true, 'offer', to_jsonb(v_offer));
end;
$$;

-- set_offer_active : retirer / remettre une offre au catalogue.
-- La désactivation n'annule PAS les commandes déjà lancées : elles ont leur
-- propre copie du produit et vont jusqu'au retrait (le voisin ne perd rien).
create or replace function public.set_offer_active(p_offer_id uuid, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_merchant_id uuid;
  v_offer public.offers;
begin
  select merchant_id into v_merchant_id from public.offers where id = p_offer_id;
  if v_merchant_id is null then
    raise exception 'Cette offre n''existe plus.';
  end if;
  perform public.assert_merchant_manager(v_merchant_id);

  update public.offers set active = coalesce(p_active, false)
   where id = p_offer_id
  returning * into v_offer;

  return jsonb_build_object('ok', true, 'offer', to_jsonb(v_offer));
end;
$$;

-- Noms demandés par le produit : deactivate_offer / activate_offer.
create or replace function public.deactivate_offer(p_offer_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.set_offer_active(p_offer_id, false);
$$;

create or replace function public.activate_offer(p_offer_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.set_offer_active(p_offer_id, true);
$$;

grant execute on function public.create_offer(uuid, text, text, text, numeric, numeric, integer, numeric)
  to authenticated, service_role;
grant execute on function public.update_offer(uuid, text, text, text, numeric, numeric, integer, numeric)
  to authenticated, service_role;
grant execute on function public.set_offer_active(uuid, boolean)  to authenticated, service_role;
grant execute on function public.deactivate_offer(uuid)           to authenticated, service_role;
grant execute on function public.activate_offer(uuid)              to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Tableau de bord commerçant : le gérant voit aussi ses stats hors-ligne
--    (merchant_stats / merchant_commission_summary restent les sources
--    uniques ; on complète juste par le nombre d'offres publiées).
-- ---------------------------------------------------------------------------
create or replace function public.merchant_offers(p_merchant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Le gérant, ou un membre de l'équipe (service_role) — sinon refus explicite.
  if auth.uid() is not null and not exists (
    select 1 from public.merchants where id = p_merchant_id and manager_id = auth.uid()
  ) then
    raise exception 'Seul le gérant de ce commerce peut voir ce catalogue.';
  end if;

  return coalesce((
    select jsonb_agg(to_jsonb(s) order by s.active desc, s.created_at desc)
    from (
      select o.id, o.merchant_id, o.title, o.description, o.unit_label,
             o.base_price, o.group_price, o.threshold, o.deposit_amount,
             o.active, o.created_at,
             (select count(*) from public.group_orders g
               where g.offer_id = o.id and g.status = 'open') as open_orders
        from public.offers o
       where o.merchant_id = p_merchant_id
    ) s
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.merchant_offers(uuid) to authenticated, service_role;

comment on function public.merchant_offers(uuid) is
  'Catalogue du commerce (offres actives en tête) avec le nombre de commandes ouvertes par offre.';
