-- ============================================================================
-- Voizy — 0010 Seeds : quartier pilote « Aligre — Paris 12e »
-- Mode concierge : 4 commerçants partenaires + offres à paliers, deux comptes
-- de démonstration (organisateur + commerçant) pour tester les parcours.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Comptes de démonstration (auth.users → le trigger crée la ligne users)
--   organisateur@voizy.test / voizy-demo   (Camille — quartier Aligre)
--   commercant@voizy.test / voizy-demo     (Fatima — gérante de l'épicerie)
-- ---------------------------------------------------------------------------
insert into auth.users
  (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
   confirmation_token, recovery_token, email_change, email_change_token_new,
   phone_change, phone_change_token, reauthentication_token,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'organisateur@voizy.test',
   crypt('voizy-demo', gen_salt('bf')), now(),
   '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"]}',
   '{"full_name":"Camille"}', now(), now()),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'commercant@voizy.test',
   crypt('voizy-demo', gen_salt('bf')), now(),
   '', '', '', '', '', '', '',
   '{"provider":"email","providers":["email"]}',
   '{"full_name":"Fatima"}', now(), now())
on conflict (id) do nothing;

-- Quartier pilote pour les comptes de démo (Aligre, Paris 12e).
update public.users set
  neighborhood = 'Aligre — Paris 12e',
  lat = 48.8499, lng = 2.3756
where id in ('00000000-0000-0000-0000-000000000001',
             '00000000-0000-0000-0000-000000000002');

-- ---------------------------------------------------------------------------
-- Commerçants partenaires (mode concierge — onboarding Stripe à compléter)
-- ---------------------------------------------------------------------------
insert into public.merchants (id, name, description, category, address, lat, lng,
                              status, manager_id, commission_rate) values
  ('10000000-0000-0000-0000-000000000001',
   'Épicerie des Aligre',
   'Épicerie de quartier : conserves, huiles, pâtes, épices et produits du terroir. Tenue par Fatima, place du marché depuis 15 ans.',
   'epicerie', '12 rue de Cotte, 75012 Paris', 48.8496, 2.3749,
   'active', '00000000-0000-0000-0000-000000000002', 0.03),
  ('10000000-0000-0000-0000-000000000002',
   'Primeur Racines & Compagnie',
   'Légumes racines et fruits de saison, sélectionnés chez des maraîchers d''Île-de-France.',
   'primeur', '4 place d''Aligre, 75012 Paris', 48.8492, 2.3757,
   'active', null, 0.03),
  ('10000000-0000-0000-0000-000000000003',
   'Torréfacteur Saint-Antoine',
   'Cafés en grains torréfiés chaque semaine sur place, cafés moulus et thés en vrac.',
   'torrefaction', '18 rue du Faubourg Saint-Antoine, 75012 Paris', 48.8508, 2.3744,
   'active', null, 0.03),
  ('10000000-0000-0000-0000-000000000004',
   'Cave & Conserves du Faubourg',
   'Vins de petits producteurs, conserves artisanales, miels et confitures de la région.',
   'cave', '27 rue de Charenton, 75012 Paris', 48.8483, 2.3712,
   'active', null, 0.03)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Offres éligibles au group buying (produits secs / épicerie / non périssables)
-- ---------------------------------------------------------------------------
insert into public.offers (merchant_id, title, description, unit_label,
                           base_price, group_price, threshold, deposit_amount) values
  ('10000000-0000-0000-0000-000000000001',
   'Lot de 6 conserves de légumes',
   'Soupes, ratatouilles et poires au sirop de la conserverie voisine.', 'lot de 6',
   12.00, 9.50, 5, 5.00),
  ('10000000-0000-0000-0000-000000000001',
   'Bidon d''huile d''olive 1 L',
   'Huile d''olive vierge extra, première pression à froid.', '1 L',
   14.00, 11.00, 4, 5.00),
  ('10000000-0000-0000-0000-000000000002',
   'Panier de légumes racines (5 kg)',
   'Pommes de terre, oignons, betteraves et carottes de saison.', 'panier de 5 kg',
   15.00, 12.00, 5, 5.00),
  ('10000000-0000-0000-0000-000000000002',
   'Sac de pommes de terre 10 kg',
   'Pommes de terre fermières, conservation longue.', 'sac de 10 kg',
   8.00, 6.00, 6, 5.00),
  ('10000000-0000-0000-0000-000000000003',
   'Café en grains 1 kg — Éthiopie',
   'Torréfaction moyenne, notes florales et agrumes.', '1 kg',
   22.00, 18.00, 4, 5.00),
  ('10000000-0000-0000-0000-000000000003',
   'Café moulu 500 g — brésilien',
   'Torréfaction foncée, idéal en cafetière à filtre.', '500 g',
   12.00, 9.90, 5, 5.00),
  ('10000000-0000-0000-0000-000000000004',
   'Caisse de 6 bouteilles — vins du coin',
   'Sélection de vins de petits producteurs franciliens.', 'caisse de 6',
   30.00, 24.00, 4, 10.00),
  ('10000000-0000-0000-0000-000000000004',
   'Miels & confitures artisanales (lot de 4)',
   'Miels de la Brie et confitures de fruits rouges.', 'lot de 4',
   18.00, 14.50, 5, 5.00)
on conflict (id) do nothing;