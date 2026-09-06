// join-order — un participant rejoint une commande groupée.
//
// 1. RPC join_group_order  → participation « pending_payment » (atomique, verrou
//    SELECT ... FOR UPDATE sur la commande : pas de double validation de seuil).
// 2. Vérifie le compte Connect Express du commerçant (stripe_account_id).
// 3. Vérifie que le participant a une carte enregistrée (setup-payment).
// 4. Crée 2 PaymentIntents en CAPTURE MANUELLE (aucun débit tant qu'ils ne sont
//    pas capturés) transférés vers le compte Connect du commerçant :
//      - produit  : montant groupé — transfert NET au commerçant, commission
//                   Voizy et frais Stripe déduits (voir ci-dessous)
//      - caution  : pré-autorisation remboursable (libérée au retrait)
//
//    Les frais de traitement Stripe sont à la charge du commerçant :
//    `transfer_data.amount` = montant − commission Voizy − frais Stripe estimés.
//    Les destination charges étant TOUJOURS facturées à la plateforme par
//    Stripe (l'option « Stripe prélève les frais aux comptes connectés » ne
//    concerne que les direct charges), la réduction du transfert est le
//    mécanisme qui fait porter les frais au commerçant. NB : Stripe interdit de
//    combiner `application_fee_amount` et `transfer_data[amount]` (mutuellement
//    exclusifs) — la commission est donc intégrée au calcul du transfert net.
//    La caution n'est jamais débitée au retrait normal (annulation de
//    pré-autorisation = zéro frais) ; en no-show, sa capture supporte les
//    frais, côté commerçant.
// 5. RPC confirm_participation → compteur + seuil (éventuel statut confirmed).
// 6. Si le seuil est atteint → capture des paiements produit de TOUS les
//    participants (settle). Les cautions, elles, ne sont jamais débitées.
//
// En cas d'échec à n'importe quelle étape : annulation des PaymentIntents déjà
// créés + suppression de la participation (rien n'est débité, compteur intact).
import { handleOptions, json } from "../_shared/cors.ts";
import { adminClient, currentUser } from "../_shared/supabase.ts";
import {
  cents,
  DEFAULT_COMMISSION_RATE,
  ensureCustomer,
  firstCard,
  stripePost,
  stripeProcessingFeeCents,
} from "../_shared/stripe.ts";
import { settleOrder } from "../_shared/settle.ts";

interface ParticipationRow {
  id: string;
  group_order_id: string;
  user_id: string;
  amount: number;
  deposit_amount: number;
}

interface OrderRow {
  id: string;
  merchant_id: string;
  status: string;
  participants_current: number;
  threshold: number;
  title: string;
  commission_rate: number;
}

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  try {
    const user = await currentUser(req);
    if (!user) return json({ ok: false, error: "Authentification requise." }, 401);

    const { group_order_id } = (await req.json().catch(() => ({}))) as { group_order_id?: string };
    if (!group_order_id) return json({ ok: false, error: "group_order_id manquant" }, 400);

    const admin = adminClient();
    const currency = Deno.env.get("STRIPE_CURRENCY") ?? "eur";

    // ---- 1. Réservation atomique de la participation
    const { data: joinRes, error: joinErr } = await admin.rpc("join_group_order", {
      p_group_order_id: group_order_id,
      p_user_id: user.id,
    });
    if (joinErr || !joinRes?.ok) {
      return json({ ok: false, error: joinRes?.error ?? joinErr?.message ?? "Impossible de rejoindre." }, 409);
    }

    const participation = joinRes.participation as ParticipationRow;
    const order = joinRes.order as OrderRow;
    const createdPIs: string[] = [];

    const cleanup = async (message: string) => {
      for (const pi of createdPIs) {
        try {
          await stripePost(`/v1/payment_intents/${pi}/cancel`, { cancellation_reason: "abandoned" });
        } catch (err) {
          console.error("join-order cleanup PI", pi, err);
        }
      }
      try {
        await admin.rpc("cancel_participation", {
          p_group_order_id: group_order_id,
          p_user_id: user.id,
          p_reason: "payment_failed",
        });
      } catch (err) {
        console.error("join-order cleanup participation", err);
      }
      return json({ ok: false, error: message }, 402);
    };

    // ---- 2. Compte Connect du commerçant
    // NB : le taux de commission utilisé est le SNAPSHOT de la commande
    // (order.commission_rate, figé à la création) — c'est lui qui est aussi
    // retracé par settle dans transactions.commission_amount.
    const { data: merchant } = await admin
      .from("merchants")
      .select("stripe_account_id, status")
      .eq("id", order.merchant_id)
      .single();
    const accountId = merchant?.stripe_account_id as string | null;
    if (!accountId || merchant?.status !== "active") {
      return cleanup("Ce commerçant n'est pas encore connecté aux paiements (onboarding Stripe en cours).");
    }

    // ---- 3. Carte du participant
    const customerId = await ensureCustomer(admin, user.id, user.email);
    const card = await firstCard(customerId);
    if (!card) {
      return json({
        ok: false,
        action: "setup_required",
        error: "Enregistrez d'abord votre carte pour participer.",
      }, 402);
    }

    // ---- 4. PaymentIntents (produit + caution), capture manuelle, vers le commerçant
    // (off_session n'est légal qu'au moment du confirm — pas à la création.)
    const common = {
      currency,
      customer: customerId,
      payment_method: card.id,
      confirm: false,
      capture_method: "manual",
      transfer_data: { destination: accountId }, // amount surchargé par PI ci-dessous
      on_behalf_of: accountId,
      metadata: {
        group_order_id,
        participation_id: participation.id,
        user_id: user.id,
      },
    };

    const productAmount = cents(participation.amount);
    const rate = Number(order.commission_rate ?? DEFAULT_COMMISSION_RATE);
    const commissionCents = Math.round(productAmount * rate); // commission Voizy (5 % par défaut)
    const productStripeFee = stripeProcessingFeeCents(productAmount); // frais Stripe, à la charge du commerçant
    // Transfert net : montant − commission − frais Stripe (le commerçant reçoit
    // ce qu'il aurait sur un terminal classique ; la plateforme reverse les
    // frais sur sa part et conserve la commission).
    const productTransfer = Math.max(0, productAmount - commissionCents - productStripeFee);

    const depositAmount = cents(participation.deposit_amount);
    const depositStripeFee = stripeProcessingFeeCents(depositAmount); // prélevés seulement si capturée (no-show)
    const depositTransfer = Math.max(0, depositAmount - depositStripeFee);

    // Création SANS confirmation : on garde les ids pour pouvoir tout annuler
    // proprement si une étape échoue (3-D Secure, carte refusée, …).
    const confirmParams = { off_session: true };
    const confirm = (pi: Record<string, unknown> | null) =>
      pi ? stripePost(`/v1/payment_intents/${pi.id as string}/confirm`, confirmParams) : null;

    // Caution d'abord (pré-autorisation la plus critique pour l'anti-no-show).
    let depositPi: Record<string, unknown> | null = null;
    if (depositAmount > 0) {
      try {
        depositPi = await stripePost("/v1/payment_intents", {
          ...common,
          confirm: false,
          amount: depositAmount,
          transfer_data: { destination: accountId, amount: depositTransfer },
          description: `Caution — ${order.title} (commande ${group_order_id})`,
          metadata: { ...common.metadata, kind: "deposit" },
        });
        createdPIs.push(depositPi.id as string);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Échec de la pré-autorisation de caution.";
        return cleanup(`Paiement refusé : ${msg}`);
      }
    }

    let productPi: Record<string, unknown> | null = null;
    try {
      productPi = await stripePost("/v1/payment_intents", {
        ...common,
        confirm: false,
        amount: productAmount,
        transfer_data: { destination: accountId, amount: productTransfer },
        description: `Achat groupé — ${order.title} (commande ${group_order_id})`,
        metadata: { ...common.metadata, kind: "product" },
      });
      createdPIs.push(productPi.id as string);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Échec du paiement.";
      return cleanup(`Paiement refusé : ${msg}`);
    }

    // Confirmation explicite (caution puis produit) — tout échec annule les PIs.
    try {
      depositPi = await confirm(depositPi);
      productPi = await confirm(productPi);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Échec de la confirmation.";
      return cleanup(`Paiement refusé : ${msg}`);
    }

    // 3-D Secure : la carte enregistrée peut demander une confirmation.
    // MVP : on annule proprement et on invite à réessayer (limite documentée).
    for (const pi of [depositPi, productPi]) {
      if (pi && pi.status === "requires_action") {
        return cleanup("Votre banque demande une confirmation (3-D Secure). Réessayez dans un instant.");
      }
    }

    // ---- 5. Confirmation atomique (compteur + éventuel seuil)
    const { data: confirmRes, error: confirmErr } = await admin.rpc("confirm_participation", {
      p_group_order_id: group_order_id,
      p_user_id: user.id,
      p_product_pi: productPi.id as string,
      p_deposit_pi: depositPi?.id ?? null,
    });
    if (confirmErr || !confirmRes?.ok) {
      return cleanup(confirmRes?.error ?? confirmErr?.message ?? "Confirmation impossible.");
    }

    // ---- 6. Seuil atteint → capture des paiements produit (settle)
    if (confirmRes.threshold_reached) {
      const settle = await settleOrder(admin, group_order_id);
      if (settle.error) {
        console.error("join-order settle", settle.error);
      }
    }

    return json({
      ok: true,
      participation,
      order: confirmRes.order,
      threshold_reached: Boolean(confirmRes.threshold_reached),
    });
  } catch (err) {
    console.error("join-order", err);
    const msg = err instanceof Error ? err.message : "Erreur interne";
    return json({ ok: false, error: msg }, 500);
  }
});