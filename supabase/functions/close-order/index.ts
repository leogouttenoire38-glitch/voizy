// close-order — cron : clôture les commandes arrivées à échéance.
//
// Pour chaque commande « open » dont pickup_at est dépassé :
//   - seuil atteint  → confirmed (RPC close_expired_order) puis capture des
//     paiements produit (settleOrder, idempotent)
//   - seuil non atteint → cancelled : annulation de TOUTES les pré-autorisations
//     (produit + caution) — aucun débit n'a eu lieu, rien à rembourser.
// Ensuite : file des rappels de retrait (queue_pickup_reminders) pour les
// commandes confirmées dont le créneau approche.
//
// À planifier côté Supabase (Dashboard → Edge Functions → Scheduled, 5 min).
import { handleOptions, json } from "../_shared/cors.ts";
import { adminClient } from "../_shared/supabase.ts";
import { stripePost } from "../_shared/stripe.ts";
import { settleOrder } from "../_shared/settle.ts";

interface OrderRow {
  id: string;
  status: string;
}

interface ParticipationRow {
  id: string;
  user_id: string;
  amount: number;
  deposit_amount: number;
  status: string;
  deposit_status: string;
  product_pi_id: string | null;
  deposit_pi_id: string | null;
}

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  try {
    const admin = adminClient();
    const summary = { checked: 0, confirmed: 0, cancelled: 0, captured: 0, reminders: 0 };

    // ---- 1. Commandes ouvertes à échéance
    const { data: expired } = await admin
      .from("group_orders")
      .select("id, status")
      .eq("status", "open")
      .lte("pickup_at", new Date().toISOString())
      .limit(50);

    for (const row of (expired ?? []) as OrderRow[]) {
      summary.checked++;
      const { data: res, error: err } = await admin.rpc("close_expired_order", {
        p_group_order_id: row.id,
      });
      if (err || !res?.ok) {
        console.error("close_expired_order", row.id, err ?? res?.error);
        continue;
      }

      if (res.status === "confirmed") {
        summary.confirmed++;
        const settle = await settleOrder(admin, row.id);
        summary.captured += settle.captured;
        if (settle.failed > 0) {
          console.error("close-order : captures en échec pour", row.id, settle.failed);
        }
      } else if (res.status === "cancelled") {
        summary.cancelled++;
        await cancelAllAuthorizations(admin, row.id);
      }
    }

    // ---- 2. Rappels de retrait pour les commandes confirmées à venir
    const { data: reminders, error: remErr } = await admin.rpc("queue_pickup_reminders");
    if (!remErr && reminders?.ok) {
      summary.reminders = Number(reminders.reminders ?? 0);
    }

    return json({ ok: true, ...summary });
  } catch (err) {
    console.error("close-order", err);
    return json({ ok: false, error: "Erreur interne" }, 500);
  }
});

/** Annule les pré-autorisations (produit + caution) d'une commande annulée. */
async function cancelAllAuthorizations(
  admin: ReturnType<typeof import("../_shared/supabase.ts").adminClient>,
  groupOrderId: string,
) {
  const { data: participations } = await admin
    .from("participations")
    .select("id, user_id, amount, deposit_amount, status, deposit_status, product_pi_id, deposit_pi_id")
    .eq("group_order_id", groupOrderId)
    .eq("status", "paid");

  for (const p of (participations ?? []) as ParticipationRow[]) {
    const now = new Date().toISOString();

    // Produit : pré-autorisation annulée → jamais débité.
    if (p.product_pi_id) {
      try {
        await stripePost(`/v1/payment_intents/${p.product_pi_id}/cancel`, {
          cancellation_reason: "abandoned",
        });
      } catch (err) {
        console.error("cancel product PI", p.product_pi_id, err);
      }
      const { data: existing } = await admin
        .from("transactions")
        .select("id")
        .eq("stripe_ref", p.product_pi_id)
        .limit(1);
      if (!existing || existing.length === 0) {
        await admin.from("transactions").insert({
          participation_id: p.id,
          user_id: p.user_id,
          type: "product_release",
          amount: -p.amount,
          stripe_ref: p.product_pi_id,
          status: "succeeded",
        });
      }
    }

    // Caution : idem, libérée.
    if (p.deposit_pi_id && p.deposit_status === "held") {
      try {
        await stripePost(`/v1/payment_intents/${p.deposit_pi_id}/cancel`, {
          cancellation_reason: "abandoned",
        });
      } catch (err) {
        console.error("cancel deposit PI", p.deposit_pi_id, err);
      }
      const { data: existing } = await admin
        .from("transactions")
        .select("id")
        .eq("stripe_ref", p.deposit_pi_id)
        .limit(1);
      if (!existing || existing.length === 0) {
        await admin.from("transactions").insert({
          participation_id: p.id,
          user_id: p.user_id,
          type: "deposit_release",
          amount: -p.deposit_amount,
          stripe_ref: p.deposit_pi_id,
          status: "succeeded",
        });
      }
    }

    await admin
      .from("participations")
      .update({ status: "cancelled", deposit_status: "released", cancelled_at: now })
      .eq("id", p.id);
  }
}