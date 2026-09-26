// stripe-webhook — reçoit les événements Stripe et synchronise la base.
//
// Événements traités :
//  - account.updated                  → statut du commerçant (onboarding Connect)
//  - payment_intent.succeeded         → capture produit (seuil atteint) ou
//                                       caution (no-show)
//  - payment_intent.canceled          → libération de caution (retrait) ou
//                                       annulation (seuil non atteint)
//  - customer.subscription.created/updated/deleted
//                                     → palier d'abonnement du commerçant
//                                       (merchant_plan) : la source de vérité
//                                       du plan free/pro. Voizy se rémunère
//                                       par abonnement, JAMAIS par commission.
//
// Les transitions principales sont déjà faites par les Edge Functions ; ce
// webhook est la ceinture-bretelles (idempotent) : il corrige la base si un
// événement Stripe a eu lieu sans que l'app le sache.
import { handleOptions, json } from "../_shared/cors.ts";
import { adminClient } from "../_shared/supabase.ts";
import { verifyStripeWebhook } from "../_shared/stripe.ts";

// ---------------------------------------------------------------------------
// Abonnement commerçant (Stripe Billing) — palier free / pro de merchant_plan
// ---------------------------------------------------------------------------
type AdminClient = ReturnType<typeof adminClient>;

type PlanStatus = "inactive" | "active" | "past_due" | "canceled";

/** Traduit un statut d'abonnement Stripe vers le vocabulaire Voizy. */
function planStatus(stripeStatus: string | undefined): PlanStatus {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
      return "canceled";
    default:
      // incomplete, incomplete_expired, unpaid, paused…
      return "inactive";
  }
}

async function syncMerchantPlan(admin: AdminClient, eventType: string, obj: Record<string, unknown>) {
  const sub = obj as {
    id?: string;
    customer?: string | { id?: string };
    status?: string;
    current_period_end?: number;
    metadata?: Record<string, string>;
  };
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;

  // Le merchant_id voyage dans les metadata (posées par merchant-subscribe) ;
  // à défaut on retombe sur le customer de facturation déjà connu.
  let merchantId = sub.metadata?.merchant_id ?? null;
  if (!merchantId && customerId) {
    const { data } = await admin
      .from("merchant_plan")
      .select("merchant_id")
      .eq("stripe_customer_id", customerId)
      .limit(1);
    merchantId = (data?.[0]?.merchant_id as string | undefined) ?? null;
  }
  if (!merchantId) {
    console.error("stripe-webhook subscription sans merchant_id", sub.id, customerId);
    return;
  }

  const deleted = eventType === "customer.subscription.deleted";
  const status: PlanStatus = deleted ? "canceled" : planStatus(sub.status);
  const isPro = status === "active" || status === "past_due";
  const periodEnd = sub.current_period_end
    ? new Date(sub.current_period_end * 1000).toISOString()
    : null;

  // Le customer de facturation est créé par merchant-subscribe : on ne l'écrase
  // jamais avec la valeur d'un événement (un customer inconnu ferait ensuite
  // échouer le Checkout « No such customer »). On le complète seulement s'il
  // manque encore.
  const { data: existing } = await admin
    .from("merchant_plan")
    .select("stripe_customer_id")
    .eq("merchant_id", merchantId)
    .single();

  await admin.from("merchant_plan").upsert({
    merchant_id: merchantId,
    plan: isPro ? "pro" : "free",
    status,
    stripe_customer_id: (existing?.stripe_customer_id as string | null) ?? customerId,
    // Conservé même après résiliation (traçage ; remplacé par le prochain abonnement).
    stripe_subscription_id: sub.id ?? null,
    // La période n'est renseignée que pour un abonnement réellement en cours.
    current_period_end: isPro ? periodEnd : null,
  }, { onConflict: "merchant_id" });
}

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  try {
    const rawBody = await req.text();
    const valid = await verifyStripeWebhook(rawBody, req.headers.get("stripe-signature"));
    if (!valid) return json({ error: "Signature invalide" }, 401);

    const event = JSON.parse(rawBody) as { id: string; type: string; data: { object: Record<string, unknown> } };
    const obj = event.data.object;
    const admin = adminClient();

    switch (event.type) {
      case "account.updated": {
        // Onboarding Connect Express terminé ? → commerçant « active ».
        const account = obj as { id?: string; details_submitted?: boolean; charges_enabled?: boolean; payouts_enabled?: boolean };
        if (!account.id) break;
        const ready = Boolean(
          account.details_submitted && account.charges_enabled && account.payouts_enabled,
        );
        await admin
          .from("merchants")
          .update({ status: ready ? "active" : "pending" })
          .eq("stripe_account_id", account.id);
        break;
      }

      case "payment_intent.succeeded": {
        const pi = obj as { id?: string; metadata?: Record<string, string> };
        const kind = pi.metadata?.kind;
        const participationId = pi.metadata?.participation_id;
        if (!participationId) break;

        if (kind === "product") {
          await admin
            .from("participations")
            .update({ product_captured_at: new Date().toISOString() })
            .eq("id", participationId)
            .is("product_captured_at", null);
        } else if (kind === "deposit") {
          // Capture de caution (no-show) : déjà traitée par confirm-pickup.
          const { data: existing } = await admin
            .from("transactions")
            .select("id")
            .eq("stripe_ref", pi.id)
            .limit(1);
          if (!existing || existing.length === 0) {
            const { data: part } = await admin
              .from("participations")
              .select("user_id, deposit_amount")
              .eq("id", participationId)
              .single();
            if (part) {
              await admin.from("transactions").insert({
                participation_id: participationId,
                user_id: part.user_id as string,
                type: "deposit_capture",
                amount: part.deposit_amount as number,
                stripe_ref: pi.id,
                status: "succeeded",
              });
            }
          }
        }
        break;
      }

      case "payment_intent.canceled": {
        const pi = obj as { id?: string; metadata?: Record<string, string> };
        const kind = pi.metadata?.kind;
        const participationId = pi.metadata?.participation_id;
        if (!participationId || kind !== "deposit") break;

        const { data: part } = await admin
          .from("participations")
          .select("id, user_id, deposit_amount, deposit_status")
          .eq("id", participationId)
          .single();
        if (!part || part.deposit_status !== "held") break;

        await admin
          .from("participations")
          .update({ deposit_status: "released" })
          .eq("id", participationId);

        const { data: existing } = await admin
          .from("transactions")
          .select("id")
          .eq("stripe_ref", pi.id)
          .limit(1);
        if (!existing || existing.length === 0) {
          await admin.from("transactions").insert({
            participation_id: participationId,
            user_id: part.user_id as string,
            type: "deposit_release",
            amount: -Number(part.deposit_amount),
            stripe_ref: pi.id,
            status: "succeeded",
          });
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await syncMerchantPlan(admin, event.type, obj);
        break;
      }

      default:
        break;
    }

    return json({ received: true });
  } catch (err) {
    console.error("stripe-webhook", err);
    return json({ error: "Erreur interne" }, 500);
  }
});