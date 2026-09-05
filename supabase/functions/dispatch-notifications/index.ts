// dispatch-notifications — transforme les notifications in-app non envoyées
// (sent_at IS NULL, créées par triggers ou par les Edge Functions) en push Expo.
// À planifier côté Supabase (Dashboard → Edge Functions → Scheduled, 1–5 min).
import { handleOptions, json } from "../_shared/cors.ts";
import { adminClient } from "../_shared/supabase.ts";
import { notifCopy, sendExpoPush, type PushMessage } from "../_shared/push.ts";

interface NotifRow {
  id: string;
  user_id: string;
  type: string;
  payload: Record<string, unknown>;
}

interface TokenRow {
  user_id: string;
  expo_token: string;
}

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const admin = adminClient();
    let totalSent = 0;

    // Boucle bornée : 5 paquets de 200 max par passe (ne bloque pas le cron).
    for (let pass = 0; pass < 5; pass++) {
      const { data, error } = await admin
        .from("notifications")
        .select("id, user_id, type, payload")
        .is("sent_at", null)
        .order("created_at", { ascending: true })
        .limit(200);

      if (error) throw error;
      const rows = (data ?? []) as NotifRow[];
      if (rows.length === 0) break;

      const userIds = [...new Set(rows.map((r) => r.user_id))];
      const { data: tokens } = await admin
        .from("push_tokens")
        .select("user_id, expo_token")
        .in("user_id", userIds);
      const tokensByUser = new Map<string, string[]>();
      for (const t of (tokens ?? []) as TokenRow[]) {
        tokensByUser.set(t.user_id, [...(tokensByUser.get(t.user_id) ?? []), t.expo_token]);
      }

      const messages: PushMessage[] = [];
      for (const row of rows) {
        const copy = notifCopy(row.type, row.payload ?? {});
        for (const token of tokensByUser.get(row.user_id) ?? []) {
          messages.push({
            to: token,
            title: copy.title,
            body: copy.body,
            data: { type: row.type, notification_id: row.id, ...(row.payload ?? {}) },
          });
        }
      }

      const sent = await sendExpoPush(messages);
      totalSent += sent;

      await admin
        .from("notifications")
        .update({ sent_at: new Date().toISOString() })
        .in("id", rows.map((r) => r.id));

      if (rows.length < 200) break;
    }

    return json({ ok: true, sent: totalSent });
  } catch (err) {
    console.error("dispatch-notifications", err);
    return json({ ok: false, error: "Erreur interne" }, 500);
  }
});