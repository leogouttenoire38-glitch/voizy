// confirm-pickup — clôture du retrait d'une commande confirmée.
//
// Appelé par l'organisateur (mobile) ou le commerçant (back-office web) avec
// la liste des participations en no-show (vide = tout le monde est venu).
//
// Pour chaque participation « paid » :
//   - retrait effectué → ANNULATION du PaymentIntent caution (libérée, jamais
//     débitée) + statut completed + notification « caution libérée »
//   - no-show         → CAPTURE du PaymentIntent caution (le commerçant la
//     conserve, conformément aux CGV) + statut no_show + notification
//
// Quand toutes les participations sont réglées → commande « completed ».
import { handleOptions, json } from "../_shared/cors.ts";
import { adminClient, currentUser } from "../_shared/supabase.ts";
import { stripePost } from "../_shared/stripe.ts";

interface OrderRow {
  id: string;
  merchant_id: string;
  organizer_id: string;
  status: string;
  title: string;
}

interface ParticipationRow {
  id: string;
  user_id: string;
  amount: number;
  deposit_amount: number;
  status: string;
  deposit_status: string;
  deposit_pi_id: string | null;
}

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  try {
    const user = await currentUser(req);
    if (!user) return json({ ok: false, error: "Authentification requise." }, 401);

    const body = (await req.json().catch(() => ({}))) as {
      group_order_id?: string;
      no_show_user_ids?: string[];
    };
    if (!body.group_order_id) return json({ ok: false, error: "group_order_id manquant" }, 400);

    const admin = adminClient();

    const { data: order } = await admin
      .from("group_orders")
      .select("id, merchant_id, organizer_id, status, title")
      .eq("id", body.group_order_id)
      .single() as { data: OrderRow | null };

    if (!order) return json({ ok: false, error: "Commande introuvable." }, 404);

    // Autorisation : organisateur ou commerçant gestionnaire.
    const { data: merchant } = await admin
      .from("merchants")
      .select("id, manager_id")
      .eq("id", order.merchant_id)
      .single();
    const isOrganizer = order.organizer_id === user.id;
    const isManager = merchant?.manager_id === user.id;
    if (!isOrganizer && !isManager) {
      return json({ ok: false, error: "Accès refusé : organisateur ou commerçant uniquement." }, 403);
    }

    if (order.status !== "confirmed") {
      return json({ ok: false, error: "Cette commande n'est pas confirmée." }, 409);
    }

    const noShowIds = new Set(body.no_show_user_ids ?? []);
    const { data: participations } = await admin
      .from("participations")
      .select("id, user_id, amount, deposit_amount, status, deposit_status, deposit_pi_id")
      .eq("group_order_id", order.id)
      .eq("status", "paid");

    let released = 0;
    let captured = 0;
    const noShows: string[] = [];

    for (const p of (participations ?? []) as ParticipationRow[]) {
      const isNoShow = noShowIds.has(p.id);
      const now = new Date().toISOString();

      if (isNoShow) {
        noShows.push(p.id);
        // No-show → la caution est capturée (compensation pour le commerçant).
        if (p.deposit_pi_id && p.deposit_status === "held") {
          try {
            await stripePost(`/v1/payment_intents/${p.deposit_pi_id}/capture`, {});
            captured++;
          } catch (err) {
            console.error("capture deposit (no-show)", p.deposit_pi_id, err);
          }
        }
        await admin
          .from("participations")
          .update({ status: "no_show", deposit_status: "captured", picked_up_at: now })
          .eq("id", p.id);

        await logTransaction(admin, p, "deposit_capture", p.deposit_amount);
        await admin.from("notifications").insert({
          user_id: p.user_id,
          type: "deposit_captured",
          payload: {
            group_order_id: order.id,
            title: order.title,
            amount: p.deposit_amount,
          },
        });
      } else {
        // Retrait effectué → la caution est libérée (annulation de la pré-autorisation).
        if (p.deposit_pi_id && p.deposit_status === "held") {
          try {
            await stripePost(`/v1/payment_intents/${p.deposit_pi_id}/cancel`, {
              cancellation_reason: "requested_by_customer",
            });
            released++;
          } catch (err) {
            console.error("cancel deposit (pickup)", p.deposit_pi_id, err);
          }
        }
        await admin
          .from("participations")
          .update({ status: "completed", deposit_status: "released", picked_up_at: now })
          .eq("id", p.id);

        await logTransaction(admin, p, "deposit_release", -p.deposit_amount);
        await admin.from("notifications").insert({
          user_id: p.user_id,
          type: "deposit_released",
          payload: {
            group_order_id: order.id,
            title: order.title,
            amount: p.deposit_amount,
          },
        });
      }
    }

    // Toutes les participations réglées → commande terminée.
    const { data: remaining } = await admin
      .from("participations")
      .select("id")
      .eq("group_order_id", order.id)
      .in("status", ["pending_payment", "paid"]);
    if (!remaining || remaining.length === 0) {
      await admin
        .from("group_orders")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", order.id);
    }

    // L'organisateur est prévenu des no-shows.
    if (noShows.length > 0) {
      await admin.from("notifications").insert({
        user_id: order.organizer_id,
        type: "no_show",
        payload: { group_order_id: order.id, title: order.title, no_show_count: noShows.length },
      });
    }

    return json({ ok: true, released, captured, no_shows: noShows.length });
  } catch (err) {
    console.error("confirm-pickup", err);
    const msg = err instanceof Error ? err.message : "Erreur interne";
    return json({ ok: false, error: msg }, 500);
  }
});

async function logTransaction(
  admin: ReturnType<typeof import("../_shared/supabase.ts").adminClient>,
  p: ParticipationRow,
  type: "deposit_capture" | "deposit_release",
  amount: number,
) {
  if (amount === 0) return;
  const ref = p.deposit_pi_id ?? type;
  const { data: existing } = await admin
    .from("transactions")
    .select("id")
    .eq("stripe_ref", ref)
    .eq("type", type)
    .limit(1);
  if (!existing || existing.length === 0) {
    await admin.from("transactions").insert({
      participation_id: p.id,
      user_id: p.user_id,
      type,
      amount,
      stripe_ref: ref,
      status: "succeeded",
    });
  }
}