# Voizy — Achat groupé hyperlocal entre voisins

**Voizy** permet aux habitants d'un même quartier de se regrouper pour commander
chez un commerçant de proximité et débloquer un tarif préférentiel, avec une
**caution remboursable** (pré-autorisation Stripe) pour garantir la présence au
retrait — conforme au cahier des charges (`cahier_des_charges_voizy.md`, MVP §6.1).

> MVP livré : schéma + RLS + RPC Supabase (verrous atomiques anti double
> validation de seuil), 10 Edge Functions (Stripe Connect Express, géocodage,
> clôture de commandes, push), application mobile Expo complète en français,
> back-office web commerçant.

---

## Architecture

| Brique | Technologie | Rôle |
|---|---|---|
| Mobile | React Native + **Expo SDK 57** (expo-router, TypeScript) | `mobile/` — tous les écrans (organisateur + participant) |
| Backend | **Supabase** (Postgres 15 + PostGIS, Auth, Realtime, Edge Functions) | `supabase/` |
| Paiement | **Stripe Connect Express** (PaymentIntents *manual capture*, transfer **net** au commerçant via `transfer_data.amount` = montant − commission Voizy − **frais Stripe à la charge du commerçant**) | produit + caution |
| Push | Expo Notifications (cron `dispatch-notifications`) | seuil atteint / non atteint, rappel retrait, caution libérée |
| Proximité | PostGIS `geography(Point)` + `ST_DWithin` | commerçants & commandes autour du quartier |
| Back-office | Vite + React + supabase-js | `web/` — commandes confirmées, créneaux, no-show, stats |

```
voizy/
├── cahier_des_charges_voizy.md
├── .env.example                  # clés Supabase / Stripe / Expo
├── supabase/
│   ├── config.toml               # config CLI locale
│   ├── migrations/               # 0001 → 0014 (schéma, RLS, RPC, triggers, seeds, correctifs)
│   └── functions/
│       ├── _shared/              # cors, supabase admin, stripe (Connect), push, settle
│       ├── geocode/              # adresse → lat/lng (Nominatim)
│       ├── merchant-onboarding/  # compte Connect Express + lien d'onboarding (concierge)
│       ├── setup-payment/        # enregistre la carte du participant (Checkout mode setup)
│       ├── join-order/           # RPC atomique + 2 PaymentIntents (produit + caution)
│       ├── settle-order/         # (logique partagée _shared/settle.ts) capture des paiements
│       ├── close-order/          # cron : verrouillage à échéance + rappels retrait
│       ├── confirm-pickup/       # retrait : caution libérée / no-show : caution capturée
│       ├── dispatch-notifications/ # cron : notifications en attente → push Expo
│       └── stripe-webhook/       # account.updated + payment_intent.* (HMAC vérifié)
├── mobile/                       # app Expo (tous les écrans en français)
└── web/                          # back-office commerçant (Vite + React)
```

## Modèle de données

`users` (profil + quartier GPS) · `merchants` (partenaires, compte Connect,
commission, gestionnaire) · `offers` (produit + prix normal/groupé + seuil +
caution) · `group_orders` (snapshots prix/seuil, `share_token`, statuts
open → confirmed → completed | cancelled) · `participations` (2 PaymentIntents
par participant) · `transactions` (journal ventilé : brut, commission Voizy,
frais Stripe estimés/réels, net commerçant) · `notifications` · `push_tokens` — le tout
protégé par RLS (participants pour une commande, gestionnaire pour un commerce,
profil public sans email/téléphone).

### RLS : jamais de sous-requête croisée entre deux tables

⚠️ Les sous-requêtes d'une policy sont elles-mêmes soumises au RLS des tables
qu'elles lisent. Deux policies qui se référencent mutuellement (cas historique
`group_orders` → `participations` → `group_orders`) font échouer **toute**
lecture client avec `42P17 infinite recursion detected in policy for relation
…` — écran « Découvrir » et détail de commande cassés, donc paiement
inatteignable.

**Règle** : les vérifications croisées passent par des helpers `SECURITY
DEFINER` (`is_order_participant`, `is_order_organizer`, `is_order_manager`,
migration `0013`), comme les RPC de feed. Le scénario E2E **G** verrouille ce
comportement avec un vrai utilisateur authentifié (jamais `service_role`, qui
contourne RLS et ne verrait donc pas la régression).

## Démarrage rapide

### 1. Supabase local (Docker requis)

```bash
cp .env.example .env                 # puis remplir les clés
cd supabase
supabase start                       # Postgres+PostGIS, Auth, Realtime, Edge runtime
supabase db reset                    # applique les migrations (schéma + RLS + RPC + seeds)
```

Le **même code fonctionne à l'identique sur un projet cloud** : `supabase link --project-ref <ref>` puis `supabase db push`.

### 2. Secrets des Edge Functions

```bash
supabase secrets set --env-file ../.env STRIPE_SECRET_KEY \
  STRIPE_WEBHOOK_SECRET EXPO_ACCESS_TOKEN
```

### 3. Lancer les fonctions en local

```bash
supabase functions serve   # → http://127.0.0.1:54321/functions/v1/<nom>
```

### 4. Application mobile

```bash
cd mobile
cp .env.example .env                 # EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY
npm install
npx expo start                       # QR code → Expo Go (téléphone sur le même réseau)
```

Parcours de test : connexion avec le compte démo `organisateur@voizy.test` / `voizy-demo`
→ quartier déjà défini (Aligre — Paris 12e) → **Découvrir** : commerçants et commandes
ouvertes → **＋** créer une commande (offre, seuil, date de retrait) → **Partager**
(WhatsApp / SMS, deep link) → 2ᵉ compte voisin rejoint → seuil atteint → **retrait**
(l'organisateur confirme, cautions libérées). Les paiements utilisent les clés de test
Stripe (`sk_test_…`) : carte de test `4242 4242 4242 4242`.

### 5. Back-office commerçant

```bash
cd web
cp .env.example .env
npm install && npm run dev           # → http://127.0.0.1:5173
```

Compte démo : `commercant@voizy.test` / `voizy-demo` (gestionnaire de l'« Épicerie des
Aligre »). Les commerces sont rattachés au gestionnaire via `merchants.manager_id`
(mode concierge). En production, restreindre la liste aux commerces du gestionnaire.

## Flux de paiement (Stripe Connect Express, mode test)

Respecte le cahier des charges (§7.2) : séparation stricte entre la
**pré-autorisation de caution** et le **paiement du produit**.

1. **Onboarding concierge** : le back-office crée le compte Connect Express du
   commerçant → lien d'onboarding → webhook `account.updated` → statut `active`.
2. **Participation** : `join_order` (RPC atomique, verrou `SELECT … FOR UPDATE`)
   insère la participation, puis crée 2 PaymentIntents en **capture manuelle**
   (aucun débit) avec `transfer_data.destination` = compte du commerçant,
   `on_behalf_of` et `transfer_data.amount` = montant − commission Voizy −
   frais Stripe estimés (transfert **net** au commerçant) :
   - PI **produit** (prix groupé) — capturé quand le seuil est atteint ;
   - PI **caution** (pré-autorisation) — jamais débitée si le retrait a lieu.
3. **Seuil atteint** → statut `confirmed` + capture idempotente des PI produit
   (`_shared/settle.ts`, rejouée par le cron si besoin) + notification à tous.
4. **Échéance sans seuil** → `close-order` annule toutes les pré-autorisations
   (rien n'est débité) + notification « commande annulée ».
5. **Retrait** → `confirm-pickup` (organisateur ou commerçant) : cautions des
   présents **libérées** (annulation du PI) ; cautions des **no-show retenues**
   (capture, conformément aux CGV) + notifications.
6. **Litige** (MVP) : résolution manuelle au dashboard Stripe.

## Modèle économique (qui paie quoi)

- **Commission Voizy** : **5 %** du montant produit par défaut
  (`app_config.commission_default`, `merchants.commission_rate` par commerçant,
  snapshotée dans `group_orders.commission_rate` à la création de la commande).
- **Frais de traitement Stripe** (1,5 % + 0,25 € en zone euro, cartes UE
  standard) : **à la charge du commerçant**, comme sur un terminal classique.
  Les *destination charges* étant toujours facturées à la plateforme par
  Stripe (l'option « Stripe prélève les frais aux comptes connectés » ne
  concerne que les *direct charges*), le transfert au commerçant est réduit :
  `transfer_data.amount` = montant − commission − frais. NB : `application_fee_amount`
  et `transfer_data[amount]` étant mutuellement exclusifs côté Stripe, la
  commission n'est pas un champ séparé mais entre dans le calcul du transfert
  net. La plateforme reverse les frais sur sa part et ne conserve que la
  commission (écart d'arrondi éventuel supporté par la plateforme).
- **Caution** : pré-autorisation **jamais débitée au retrait normal** → frais
  Stripe nuls, intégralement remboursée. En **no-show**, la capture supporte
  les frais Stripe, côté commerçant (même mécanisme de transfert réduit).

### Exemple — produit 9,50 € + caution 4 €

| Poste | Montant |
|---|---|
| Prix produit payé par le client | 9,50 € |
| Commission Voizy (5 %) | − 0,48 € |
| Frais Stripe produit (1,5 % + 0,25 €) | − 0,39 € |
| **Net commerçant (produit)** | **8,63 €** |
| Caution pré-autorisée | 4,00 € (aucun débit) |
| Retrait effectué | caution libérée — frais 0 €, rien n'est débité |
| No-show | 4,00 € capturés − 0,31 € de frais Stripe → net commerçant **3,69 €** |

> NB : le transfert retient les frais **estimés** (taux domestique UE). Si le
> frais réel Stripe diffère (carte hors zone UE, interchange…), la différence
> reste à la charge de la plateforme — les deux montants sont tracés (voir
> ci-dessous).

### Traçage par transaction (compta & transparence)

Depuis l'abandon d'`application_fee_amount`, chaque paiement produit capturé
est ventilé en base (migration `0012_fee_tracing.sql`) sur la ligne
`transactions` de type `product_payment` :

| Colonne | Sens |
|---|---|
| `gross_amount` | montant brut payé par le client |
| `commission_amount` | commission Voizy (snapshot `group_orders.commission_rate`) |
| `stripe_fee_estimated` | frais estimés retenus sur le transfert (1,5 % + 0,25 €) |
| `stripe_fee_real` | frais réels Stripe lus sur le `balance_transaction` (NULL si indispo) |
| `net_transfer` | net commerçant = brut − commission − frais estimés (miroir de `transfer_data.amount`) |

Somme de la commission Voizy sur une période :

```sql
-- Vue compta (réservée au service_role / éditeur SQL — pas de grant client)
select * from public.v_voizy_revenue_monthly;          -- mois, volume, commission, frais, net, marge Voizy
select * from public.v_voizy_transaction_breakdown;    -- détail par transaction (commerçant, commande)
```

Le back-office commerçant affiche la synthèse du mois en cours via le RPC
`merchant_commission_summary` (volume, commission Voizy, frais estimés, net
commerçant) pour la transparence sur ce que Voizy prélève.

## Tâches planifiées (cron)

| Fonction | Intervalle conseillé | Rôle |
|---|---|---|
| `close-order` | 5 min | verrouille les commandes à échéance (confirme + capture, ou annule) + rappels de retrait |
| `dispatch-notifications` | 1–5 min | envoie les notifications en attente (`sent_at IS NULL`) en push Expo |

En local, déclenchement manuel :

```bash
curl -X POST http://127.0.0.1:54321/functions/v1/close-order -H "Authorization: Bearer $SUPABASE_ANON_KEY"
curl -X POST http://127.0.0.1:54321/functions/v1/dispatch-notifications -H "Authorization: Bearer $SUPABASE_ANON_KEY"
```

## Test E2E du moteur de paiement (`scripts/e2e-stripe.mjs`)

Valide de bout en bout (Supabase local + API Stripe de test réelle) : onboarding
Connect + webhook signé, garde-fou commerçant non connecté, **course au seuil**
(3 joins concurrents sur un seuil de 2 → exactement 2, compteur jamais dépassé),
**2 PaymentIntents par participant** (produit capturé au seuil avec commission
5 % ; frais Stripe à la charge du commerçant vérifiés sur le transfert, caution
en pré-autorisation), **no-show** (caution capturée / libérée), **3-D Secure**
(avortement propre, aucun débit), **seuil non atteint** (`close-order` →
annulations + traces `release`), **RLS lue en tant qu'utilisateur authentifié**
(scénario G : les policies `group_orders` ↔ `participations` ne doivent jamais
récurser) et **parcours de paiement carte absente → enregistrement → reprise**
(scénario H : aucune participation fantôme).

```bash
# Séquence fiable (le serve de fonctions bloque `db reset` s'il tourne) :
taskkill //F //IM supabase.exe 2>/dev/null; supabase db reset
cd supabase && nohup supabase functions serve --env-file functions/.env &   # autre terminal
node scripts/e2e-stripe.mjs    # → « 48 ✅ / 0 ❌ »
```

Notes importantes :

- Le scénario A provisionne un compte Connect **Custom** (100 % API) : les
  comptes **Express** exigent le KYC hébergé par le titulaire (non automatisable).
  Le parcours Express de production (`merchant-onboarding` → lien hébergé) reste
  à valider manuellement au premier pilote. Le moteur de paiement (transferts,
  commissions, cautions) est identique entre les deux types.
- La vérification KYC sandbox 2026 exige des **valeurs magiques** : DOB
  `1901-01-01` et adresse `address_full_match` (voir `INDIVIDUAL_TEST`).
- Le compte créé est réutilisé entre les runs (`scripts/.e2e-connect.json`,
  ignoré par git) ; le supprimer pour en recréer un.
- Sous charge locale, le runtime peut répondre `BOOT_ERROR: Worker failed to
  boot` pour un join concurrent (artefact local, aucun log applicatif) — les
  invariants métier (compteur ≤ seuil, captures exactes) restent vérifiés.

## Stripe — configuration

1. Clés de test : `STRIPE_SECRET_KEY=sk_test_…`, `STRIPE_WEBHOOK_SECRET=whsec_…`.
2. Webhook (test puis live) pointé sur `https://<ref>.supabase.co/functions/v1/stripe-webhook`,
   événements : `account.updated`, `payment_intent.succeeded`, `payment_intent.canceled`.
3. **Comptes Connect** : lors de l'onboarding, indiquez un pays FR et des
   coordonnées de test ; en test mode aucun document n'est demandé.
4. En local, exposer le webhook avec `supabase functions serve` + un tunnel
   (ex. `stripe listen --forward-to localhost:54321/functions/v1/stripe-webhook`).

## Déploiement Cloud (staging)

Le backend peut tourner sur Supabase Cloud (projet gratuit) pendant que le dev
local reste indépendant :

```bash
# 1. Lier le projet local au projet Cloud (PAT : supabase.com/dashboard/account/tokens)
export SUPABASE_ACCESS_TOKEN=sbp_…
supabase link --project-ref <ref>

# 2. Pousser les migrations 0001 → 0014 (ordre identique à local)
supabase db push

# 3. Secrets des fonctions côté Cloud (mêmes noms qu'en local)
supabase secrets set --project-ref <ref> \
  STRIPE_SECRET_KEY=sk_test_… STRIPE_CURRENCY=eur STRIPE_WEBHOOK_SECRET=whsec_…

# 4. Déployer les fonctions ; stripe-webhook SANS vérif JWT (appelé par Stripe)
supabase functions deploy --use-api --project-ref <ref> close-order confirm-pickup \
  dispatch-notifications geocode join-order merchant-onboarding setup-payment
supabase functions deploy --use-api --no-verify-jwt --project-ref <ref> stripe-webhook
```

Points vérifiés au déploiement (sept. 2026) :

- **pgcrypto** vit dans le schéma `extensions` sur Cloud (le runner `db push` n'a
  pas `extensions` dans son `search_path`) → appels qualifiés
  `extensions.gen_random_bytes()` / `extensions.crypt()` dans les migrations.
- **Headers non-ASCII interdits** : le runtime edge Cloud rejette une valeur de
  header non-ASCII (`User-Agent` avec un tiret cadratin → toutes les requêtes
  sortantes échouaient). Garder les headers en ASCII pur.
- **Géocodage** : chaîne de repli Nominatim → Photon → Open-Meteo (sans clé),
  Nominatim bloquant certaines IP de datacenters.
- **Webhook Stripe** : créer l'endpoint via l'API (le secret n'est affiché
  qu'à la création) pointé sur `https://<ref>.supabase.co/functions/v1/stripe-webhook`.
- **Cron** : planifier `close-order` et `dispatch-notifications` via Dashboard →
  Edge Functions → Scheduled (intervalle conseillé : 5 min).

L'APK de test (EAS Build, profil `preview`) pointe sur le Cloud via
`mobile/.env.production` + `mobile/eas.json` (env du build). Le back-office
web pointe sur le Cloud via `web/.env.production` (`vite build --mode production`).

## Comptes de démonstration (seeds)

| Rôle | E-mail | Mot de passe |
|---|---|---|
| Organisateur | `organisateur@voizy.test` | `voizy-demo` |
| Commerçant (back-office) | `commercant@voizy.test` | `voizy-demo` |

## Limites assumées du MVP (et pistes)

- **3-D Secure** : une carte enregistrée peut déclencher une confirmation bancaire ;
  au MVP la participation est annulée proprement et l'utilisateur est invité à
  réessayer (amélioration : confirmer le PaymentIntent côté client avec
  `stripe-react-native`).
- **OTP SMS** (Twilio) : prévu au cahier des charges, reporté après le MVP —
  le téléphone est collecté au profil ; l'auth est e-mail/mot de passe + lien magique.
- Résolution de litige **manuelle** (dashboard Stripe) ; à automatiser en V2.
- No-show : détection par l'organisateur/commerçant (pas encore de géofencing).
- Back-office : liste des commerces ouverte à tous les comptes connectés pendant
  la phase concierge (à restreindre à `manager_id = uid` en production).
- Notifications push : Expo Push (FCM/APNs sous le capot) ; en Expo Go les push
  distants ne fonctionnent pas sur iOS.

## Scripts utiles

```bash
cd mobile && npm run typecheck   # tsc --noEmit
cd mobile && npm run lint        # expo lint
cd web && npm run typecheck      # tsc --noEmit
cd supabase && supabase db reset # rejoue les migrations locales
node scripts/gen-assets.mjs      # régénère les icônes PNG de l'app
```