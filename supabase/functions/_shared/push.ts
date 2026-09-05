// _shared/push.ts — envoi de notifications via Expo Push API.
// https://docs.expo.dev/push-notifications/sending-notifications/

export interface PushMessage {
  to: string;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
}

const EXPO_ENDPOINT = "https://exp.host/--/api/v2/push/send";

export async function sendExpoPush(messages: PushMessage[]): Promise<number> {
  if (messages.length === 0) return 0;
  const accessToken = Deno.env.get("EXPO_ACCESS_TOKEN") ?? undefined;
  let sent = 0;
  // L'API Expo accepte 100 messages par requête.
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    const res = await fetch(EXPO_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      console.error("Expo push HTTP", res.status, await res.text());
      continue;
    }
    const payload = (await res.json()) as { data?: Array<{ status?: string }> };
    sent += (payload.data ?? []).filter((d) => d.status === "ok").length;
  }
  return sent;
}

/** Texte FR (titre + corps) selon le type de notification. */
export function notifCopy(
  type: string,
  payload: Record<string, unknown>,
): { title: string; body: string } {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  const fmtEuro = (v: unknown) =>
    typeof v === "number" ? `${v.toFixed(2).replace(".", ",")} €` : "";
  const fmtWhen = (v: unknown) => {
    if (typeof v !== "string") return "";
    try {
      return new Date(v).toLocaleString("fr-FR", {
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
      });
    } catch {
      return s(v);
    }
  };

  switch (type) {
    case "order_joined":
      return {
        title: "Nouveau participant 👋",
        body: `${s(payload.actor_name)} a rejoint « ${s(payload.title)} » (${s(payload.participants_current)}/${s(payload.threshold)}).`,
      };
    case "order_confirmed":
      return {
        title: "🎉 Seuil atteint — commande confirmée !",
        body: `« ${s(payload.title)} » est confirmée chez ${s(payload.merchant_name)}. Retrait ${fmtWhen(payload.pickup_at)} (${s(payload.pickup_location)}).`,
      };
    case "order_cancelled":
      return {
        title: "Commande annulée",
        body: `Le seuil n'a pas été atteint pour « ${s(payload.title)} ». Rien n'a été débité.`,
      };
    case "pickup_reminder":
      return {
        title: "⏰ Retrait aujourd'hui",
        body: `Votre commande vous attend chez ${s(payload.merchant_name)} à ${fmtWhen(payload.pickup_at)}.`,
      };
    case "deposit_released":
      return {
        title: "Caution libérée ✅",
        body: `Votre caution de ${fmtEuro(payload.amount)} a été libérée pour « ${s(payload.title)} ».`,
      };
    case "deposit_captured":
      return {
        title: "Caution retenue",
        body: `Votre caution de ${fmtEuro(payload.amount)} a été retenue (no-show au retrait de « ${s(payload.title)} »).`,
      };
    case "no_show":
      return {
        title: "No-show signalé",
        body: `Un participant n'est pas venu chercher sa commande « ${s(payload.title)} » — sa caution a été retenue.`,
      };
    case "order_completed":
      return {
        title: "Commande terminée 🎉",
        body: `Merci d'avoir participé à « ${s(payload.title)} » chez ${s(payload.merchant_name)} !`,
      };
    default:
      return { title: "Voizy", body: "Vous avez une nouvelle notification." };
  }
}