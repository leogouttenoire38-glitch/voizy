import { apiOrigin, supabase } from "./supabase";

export class ApiError extends Error {}

async function callEdge<T>(name: string, body?: Record<string, unknown>): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

  const res = await fetch(`${apiOrigin()}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(anon ? { apikey: anon } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });

  const payload = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(payload.error ?? `Erreur serveur (${res.status})`);
  return payload;
}

/** Lien d'onboarding Stripe Connect Express pour un commerçant. */
export function merchantOnboarding(merchantId: string, returnUrl: string) {
  return callEdge<{ ok: boolean; url?: string; error?: string }>("merchant-onboarding", {
    merchant_id: merchantId,
    return_url: returnUrl,
    refresh_url: returnUrl,
  });
}

/** Confirmation de retrait : participants présents / no-show. */
export function confirmPickup(groupOrderId: string, noShowUserIds: string[]) {
  return callEdge<{ ok: boolean; released?: number; captured?: number; error?: string }>("confirm-pickup", {
    group_order_id: groupOrderId,
    no_show_user_ids: noShowUserIds,
  });
}