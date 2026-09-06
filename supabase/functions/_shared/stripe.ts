// _shared/stripe.ts — petit client Stripe sans SDK (REST + vérification HMAC).
// Encodage application/x-www-form-urlencoded avec support des tableaux imbriqués
// (ex. capabilities[], line_items[0][price]) requis par l'API Stripe.
// Utilisé par : merchant-onboarding, setup-payment, join-order, settle-order,
// close-order, confirm-pickup, stripe-webhook.
//
// Flux Connect Express (paiement vers le commerçant) : les PaymentIntents sont
// créés avec `transfer_data.destination` = compte Connect du commerçant,
// `on_behalf_of` = même compte, et `transfer_data.amount` = montant NET
// transféré au commerçant (montant − commission Voizy − frais Stripe).
//
// Schéma de frais : les frais de traitement Stripe sont supportés par le
// commerçant (comme sur un terminal classique). Les destination charges sont
// TOUJOURS facturées à la plateforme par Stripe (quelle que soit la valeur de
// `controller.fees.payer`, qui ne concerne que les direct charges), et Stripe
// interdit de combiner `application_fee_amount` avec `transfer_data[amount]`
// (paramètres mutuellement exclusifs). La façon de faire porter les frais au
// commerçant est donc de réduire le transfert : `transfer_data.amount` =
// montant − commission Voizy − frais Stripe estimés. La plateforme reverse
// alors les frais sur sa part et ne conserve que sa commission.

const BASE = "https://api.stripe.com";

function secret(): string {
  const s = Deno.env.get("STRIPE_SECRET_KEY");
  if (!s) throw new Error("STRIPE_SECRET_KEY non configurée");
  return s;
}

function flatten(prefix: string, value: unknown, out: URLSearchParams) {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => flatten(`${prefix}[${i}]`, item, out));
  } else if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      flatten(prefix ? `${prefix}[${k}]` : k, v, out);
    }
  } else {
    out.append(prefix, String(value));
  }
}

function asForm(params: Record<string, unknown>): URLSearchParams {
  const form = new URLSearchParams();
  flatten("", params, form);
  return form;
}

async function stripeFetch(
  path: string,
  init: { method?: string; form?: Record<string, unknown> } = {},
): Promise<Record<string, unknown>> {
  const { method = "GET", form } = init;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret()}`,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? asForm(form) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (data as { error?: { message?: string } }).error?.message ?? `Stripe ${res.status}`;
    throw new Error(`Stripe ${method} ${path} → ${msg}`);
  }
  return data as Record<string, unknown>;
}

export function stripeGet(path: string) {
  return stripeFetch(path);
}

export function stripePost(path: string, form: Record<string, unknown> = {}) {
  return stripeFetch(path, { method: "POST", form });
}

export function stripeDelete(path: string) {
  return stripeFetch(path, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Vérification de signature du webhook (HMAC SHA-256, schéma "t=...,v1=...")
// ---------------------------------------------------------------------------
async function hmacHex(payload: string, key: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyStripeWebhook(
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  const whsec = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!whsec) return false;
  if (!signatureHeader) return false;

  const parts = signatureHeader.split(",").reduce<Record<string, string>>((acc, p) => {
    const [k, v] = p.split("=");
    acc[k.trim()] = (v ?? "").trim();
    return acc;
  }, {});

  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(t)) > 300) return false; // anti-rejeu : 5 min

  const expected = await hmacHex(`${t}.${rawBody}`, whsec);
  return expected === v1;
}

// ---------------------------------------------------------------------------
// Helpers métier
// ---------------------------------------------------------------------------

export function cents(amount: number | null | undefined): number {
  return Math.round(Number(amount ?? 0) * 100);
}

// Commission par défaut appliquée aux commandes (5 %) — le taux réel d'un
// commerçant est stocké dans `merchants.commission_rate` (snapshoté dans
// `group_orders.commission_rate` à la création de la commande).
export const DEFAULT_COMMISSION_RATE = 0.05;

/**
 * Estimation des frais de traitement Stripe (zone euro, cartes UE standard) :
 * 1,5 % + 0,25 €. Partie pourcentage tronquée au centime (9,50 € → 0,14 +
 * 0,25 = 0,39 €). Supportés par le commerçant via transfer_data.amount ; un
 * écart éventuel (interchange, devise) reste à la charge de la plateforme.
 */
export function stripeProcessingFeeCents(amountCents: number): number {
  return Math.floor(amountCents * 0.015) + 25;
}

/** Crée (ou réutilise) le customer Stripe d'un utilisateur. */
export async function ensureCustomer(
  admin: ReturnType<typeof import("./supabase.ts").adminClient>,
  userId: string,
  email?: string,
): Promise<string> {
  const { data: profile } = await admin
    .from("users")
    .select("stripe_customer_id, email, full_name")
    .eq("id", userId)
    .single();

  if (profile?.stripe_customer_id) return profile.stripe_customer_id as string;

  const customer = await stripePost("/v1/customers", {
    email: email ?? profile?.email ?? undefined,
    name: profile?.full_name ?? undefined,
    metadata: { user_id: userId },
  });

  await admin.from("users").update({ stripe_customer_id: customer.id as string }).eq("id", userId);
  return customer.id as string;
}

/** Première carte enregistrée d'un customer (ou null). */
export async function firstCard(customerId: string): Promise<{ id: string } | null> {
  const pms = await stripeGet(`/v1/payment_methods?customer=${customerId}&type=card&limit=1`);
  const cards = (pms.data ?? []) as Array<{ id: string }>;
  return cards[0] ?? null;
}