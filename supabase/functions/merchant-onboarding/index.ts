// merchant-onboarding — compte de paiement (Stripe Connect Express) du
// commerçant. Deux usages, mêmes autorisations :
//
//   action = "link"   (défaut) : renvoie le lien hébergé Stripe à ouvrir pour
//                               finaliser le compte de paiement (créé au
//                               premier appel, réutilisé ensuite).
//   action = "status"          : interroge Stripe et renvoie où en est le
//                               commerçant. Si Stripe confirme que tout est
//                               prêt, le commerce passe « active » tout de
//                               suite (la personne vient de terminer, elle ne
//                               doit pas attendre un webhook pour le voir).
//
// Appelable par le gérant du commerce (mobile comme web) ou par l'équipe
// (service_role). Aucune donnée bancaire ne transite ici : Stripe héberge tout.
import { handleOptions, json } from "../_shared/cors.ts";
import { adminClient, currentUser, isServiceCall } from "../_shared/supabase.ts";
import { connectAccountReady, stripeGet, stripePost } from "../_shared/stripe.ts";

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
  status: string;
}

/** Un commerçant mis en pause par l'équipe ne doit JAMAIS être réactivé par un
 *  simple rafraîchissement de statut : la pause est une décision humaine. */
async function promoteIfReady(
  admin: ReturnType<typeof adminClient>,
  merchant: MerchantRow,
  ready: boolean,
): Promise<string> {
  if (!ready || merchant.status === "active" || merchant.status === "paused") {
    return merchant.status;
  }
  await admin.from("merchants").update({ status: "active" }).eq("id", merchant.id);
  return "active";
}

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  try {
    const body = (await req.json().catch(() => ({}))) as {
      merchant_id?: string;
      action?: string;
      return_url?: string;
      refresh_url?: string;
    };
    if (!body.merchant_id) return json({ ok: false, error: "merchant_id manquant" }, 400);
    const action = body.action === "status" ? "status" : "link";

    const admin = adminClient();
    const user = await currentUser(req);
    const service = isServiceCall(req);

    const { data: merchant } = await admin
      .from("merchants")
      .select("id, name, manager_id, stripe_account_id, status")
      .eq("id", body.merchant_id)
      .single() as { data: MerchantRow | null };

    if (!merchant) return json({ ok: false, error: "Commerçant introuvable." }, 404);

    // Autorisation : le gestionnaire du commerçant, ou l'équipe (service_role).
    const isManager = user !== null && merchant.manager_id === user.id;
    if (!isManager && !service) {
      return json({ ok: false, error: "Accès réservé au gestionnaire du commerçant." }, 403);
    }

    // --- Vérification de statut : où en est le compte de paiement ?
    if (action === "status") {
      const base = {
        ok: true as const,
        merchant_id: merchant.id,
        has_account: Boolean(merchant.stripe_account_id),
        account_id: merchant.stripe_account_id,
        details_submitted: false,
        charges_enabled: false,
        payouts_enabled: false,
        ready: false,
        merchant_status: merchant.status,
      };
      if (!merchant.stripe_account_id) return json(base);
      // Déjà actif : inutile de solliciter Stripe à chaque affichage d'écran.
      if (merchant.status === "active") {
        return json({ ...base, details_submitted: true, ready: true });
      }

      const account = await stripeGet(`/v1/accounts/${merchant.stripe_account_id}`) as {
        details_submitted?: boolean;
        charges_enabled?: boolean;
        payouts_enabled?: boolean;
      };
      const ready = connectAccountReady(account);
      const merchantStatus = await promoteIfReady(admin, merchant, ready);

      return json({
        ...base,
        details_submitted: Boolean(account.details_submitted),
        charges_enabled: Boolean(account.charges_enabled),
        payouts_enabled: Boolean(account.payouts_enabled),
        ready,
        merchant_status: merchantStatus,
      });
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

    return json({ ok: true, url: link.url, account_id: accountId, merchant_status: "onboarding" });
  } catch (err) {
    console.error("merchant-onboarding", err);
    const msg = err instanceof Error ? err.message : "Erreur interne";
    return json({ ok: false, error: msg }, 500);
  }
});
