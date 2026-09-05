// _shared/supabase.ts — client admin (service_role) pour les Edge Functions.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquantes");
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Récupère l'utilisateur authentifié depuis l'en-tête Authorization Bearer. */
export async function currentUser(
  req: Request,
): Promise<{ id: string; email?: string } | null> {
  const auth = req.headers.get("Authorization");
  const token = auth?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await adminClient().auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? undefined };
}

/** Vrai si l'appel provient du service_role (cron, concierge, dashboard). */
export function isServiceCall(req: Request): boolean {
  const header = req.headers.get("apikey");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return Boolean(serviceKey && header === serviceKey);
}