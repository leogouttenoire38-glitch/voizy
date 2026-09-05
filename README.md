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
| Paiement | **Stripe Connect Express** (PaymentIntents *manual capture*, transfer vers le compte commerçant, `application_fee_amount` = commission) | produit + caution |
| Push | Expo Notifications (cron `dispatch-notifications`) | seuil atteint / non atteint, rappel retrait, caution libérée |
| Proximité | PostGIS `geography(Point)` + `ST_DWithin` | commerçants & commandes autour du quartier |
| Back-office | Vite + React + supabase-js | `web/` — commandes confirmées, créneaux, no-show, stats |

```
voizy/
├── cahier_des_charges_voizy.md
├── .env.example                  # clés Supabase / Stripe / Expo
├── supabase/
│   ├── config.toml               # config CLI locale
│   ├── migrations/               # 0001 → 0010 (schéma, RLS, RPC, triggers, seeds)
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
par participant) · `transactions` · `notifications` · `push_tokens` — le tout
protégé par RLS (participants pour une commande, gestionnaire pour un commerce,
profil public sans email/téléphone).

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
   `on_behalf_of` et `application_fee_amount` (commission 2-5 %) :
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
**2 PaymentIntents par participant** (produit capturé au seuil avec commission,
caution en pré-autorisation), **no-show** (caution capturée / libérée), **3-D Secure**
(avortement propre, aucun débit) et **seuil non atteint** (`close-order` →
annulations + traces `release`).

```bash
# Séquence fiable (le serve de fonctions bloque `db reset` s'il tourne) :
taskkill //F //IM supabase.exe 2>/dev/null; supabase db reset
cd supabase && nohup supabase functions serve --env-file functions/.env &   # autre terminal
node scripts/e2e-stripe.mjs    # → « 34 ✅ / 0 ❌ »
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