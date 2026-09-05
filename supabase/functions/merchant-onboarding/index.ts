// merchant-onboarding — mode concierge : crée le compte Connect Express d'un
// commerçant partenaire et renvoie le lien d'onboarding Stripe à lui faire
// compléter. Appelé par le back-office web (gestionnaire) ou par l'équipe
// (service_role) pendant la phase concierge.
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
  stripe_account_id: string | null;
}

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  try {
    const body = (await req.json().catch(() => ({}))) as {
      merchant_id?: string;
      return_url?: string;
      refresh_url?: string;
    };
    if (!body.merchant_id) return json({ ok: false, error: "merchant_id manquant" }, 400);

    const admin = adminClient();
    const user = await currentUser(req);
    const service = isServiceCall(req);

    const { data: merchant } = await admin
      .from("merchants")
      .select("id, name, manager_id, stripe_account_id")
      .eq("id", body.merchant_id)
      .single() as { data: MerchantRow | null };

    if (!merchant) return json({ ok: false, error: "Commerçant introuvable." }, 404);

    // Autorisation : le gestionnaire du commerçant, ou l'équipe (service_role).
    const isManager = user !== null && merchant.manager_id === user.id;
    if (!isManager && !service) {
      return json({ ok: false, error: "Accès réservé au gestionnaire du commerçant." }, 403);
    }

    // --- Compte Connect Express (une seule fois, réutilisé ensuite)
    let accountId = merchant.stripe_account_id;
    if (!accountId) {
      const account = await stripePost("/v1/accounts", {
        type: "express",
        country: "FR",
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        business_profile: { name: merchant.name, url: "https://voizy.app" },
        metadata: { merchant_id: merchant.id, voizy: "true" },
      });
      accountId = account.id as string;
      await admin
        .from("merchants")
        .update({ stripe_account_id: accountId, status: "onboarding" })
        .eq("id", merchant.id);
    }

    // --- Lien d'onboarding (retour vers le back-office web par défaut)
    const returnUrl = safeUrl(body.return_url, "http://127.0.0.1:5173/concierge");
    const refreshUrl = safeUrl(body.refresh_url, "http://127.0.0.1:5173/concierge");

    const link = await stripePost("/v1/account_links", {
      account: accountId,
      type: "account_onboarding",
      return_url: returnUrl,
      refresh_url: refreshUrl,
    });

    return json({ ok: true, url: link.url, account_id: accountId });
  } catch (err) {
    console.error("merchant-onboarding", err);
    const msg = err instanceof Error ? err.message : "Erreur interne";
    return json({ ok: false, error: msg }, 500);
  }
});