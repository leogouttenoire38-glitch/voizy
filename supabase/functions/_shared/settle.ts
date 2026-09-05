// _shared/settle.ts — settlement idempotent : capture les PaymentIntents
// « produit » d'une commande confirmée (seuil atteint).
//
// Appelé par join-order (seuil atteint pendant qu'un participant rejoint) et
// par close-order (échéance atteinte), donc conçu pour être rejoué sans effet
// de bord : chaque participation n'est capturée qu'une fois (product_captured_at).

import { stripePost } from "./stripe.ts";

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
    .select("id, status")
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
      await stripePost(`/v1/payment_intents/${p.product_pi_id}/capture`, {});
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
        await admin.from("transactions").insert({
          participation_id: p.id,
          user_id: p.user_id,
          type: "product_payment",
          amount: p.amount,
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