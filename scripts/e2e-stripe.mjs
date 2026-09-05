#!/usr/bin/env node
// ============================================================================
// Voizy — E2E minimal du moteur de paiement (Supabase local + Stripe test).
//
// Scénarios :
//   A. Provisionne un compte Connect opérationnel (Custom, 100 % API : les
//      comptes Express exigent un KYC hébergé non automatisable) puis simule le
//      webhook account.updated signé → commerçant « active ». Le parcours
//      Express de production (merchant-onboarding) reste à valider au pilote.
//   B. Garde-fou : rejoint une commande d'un commerçant non connecté → refus,
//      compteur intact
//   C. Course au seuil : 3 participants concurrents sur un seuil de 2 →
//      exactement 2 validés, commande confirmée, 2 PIs produit CAPTURÉS
//      (commission Voizy incluse), 2 PIs caution NON capturés (pré-autorisation)
//   D. No-show : caution du no-show CAPTURÉE, caution du présent LIBÉRÉE
//   E. 3-D Secure : échec propre — PIs annulés, compteur intact
//   F. Seuil non atteint : close-order → annulation des pré-autorisations,
//      aucun débit, traces product_release / deposit_release
//
// Usage :
//   1. supabase start && supabase db reset
//   2. supabase functions serve --env-file supabase/functions/.env  (autre terminal)
//   3. node scripts/e2e-stripe.mjs
//
// Clés lues depuis : variables d'env, supabase/functions/.env (Stripe),
// `supabase status -o env` (Supabase local). Aucune dépendance externe.
// ============================================================================

import { execSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Utilitaires d'assertion
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
function check(name, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  \u2705 ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed++;
    console.error(`  \u274c ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function note(s) {
  console.log(`     \u2139 ${s}`);
}
function fail(msg) {
  failed++;
  console.error(`  \u274c ${msg}`);
}

// ---------------------------------------------------------------------------
// Environnement
// ---------------------------------------------------------------------------
function parseEnv(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = { ...process.env };
if (!env.SUPABASE_SERVICE_ROLE_KEY && !env.SERVICE_ROLE_KEY) {
  try {
    Object.assign(env, parseEnv(execSync("supabase status -o env", { encoding: "utf8" })));
  } catch {
    console.error(
      "Supabase local non démarré ? Lancez d'abord : supabase start && supabase db reset\n" +
        "puis : supabase functions serve --env-file supabase/functions/.env (autre terminal)",
    );
    process.exit(2);
  }
}

const fnEnv = existsSync("supabase/functions/.env")
  ? parseEnv(readFileSync("supabase/functions/.env", "utf8"))
  : {};

const URL = env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON = env.SUPABASE_ANON_KEY ?? env.ANON_KEY ?? "";
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SERVICE_ROLE_KEY ?? "";
const STRIPE_KEY = env.STRIPE_SECRET_KEY ?? fnEnv.STRIPE_SECRET_KEY ?? "";
const WHSEC = env.STRIPE_WEBHOOK_SECRET ?? fnEnv.STRIPE_WEBHOOK_SECRET ?? "";

for (const [k, v] of [["ANON", ANON], ["SERVICE", SERVICE], ["STRIPE", STRIPE_KEY], ["WHSEC", WHSEC]]) {
  if (!v) {
    console.error(`Clé manquante : ${k} (supabase status -o env / supabase/functions/.env)`);
    process.exit(2);
  }
}

// Identifiants seedés (migration 0010)
const EPICERIE = "10000000-0000-0000-0000-000000000001";
const PRIMEUR = "10000000-0000-0000-0000-000000000002";
const PW = "voizy-demo";

// ---------------------------------------------------------------------------
// Helpers HTTP
// ---------------------------------------------------------------------------
async function http(url, { method = "GET", headers = {}, body } = {}) {
  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  let data = text;
  try { data = JSON.parse(text); } catch { /* texte brut */ }
  return { status: res.status, data };
}
const serviceHeaders = () => ({ apikey: SERVICE, Authorization: `Bearer ${SERVICE}` });
const userHeaders = (token) => ({ apikey: ANON, Authorization: `Bearer ${token}` });

// --- Auth Supabase ----------------------------------------------------------
async function signIn(email) {
  const { status, data } = await http(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...userHeaders("") },
    body: JSON.stringify({ email, password: PW }),
  });
  if (status !== 200) throw new Error(`signIn ${email} → ${status} ${JSON.stringify(data)}`);
  return data;
}
async function signUp(email, fullName) {
  const { status, data } = await http(`${URL}/auth/v1/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...userHeaders("") },
    body: JSON.stringify({ email, password: PW, data: { full_name: fullName } }),
  });
  if (status !== 200) throw new Error(`signUp ${email} → ${status} ${JSON.stringify(data)}`);
  return data;
}
async function authUser(email, fullName) {
  try {
    return await signIn(email);
  } catch {
    await signUp(email, fullName);
    return await signIn(email);
  }
}

// --- Edge Functions ---------------------------------------------------------
// apikey = même clé que Authorization : isServiceCall() compare l'en-tête
// apikey à la service_role key pour les appels concierge.
async function callFn(name, body, key) {
  const { status, data } = await http(`${URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  return { status, data };
}

// --- PostgREST (service_role pour lire/écrire en bypass RLS) ----------------
async function dbSelect(table, query) {
  const { status, data } = await http(`${URL}/rest/v1/${table}?${query}`, { headers: serviceHeaders() });
  if (status !== 200) throw new Error(`dbSelect ${table} → ${status} ${JSON.stringify(data)}`);
  return data;
}
async function dbInsert(table, payload) {
  const { status, data } = await http(`${URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...serviceHeaders(), "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
  if (![200, 201].includes(status)) throw new Error(`dbInsert ${table} → ${status} ${JSON.stringify(data)}`);
  return data;
}
async function dbUpdate(table, query, payload) {
  const { status, data } = await http(`${URL}/rest/v1/${table}?${query}`, {
    method: "PATCH",
    headers: { ...serviceHeaders(), "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
  if (status !== 200) throw new Error(`dbUpdate ${table} → ${status} ${JSON.stringify(data)}`);
  return data;
}
async function rpcAsUser(name, params, token) {
  const { status, data } = await http(`${URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { ...userHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(params ?? {}),
  });
  return { status, data };
}

// --- Stripe (REST, sans SDK) -------------------------------------------------
function flattenForm(prefix, value, out) {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) value.forEach((item, i) => flattenForm(`${prefix}[${i}]`, item, out));
  else if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) flattenForm(prefix ? `${prefix}[${k}]` : k, v, out);
  } else out.append(prefix, String(value));
}
async function stripeReq(method, path, form) {
  const params = new URLSearchParams();
  if (form) flattenForm("", form, params);
  const res = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${STRIPE_KEY}`,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? params.toString() : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Stripe ${method} ${path} → ${data?.error?.message ?? res.status}`);
  return data;
}

// --- Webhook signé (même schéma HMAC que _shared/stripe.ts) -----------------
async function sendWebhook(type, object) {
  const payload = JSON.stringify({ id: `evt_test_${Date.now()}`, type, data: { object } });
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", WHSEC).update(`${t}.${payload}`).digest("hex");
  // En local, Kong exige une clé API valide en en-tête (en prod, l'URL du
  // webhook Stripe embarque l'authentification — apikey en query ou secret de
  // fonction). La signature HMAC reste le vrai contrôle d'accès.
  const { status, data } = await http(`${URL}/functions/v1/stripe-webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON, "stripe-signature": `t=${t},v1=${sig}` },
    body: payload,
  });
  return { status, data };
}

// --- Helpers métier ----------------------------------------------------------
async function ensureCustomer(userId, email) {
  const rows = await dbSelect("users", `select=stripe_customer_id,email&id=eq.${userId}`);
  if (rows[0]?.stripe_customer_id) return rows[0].stripe_customer_id;
  const customer = await stripeReq("POST", "/v1/customers", { email, metadata: { user_id: userId } });
  await dbUpdate("users", `id=eq.${userId}`, { stripe_customer_id: customer.id });
  return customer.id;
}
// Cartes de test via PaymentMethod prédéfinis (le compte Stripe n'autorise pas
// l'envoi de numéros bruts). firstCard() prend la carte attachée en dernier.
const TEST_PMS = {
  "4242424242424242": "pm_card_visa",
  "4000002500003155": "pm_card_threeDSecure2Required",
};
async function attachCard(customerId, cardNumber) {
  const pmId = TEST_PMS[cardNumber] ?? cardNumber;
  const pm = await stripeReq("POST", `/v1/payment_methods/${pmId}/attach`, { customer: customerId });
  return pm.id;
}
const future = (hours = 2) => new Date(Date.now() + hours * 3600_000).toISOString();
const past = (minutes = 5) => new Date(Date.now() - minutes * 60_000).toISOString();

async function createOrder(token, merchantId, offerId, pickupAt = future()) {
  const { status, data } = await rpcAsUser(
    "create_group_order",
    { p_merchant_id: merchantId, p_offer_id: offerId, p_pickup_at: pickupAt, p_pickup_location: null },
    token,
  );
  if (status !== 200 || !data?.ok) throw new Error(`create_group_order → ${status} ${JSON.stringify(data)}`);
  return data.order;
}
const getPi = (id) => stripeReq("GET", `/v1/payment_intents/${id}`);

// État E2E : réutilise le compte Connect Express une fois onboardé (évite de
// refaire l'onboarding hébergé à chaque run, même après un db reset).
const CONNECT_STATE = "scripts/.e2e-connect.json";
function readConnectState() {
  try {
    return JSON.parse(readFileSync(CONNECT_STATE, "utf8"));
  } catch {
    return null;
  }
}
function writeConnectState(state) {
  writeFileSync(CONNECT_STATE, JSON.stringify(state, null, 2));
}

// La vérification KYC des comptes FR exige (mode test 2026) les valeurs magiques
// sandbox : DOB 1901-01-01 et adresse « address_full_match ». Les comptes Express
// exigent l'onboarding hébergé (KYC par le titulaire) — non automatisable par API.
// L'E2E provisionne donc un compte Custom (controller=application) 100 % par API :
// c'est le même moteur de paiement (transferts, commissions, cautions) qui est
// ensuite exercé en C-F. En production, le parcours concierge reste Express
// (merchant-onboarding → lien hébergé → webhook account.updated).
const INDIVIDUAL_TEST = {
  first_name: "Marie",
  last_name: "Dupont",
  email: "commercant@voizy.test",
  phone: "+33612345678",
  dob: { day: 1, month: 1, year: 1901 },
  address: { line1: "address_full_match", city: "Paris", postal_code: "75012", country: "FR" },
};

async function createCustomAccount() {
  const now = Math.floor(Date.now() / 1000);
  // 1. Compte token : identité + acceptation des CGU (requirement_collection=application)
  const tok = await stripeReq("POST", "/v1/tokens", {
    account: { business_type: "individual", tos_shown_and_accepted: true, individual: INDIVIDUAL_TEST },
  });
  // 2. Création du compte (obligatoire pour une plateforme FR)
  const acct = await stripeReq("POST", "/v1/accounts", {
    account_token: tok.id,
    country: "FR",
    "controller[requirement_collection]": "application",
    "controller[stripe_dashboard][type]": "none",
    "controller[fees][payer]": "application",
    "controller[losses][payments]": "application",
    "business_profile[name]": "Épicerie des Aligre (E2E)",
    "business_profile[mcc]": "5411",
    "business_profile[url]": "https://voizy.app",
    "capabilities[card_payments][requested]": "true",
    "capabilities[transfers][requested]": "true",
  });
  // 3. RIB (nécessaire pour les payouts ; jamais exercé dans l'E2E)
  await stripeReq("POST", `/v1/accounts/${acct.id}`, {
    external_account: {
      object: "bank_account", country: "FR", currency: "eur",
      account_holder_name: "Marie Dupont", account_number: "FR1420041010050500013M02606",
    },
  });
  // 4. La vérification sandbox prend ~1 min.
  for (let i = 0; i < 18; i++) {
    await new Promise((r) => setTimeout(r, 10000));
    const a = await stripeReq("GET", `/v1/accounts/${acct.id}`);
    if (a.charges_enabled === true) return a;
  }
  throw new Error(`compte ${acct.id} non activé après 3 min (requirements: ${JSON.stringify((await stripeReq("GET", `/v1/accounts/${acct.id}`)).requirements?.errors ?? [])})`);
}

async function scenarioA() {
  console.log("\n=== A. Compte Connect opérationnel + activation (webhook account.updated) ===");

  // Réutilise un compte déjà provisionné (évite de re-créer à chaque run).
  const saved = readConnectState();
  let acct = null;
  if (saved?.account_id) {
    try {
      const a = await stripeReq("GET", `/v1/accounts/${saved.account_id}`);
      if (a.charges_enabled === true) { acct = a; note(`compte ${saved.account_id} réutilisé`); }
    } catch {
      /* compte supprimé côté Stripe → recréé */
    }
  }
  if (!acct) {
    acct = await createCustomAccount();
    writeConnectState({ account_id: acct.id });
    check("compte Connect Custom créé et opérationnel (charges_enabled)", acct.charges_enabled === true, acct.id);
  }

  // Rattache le compte au commerçant (comme le ferait merchant-onboarding) puis
  // webhook account.updated (signature HMAC réelle) → statut « active ».
  await dbUpdate("merchants", `id=eq.${EPICERIE}`, {
    stripe_account_id: acct.id,
    status: "onboarding",
  });
  const wh = await sendWebhook("account.updated", { ...acct, payouts_enabled: true });
  check("webhook account.updated signé → accepté", wh.status === 200, `status=${wh.status}`);
  const mer = await dbSelect("merchants", `select=status,stripe_account_id&id=eq.${EPICERIE}`);
  check("commerçant « active » en base", mer[0]?.status === "active", `status=${mer[0]?.status}`);
}

// ============================================================================
// Scénario B — Garde-fou : commerçant non connecté
// ============================================================================
async function scenarioB() {
  console.log("\n=== B. Garde-fou : commerçant sans compte Connect (Primeur) ===");
  const camille = await authUser("organisateur@voizy.test", "Camille");

  const offer = (await dbSelect("offers", `select=id&merchant_id=eq.${PRIMEUR}&limit=1`))[0];
  const order = await createOrder(camille.access_token, PRIMEUR, offer.id);
  check("commande créée sur le Primeur", order.status === "open", order.id);

  // Fatima (compte démo) tente de rejoindre en tant que cliente
  const fatima = await authUser("commercant@voizy.test", "Fatima");
  const join = await callFn("join-order", { group_order_id: order.id }, fatima.access_token);
  check(
    "join refusé : onboarding Stripe en cours",
    join.status === 402 && /onboarding Stripe/.test(join.data?.error ?? ""),
    join.data?.error,
  );
  const o = (await dbSelect("group_orders", `select=participants_current,status&id=eq.${order.id}`))[0];
  check("compteur intact + commande toujours ouverte", o.participants_current === 0 && o.status === "open");
  const parts = await dbSelect("participations", `select=status&group_order_id=eq.${order.id}`);
  check(
    "participation d'essai nettoyée",
    parts.length === 0 || parts.every((p) => p.status === "cancelled"),
    parts.map((p) => p.status).join(", ") || "aucune",
  );
}

// ============================================================================
// Scénario C — Course au seuil (3 participants concurrents, seuil = 2)
// ============================================================================
async function scenarioC() {
  console.log("\n=== C. Course au seuil : 3 joins concurrents sur un seuil de 2 ===");
  const camille = await authUser("organisateur@voizy.test", "Camille");
  const fatima = await authUser("commercant@voizy.test", "Fatima");
  const p1 = await authUser("participant@voizy.test", "Nadia");
  const p2 = await authUser("participant2@voizy.test", "Karim");

  // Offre de test dédiée (seuil bas pour l'E2E)
  const offer = await dbInsert("offers", {
    merchant_id: EPICERIE,
    title: "Pack test E2E",
    description: "Offre créée par le script E2E (seuil 2).",
    unit_label: "pack",
    base_price: 12.0,
    group_price: 9.5,
    threshold: 2,
    deposit_amount: 5.0,
  });
  const offerId = offer[0].id;

  const order = await createOrder(camille.access_token, EPICERIE, offerId);
  check("commande créée (seuil 2)", order.threshold === 2 && order.participants_current === 0, order.id);

  for (const [name, u] of [["Fatima", fatima], ["P1", p1], ["P2", p2]]) {
    const customer = await ensureCustomer(u.user.id, u.user.email);
    await attachCard(customer, "4242424242424242");
    note(`${name} : carte Visa test attachée`);
  }

  // 3 joins SIMULTANÉS
  const settled = await Promise.allSettled([
    callFn("join-order", { group_order_id: order.id }, fatima.access_token),
    callFn("join-order", { group_order_id: order.id }, p1.access_token),
    callFn("join-order", { group_order_id: order.id }, p2.access_token),
  ]);
  const results = settled.map((r) => (r.status === "fulfilled" ? r.value : { status: 0, data: r.reason }));
  const okCount = results.filter((r) => r.status === 200 && r.data?.ok).length;
  check("exactement 2 joins validés sur 3", okCount === 2, `${okCount} ok / 3`);
  const rejected = results.filter((r) => r.status !== 200);
  // Le 3e join doit être refusé (course au verrou). Certaines courses aboutissent
  // à un 200 {ok:false} : on accepte tout refus explicite (erreur non vide),
  // quelle que soit la forme, et on exige compteur/statut intacts après.
  const thirdMsg = rejected[0]?.data?.error ?? (rejected.length ? JSON.stringify(rejected[0].data) : "") ?? "";
  const refused = rejected.length === 1 && thirdMsg.length > 0;
  if (!refused) {
    for (const [i, r] of results.entries()) note(`join ${i + 1} → status=${r.status} body=${JSON.stringify(r.data)?.slice(0, 180)}`);
  }
  check("3e join refusé proprement", refused, thirdMsg);

  // État en base : compteur exactement au seuil, jamais au-delà
  const o = (await dbSelect("group_orders", `select=participants_current,status,confirmed_at&id=eq.${order.id}`))[0];
  check("compteur = 2 exactement (atomicité)", o.participants_current === 2, `participants=${o.participants_current}`);
  check("commande confirmée (seuil atteint)", o.status === "confirmed", o.confirmed_at);

  const parts = await dbSelect(
    "participations",
    `select=id,user_id,status,product_pi_id,deposit_pi_id,deposit_status&group_order_id=eq.${order.id}`,
  );
  const paid = parts.filter((p) => p.status === "paid");
  check("2 participations « paid », 0 en attente", paid.length === 2 && parts.every((p) => p.status === "paid"));

  // Paiements côté Stripe
  let prodOk = 0;
  let depOk = 0;
  for (const p of paid) {
    const prod = await getPi(p.product_pi_id);
    const dep = await getPi(p.deposit_pi_id);
    const ok1 = prod.status === "succeeded" && prod.amount_received === 950 && prod.application_fee_amount === 29;
    const ok2 = dep.status === "requires_capture" && dep.amount_capturable === 500;
    if (ok1) prodOk++;
    if (ok2) depOk++;
    if (!ok1) note(`PI produit ${prod.id} : status=${prod.status} reçu=${prod.amount_received} fee=${prod.application_fee_amount}`);
    if (!ok2) note(`PI caution ${dep.id} : status=${dep.status} capturable=${dep.amount_capturable}`);
  }
  check("2 PIs produit CAPTURÉS (9,50 € + commission 3 % = 0,29 €)", prodOk === 2);
  check("2 PIs caution en pré-autorisation (jamais débités)", depOk === 2);

  const txs = await dbSelect(
    "transactions",
    `select=type,amount,status&participation_id=in.(${paid.map((p) => `"${p.id}"`).join(",")})`,
  );
  const prodTxs = txs.filter((t) => t.type === "product_payment");
  check("2 transactions product_payment tracées", prodTxs.length === 2, txs.map((t) => t.type).join(", "));
}

// ============================================================================
// Scénario D — No-show : caution capturée / libérée au retrait
// ============================================================================
async function scenarioD() {
  console.log("\n=== D. No-show : caution capturée / libérée au retrait ===");
  const camille = await authUser("organisateur@voizy.test", "Camille");

  // Reprendre la commande confirmée du scénario C. Les 2 gagnants de la course
  // au seuil (C) sont aléatoires : le scénario est agnostique (n'importe quels
  // 2 participants payés), l'un est no-show, l'autre présent.
  const orders = await dbSelect(
    "group_orders",
    `select=id&merchant_id=eq.${EPICERIE}&status=eq.confirmed&order=created_at.desc&limit=1`,
  );
  if (orders.length === 0) {
    fail("aucune commande confirmée trouvée (scénario C a-t-il réussi ?)");
    return;
  }
  const orderId = orders[0].id;
  const parts = await dbSelect(
    "participations",
    `select=id,user_id,deposit_pi_id,deposit_status&group_order_id=eq.${orderId}&status=eq.paid`,
  );
  if (parts.length !== 2) { fail(`attendu 2 participations payées, trouvé ${parts.length}`); return; }
  const [noShowPart, presentPart] = parts;
  note(`no-show : ${noShowPart.user_id.slice(0, 8)}… / présent : ${presentPart.user_id.slice(0, 8)}…`);

  const cp = await callFn(
    "confirm-pickup",
    { group_order_id: orderId, no_show_user_ids: [noShowPart.id] },
    camille.access_token,
  );
  check(
    "confirm-pickup accepté (organisateur)",
    cp.status === 200 && cp.data?.captured === 1 && cp.data?.released === 1 && cp.data?.no_shows === 1,
    JSON.stringify(cp.data),
  );

  const depNoShow = await getPi(noShowPart.deposit_pi_id);
  const depPresent = await getPi(presentPart.deposit_pi_id);
  check("caution no-show CAPTURÉE", depNoShow.status === "succeeded" && depNoShow.amount_received === 500, depNoShow.status);
  check("caution présent LIBÉRÉE", depPresent.status === "canceled", depPresent.status);

  const fp = (await dbSelect("participations", `select=status,deposit_status&id=eq.${noShowPart.id}`))[0];
  const pp = (await dbSelect("participations", `select=status,deposit_status&id=eq.${presentPart.id}`))[0];
  check(
    "statuts en base : no_show/captured + completed/released",
    fp.status === "no_show" && fp.deposit_status === "captured" &&
      pp.status === "completed" && pp.deposit_status === "released",
  );

  // Les participations portent aussi leur product_payment (scénario C) : on
  // isole les traces de caution propres au retrait.
  const txs = await dbSelect(
    "transactions",
    `select=type,amount&participation_id=in.("${noShowPart.id}","${presentPart.id}")`,
  );
  const depositTypes = txs.map((t) => `${t.type}(${t.amount})`).filter((t) => t.startsWith("deposit_")).sort();
  check(
    "traces caution : deposit_capture(+5) et deposit_release(-5)",
    JSON.stringify(depositTypes) === JSON.stringify(["deposit_capture(5)", "deposit_release(-5)"]),
    depositTypes.join(", "),
  );

  const o = (await dbSelect("group_orders", `select=status,completed_at&id=eq.${orderId}`))[0];
  check("commande terminée", o.status === "completed", o.completed_at);
}

// ============================================================================
// Scénario E — 3-D Secure : échec propre, rien n'est débité
// ============================================================================
async function scenarioE() {
  console.log("\n=== E. 3-D Secure : échec propre (PIs annulés, compteur intact) ===");
  const camille = await authUser("organisateur@voizy.test", "Camille");
  const p3 = await authUser("participant3@voizy.test", "Léa");

  const offer = (await dbSelect("offers", `select=id&merchant_id=eq.${EPICERIE}&title=eq.Pack test E2E&limit=1`))[0];
  const order = await createOrder(camille.access_token, EPICERIE, offer.id);
  check("commande créée pour le test 3DS", order.status === "open", order.id);

  const customer = await ensureCustomer(p3.user.id, p3.user.email);
  await attachCard(customer, "4000002500003155"); // carte exigeant l'authentification

  const join = await callFn("join-order", { group_order_id: order.id }, p3.access_token);
  check(
    "join refusé : authentification bancaire demandée (3-D Secure)",
    join.status === 402 && /3-D Secure|authenti|réessayez/i.test(join.data?.error ?? ""),
    join.data?.error,
  );

  const o = (await dbSelect("group_orders", `select=participants_current,status&id=eq.${order.id}`))[0];
  check("compteur intact (0) + commande toujours ouverte", o.participants_current === 0 && o.status === "open");

  const parts = await dbSelect("participations", `select=id,status&group_order_id=eq.${order.id}`);
  check("participation annulée (pending → cancelled)", parts.length === 1 && parts[0].status === "cancelled", parts[0]?.status);

  // Les éventuels PIs créés puis avortés doivent être « canceled » (rien débité) ;
  // selon le mode off_session, Stripe peut refuser dès la création (0 PI).
  const createdAfter = Math.floor((Date.now() - 10 * 60_000) / 1000);
  const all = await stripeReq("GET", `/v1/payment_intents?limit=100&created[gte]=${createdAfter}`);
  const related = (all.data ?? []).filter((pi) => pi.metadata?.participation_id === parts[0]?.id);
  check(
    "aucun PI actif : annulés ou jamais créés (0 débit)",
    related.length === 0 || related.every((pi) => pi.status === "canceled" && pi.amount_received === 0),
    related.map((pi) => `${pi.metadata?.kind}=${pi.status}`).join(", ") || "0 PI créé",
  );

  const txs = await dbSelect("transactions", `select=id&participation_id=eq.${parts[0].id}`);
  check("aucune transaction enregistrée", txs.length === 0);
}

// ============================================================================
// Scénario F — Seuil non atteint : close-order (cron)
// ============================================================================
async function scenarioF() {
  console.log("\n=== F. Seuil non atteint : close-order (cron) ===");
  const camille = await authUser("organisateur@voizy.test", "Camille");
  const p1 = await authUser("participant@voizy.test", "Nadia");

  const offer = (await dbSelect("offers", `select=id&merchant_id=eq.${EPICERIE}&title=eq.Pack test E2E&limit=1`))[0];
  const order = await createOrder(camille.access_token, EPICERIE, offer.id);
  check("commande créée (seuil 2)", order.status === "open", order.id);

  const customer = await ensureCustomer(p1.user.id, p1.user.email);
  await attachCard(customer, "4242424242424242");
  const join = await callFn("join-order", { group_order_id: order.id }, p1.access_token);
  check("1 participant rejoint (1/2, seuil non atteint)", join.status === 200 && join.data?.threshold_reached === false);

  const part = (await dbSelect(
    "participations",
    `select=id,status,product_pi_id,deposit_pi_id,deposit_status&group_order_id=eq.${order.id}`,
  ))[0];
  const prodBefore = await getPi(part.product_pi_id);
  const depBefore = await getPi(part.deposit_pi_id);
  check(
    "pré-autorisations en attente (rien débité)",
    prodBefore.status === "requires_capture" && depBefore.status === "requires_capture",
    `produit=${prodBefore.status} caution=${depBefore.status}`,
  );

  // Le créneau passe → le cron close-order prend la main
  await dbUpdate("group_orders", `id=eq.${order.id}`, { pickup_at: past() });
  const close = await callFn("close-order", {}, ANON);
  check("close-order exécuté", close.status === 200 && close.data?.ok, JSON.stringify(close.data));

  const o = (await dbSelect("group_orders", `select=status,cancelled_reason,cancelled_at&id=eq.${order.id}`))[0];
  check("commande annulée (threshold_not_reached)", o.status === "cancelled" && o.cancelled_reason === "threshold_not_reached");

  const prod = await getPi(part.product_pi_id);
  const dep = await getPi(part.deposit_pi_id);
  check("pré-autorisations ANNULÉES (aucun débit)", prod.status === "canceled" && dep.status === "canceled", `produit=${prod.status} caution=${dep.status}`);

  const txs = await dbSelect("transactions", `select=type,amount,status&participation_id=eq.${part.id}`);
  const types = txs.map((t) => `${t.type}(${t.amount})`).sort();
  check(
    "traces : product_release + deposit_release, aucun product_payment",
    JSON.stringify(types) === JSON.stringify(["deposit_release(-5)", "product_release(-9.5)"]),
    types.join(", "),
  );
}

// ============================================================================
// Exécution séquentielle
// ============================================================================
const scenarios = [scenarioA, scenarioB, scenarioC, scenarioD, scenarioE, scenarioF];
const only = process.argv[2];
for (const s of scenarios) {
  if (only && !s.name.toLowerCase().endsWith(only.toLowerCase())) continue;
  try {
    await s();
  } catch (err) {
    fail(`${s.name} a échoué : ${err.message}`);
  }
}

console.log(`\n${"=".repeat(60)}`);
console.log(`Résultat : ${passed} ✅ / ${failed} ❌`);
console.log("=".repeat(60));
process.exit(failed > 0 ? 1 : 0);