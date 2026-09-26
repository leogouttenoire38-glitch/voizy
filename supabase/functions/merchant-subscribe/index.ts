// merchant-subscribe — abonnement commerçant (Stripe Billing, PAS Connect).
//
// MODÈLE ÉCONOMIQUE — Voizy ne prend JAMAIS de pourcentage sur les ventes. La
// seule source de revenu est l'ABONNEMENT du commerçant : cet endpoint crée une
// session Stripe Checkout d'abonnement pour passer du palier « free »
// (1 commande active à la fois) au palier « pro » (commandes illimitées +
// mis en avant dans Découvrir).
//
// L'abonnement est facturé sur la carte du commerçant, sur le compte plateforme
// de Voizy : c'est un flux séparé du compte Connect Express qui reçoit les
// paiements des participants. Rien de l'abonnement ne touche aux transferts.
//
// Le webhook stripe-webhook met à jour merchant_plan sur les événements
// customer.subscription.updated / deleted — c'est lui la source de vérité du
// palier (cette fonction ne fait que créer la session de paiement).
//
// Réglages :
//   STRIPE_PRICE_PRO             id du Price mensuel du palier pro (price_…)
//   app_config.pro_plan_price_eur   tarif affiché côté UI (la facturation
//                                   réelle utilise le Price Stripe ci-dessus)
//   app_config.billing_enabled      false pendant le pilote : l'endpoint refuse
//                                   explicitement (le plan pro est offert)
import { handleOptions, json } from "../_shared/cors.ts";
import { adminClient, currentUser, isServiceCall } from "../_shared/supabase.ts";
import { stripePost } from "../_shared/stripe.ts";

function safeUrl(u: string | undefined, fallback: string): string {
  if (!u) return fallback;
  try {
    const parsed = new URL(u);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") return u;
  } catch {
    /* ignore */
  }
  return fallback;
}

interface MerchantRow {
  id: string;
  name: string;
  manager_id: string | null;
}

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  try {
    const body = (await req.json().catch(() => ({}))) as {
      merchant_id?: string;
      return_url?: string;
      price_id?: string;
    };
    if (!body.merchant_id) return json({ ok: false, error: "merchant_id manquant" }, 400);

    const admin = adminClient();
    const user = await currentUser(req);
    const service = isServiceCall(req);

    const { data: merchant } = (await admin
      .from("merchants")
      .select("id, name, manager_id")
      .eq("id", body.merchant_id)
      .single()) as { data: MerchantRow | null };

    if (!merchant) return json({ ok: false, error: "Commerçant introuvable." }, 404);

    // Autorisation : le gestionnaire du commerçant, ou l'équipe (service_role).
    const isManager = user !== null && merchant.manager_id === user.id;
    if (!isManager && !service) {
      return json({ ok: false, error: "Accès réservé au gestionnaire du commerçant." }, 403);
    }

    // Phase pilote : la facturation est désactivée, le plan pro est offert.
    // L'infrastructure reste en place et s'active sans redéploiement majeur
    // (billing_enabled = true, Price Stripe configuré, Price ID en variable).
    const { data: billing } = await admin
      .from("app_config")
      .select("value")
      .eq("key", "billing_enabled")
      .single();
    if (billing?.value !== true) {
      return json({
        ok: false,
        error: "La facturation n'est pas encore activée : pendant le pilote, le plan Pro est offert à tous les commerçants.",
      }, 409);
    }

    // Price du palier pro : env (production) ou fourni explicitement (tests).
    const priceId = body.price_id ?? Deno.env.get("STRIPE_PRICE_PRO");
    if (!priceId || !priceId.startsWith("price_")) {
      return json({
        ok: false,
        error: "Palier Pro non configuré (STRIPE_PRICE_PRO manquant ou invalide).",
      }, 500);
    }

    // Customer de FACTURATION du commerçant (compte plateforme Voizy) — réutilisé
    // d'une souscription à l'autre, distinct du compte Connect des paiements.
    const { data: plan } = await admin
      .from("merchant_plan")
      .select("stripe_customer_id")
      .eq("merchant_id", merchant.id)
      .single();

    let customerId = (plan?.stripe_customer_id as string | null) ?? null;
    if (!customerId) {
      const customer = await stripePost("/v1/customers", {
        name: merchant.name,
        email: user?.email ?? undefined,
        metadata: { merchant_id: merchant.id, voizy: "true", usage: "merchant_subscription" },
      });
      customerId = customer.id as string;
      await admin
        .from("merchant_plan")
        .upsert({ merchant_id: merchant.id, stripe_customer_id: customerId }, { onConflict: "merchant_id" });
    }

    // Session Checkout d'abonnement : Voizy facture directement le commerçant,
    // sur sa propre carte, hors flux marketplace.
    const returnUrl = safeUrl(body.return_url, "http://127.0.0.1:5173/");
    const session = await stripePost("/v1/checkout/sessions", {
      mode: "subscription",
      locale: "fr",
      customer: customerId,
      client_reference_id: merchant.id,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: returnUrl,
      cancel_url: returnUrl,
      allow_promotion_codes: true,
      metadata: { merchant_id: merchant.id },
      subscription_data: { metadata: { merchant_id: merchant.id } },
    });

    return json({ ok: true, url: session.url, session_id: session.id, price_id: priceId });
  } catch (err) {
    console.error("merchant-subscribe", err);
    const msg = err instanceof Error ? err.message : "Erreur interne";
    return json({ ok: false, error: msg }, 500);
  }
});
