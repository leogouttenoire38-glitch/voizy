// setup-payment — enregistrement de la carte du participant (paiement + caution).
// Crée le customer Stripe si besoin puis une session Checkout en mode "setup".
// La carte enregistrée est utilisée ensuite off-session par join-order pour
// les PaymentIntents (produit + caution) en capture manuelle.
import { handleOptions, json } from "../_shared/cors.ts";
import { adminClient, currentUser } from "../_shared/supabase.ts";
import { ensureCustomer, firstCard, stripeGet, stripePost } from "../_shared/stripe.ts";

function safeUrl(u: string | undefined, fallback: string): string {
  if (!u) return fallback;
  try {
    const parsed = new URL(u);
    if (parsed.protocol === "https:" || parsed.protocol === "http:" ||
        parsed.protocol === "exp:" || parsed.protocol === "voizy:") {
      return u;
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await currentUser(req);
    if (!user) return json({ ok: false, error: "Authentification requise." }, 401);

    const admin = adminClient();

    if (req.method === "GET") {
      const { data: profile } = await admin
        .from("users")
        .select("stripe_customer_id")
        .eq("id", user.id)
        .single();
      if (!profile?.stripe_customer_id) {
        return json({ ok: true, has_payment_method: false, customer_id: null });
      }
      const card = await firstCard(profile.stripe_customer_id as string);
      return json({
        ok: true,
        has_payment_method: Boolean(card),
        customer_id: profile.stripe_customer_id,
        card: card ? { id: card.id } : null,
      });
    }

    if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

    const body = (await req.json().catch(() => ({}))) as { success_url?: string; cancel_url?: string };
    const successUrl = safeUrl(body.success_url, "voizy://payments?setup=success");
    const cancelUrl = safeUrl(body.cancel_url, "voizy://payments?setup=cancel");

    const customer = await ensureCustomer(admin, user.id, user.email);

    const session = await stripePost("/v1/checkout/sessions", {
      mode: "setup",
      customer,
      success_url: successUrl,
      cancel_url: cancelUrl,
      payment_method_types: ["card"],
      metadata: { user_id: user.id, purpose: "group_order" },
    });

    return json({ ok: true, url: session.url });
  } catch (err) {
    console.error("setup-payment", err);
    const msg = err instanceof Error ? err.message : "Erreur interne";
    return json({ ok: false, error: msg }, 500);
  }
});