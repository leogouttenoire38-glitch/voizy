// _shared/settle.ts — settlement idempotent : capture les PaymentIntents
// « produit » d'une commande confirmée (seuil atteint).
//
// Appelé par join-order (seuil atteint pendant qu'un participant rejoint) et
// par close-order (échéance atteinte), donc conçu pour être rejoué sans effet
// de bord : chaque participation n'est capturée qu'une fois (product_captured_at).

import { stripeGet, stripePost } from "./stripe.ts";

interface OrderRow {
  id: string;
  status: string;
  commission_rate: number;
}

interface ParticipationRow {
  id: string;
  user_id: string;
  amount: number;
  product_pi_id: string | null;
  product_captured_at: string | null;
}

/**
 * Capture tous les paiements produit non encore capturés d'une commande.
 * @returns { captured, failed, error? }
 */
export async function settleOrder(
  admin: ReturnType<typeof import("./supabase.ts").adminClient>,
  groupOrderId: string,
): Promise<{ captured: number; failed: number; error?: string }> {
  const { data: order } = await admin
    .from("group_orders")
    .select("id, status, commission_rate")
    .eq("id", groupOrderId)
    .single();
  if (!order || order.status !== "confirmed") {
    return { captured: 0, failed: 0, error: "Commande non confirmée." };
  }

  const { data: participations } = await admin
    .from("participations")
    .select("id, user_id, amount, product_pi_id, product_captured_at")
    .eq("group_order_id", groupOrderId)
    .eq("status", "paid");

  let captured = 0;
  let failed = 0;

  for (const p of (participations ?? []) as ParticipationRow[]) {
    if (!p.product_pi_id || p.product_captured_at) continue;
    try {
      const captured = await stripePost(`/v1/payment_intents/${p.product_pi_id}/capture`, {});
      await admin
        .from("participations")
        .update({ product_captured_at: new Date().toISOString() })
        .eq("id", p.id);

      const { data: existing } = await admin
        .from("transactions")
        .select("id")
        .eq("stripe_ref", p.product_pi_id)
        .limit(1);
      if (!existing || existing.length === 0) {
        // Décomposition économique — mêmes règles que join-order (le taux est
        // le snapshot de la commande) pour que net_transfer == transfer_data.amount.
        const gross = Number(p.amount) ?? 0;
        const rate = Number((order as OrderRow | null)?.commission_rate ?? 0.05);
        const commission = Math.round(gross * 100 * rate) / 100;
        const feeEstimated = (Math.floor(Math.round(gross * 100) * 0.015) + 25) / 100;
        const net = Math.round((gross - commission - feeEstimated) * 100) / 100;
        const realFee = await readRealFee(captured, p.product_pi_id);

        await admin.from("transactions").insert({
          participation_id: p.id,
          user_id: p.user_id,
          type: "product_payment",
          amount: p.amount,
          gross_amount: gross,
          commission_amount: commission,
          stripe_fee_estimated: feeEstimated,
          stripe_fee_real: realFee,
          net_transfer: net,
          stripe_ref: p.product_pi_id,
          status: "succeeded",
        });
      }
      captured++;
    } catch (err) {
      console.error("settle capture", p.product_pi_id, err);
      failed++;
    }
  }

  return { captured, failed };
}

/**
 * Frais Stripe réels d'une capture : charge → balance_transaction → fee.
 * Retourne null si indisponible (test mode, latence, …) — on garde alors
 * l'estimation calculée côté join-order.
 */
async function readRealFee(
  captured: Record<string, unknown>,
  productPiId: string,
): Promise<number | null> {
  try {
    const chargeId = (captured.latest_charge as string | null) ?? null;
    if (!chargeId) return null;
    const charge = await stripeGet(`/v1/charges/${chargeId}`);
    const btId = (charge.balance_transaction as string | null) ?? null;
    if (!btId) return null;
    const bt = await stripeGet(`/v1/balance_transactions/${btId}`);
    const feeCents = Number(bt.fee ?? 0);
    return Number.isFinite(feeCents) ? feeCents / 100 : null;
  } catch (err) {
    console.error("settle real fee", productPiId, err);
    return null;
  }
}