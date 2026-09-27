import { apiOrigin, supabase } from "./supabase";
import type { Merchant, MerchantOffer, Offer, OfferInput, UserRole } from "./types";

export class ApiError extends Error {}

// ---------------------------------------------------------------------------
// Appels aux Edge Functions (JWT de session ajouté automatiquement)
// ---------------------------------------------------------------------------
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
    action: "link",
    return_url: returnUrl,
    refresh_url: returnUrl,
  });
}

/** Où en est le compte de paiement ? La base est mise à jour si Stripe confirme. */
export function merchantOnboardingStatus(merchantId: string) {
  return callEdge<{
    ok: boolean;
    has_account: boolean;
    account_id: string | null;
    details_submitted: boolean;
    charges_enabled: boolean;
    payouts_enabled: boolean;
    ready: boolean;
    merchant_status: string;
    error?: string;
  }>("merchant-onboarding", { merchant_id: merchantId, action: "status" });
}

/** Confirmation de retrait : participants présents / no-show. */
export function confirmPickup(groupOrderId: string, noShowUserIds: string[]) {
  return callEdge<{ ok: boolean; released?: number; captured?: number; error?: string }>(
    "confirm-pickup",
    { group_order_id: groupOrderId, no_show_user_ids: noShowUserIds },
  );
}

/**
 * Abonnement commerçant (palier pro) : session Stripe Checkout d'abonnement.
 * Voizy se rémunère par abonnement — jamais par une commission sur les ventes.
 */
export function merchantSubscribe(merchantId: string, returnUrl: string) {
  return callEdge<{ ok: boolean; url?: string; session_id?: string; error?: string }>(
    "merchant-subscribe",
    { merchant_id: merchantId, return_url: returnUrl },
  );
}

/** Adresse → coordonnées (même fonction que le mobile, pour situer le commerce). */
export async function geocodeAddress(address: string) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  const res = await fetch(`${apiOrigin()}/functions/v1/geocode`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(anon ? { apikey: anon } : {}),
    },
    body: JSON.stringify({ address }),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    lat?: number;
    lng?: number;
    label?: string;
    error?: string;
  };
  if (!res.ok || !payload.ok) throw new ApiError(payload.error ?? "Adresse introuvable");
  return { lat: payload.lat as number, lng: payload.lng as number, label: payload.label ?? "" };
}

// ---------------------------------------------------------------------------
// RPC métier : LES MÊMES que le mobile (une seule logique, deux interfaces)
// ---------------------------------------------------------------------------
export async function chooseRole(role: UserRole): Promise<void> {
  const { error } = await supabase.rpc("choose_role", { p_role: role });
  if (error) throw error;
}

/** Crée la fiche commerce du compte connecté. */
export async function createMyMerchant(input: {
  name: string;
  category: string;
  address: string;
  lat: number | null;
  lng: number | null;
  description?: string | null;
}): Promise<Merchant> {
  const { data, error } = await supabase.rpc("create_my_merchant", {
    p_name: input.name,
    p_category: input.category,
    p_address: input.address,
    p_lat: input.lat,
    p_lng: input.lng,
    p_description: input.description ?? null,
  });
  if (error) throw error;
  const payload = data as { ok?: boolean; merchant?: Merchant } | null;
  if (!payload?.merchant) throw new Error("Le commerce n'a pas pu être créé. Réessayez.");
  return payload.merchant;
}

export async function fetchMerchantOffers(merchantId: string): Promise<MerchantOffer[]> {
  const { data, error } = await supabase.rpc("merchant_offers", { p_merchant_id: merchantId });
  if (error) throw error;
  return (data as MerchantOffer[] | null) ?? [];
}

export async function createOffer(merchantId: string, input: OfferInput): Promise<Offer> {
  const { data, error } = await supabase.rpc("create_offer", {
    p_merchant_id: merchantId,
    p_title: input.title,
    p_description: input.description,
    p_unit_label: input.unit_label,
    p_base_price: input.base_price,
    p_group_price: input.group_price,
    p_threshold: input.threshold,
    p_deposit_amount: input.deposit_amount,
  });
  if (error) throw error;
  const payload = data as { ok?: boolean; offer?: Offer } | null;
  if (!payload?.offer) throw new Error("L'offre n'a pas pu être publiée. Réessayez.");
  return payload.offer;
}

export async function updateOffer(offerId: string, input: OfferInput): Promise<Offer> {
  const { data, error } = await supabase.rpc("update_offer", {
    p_offer_id: offerId,
    p_title: input.title,
    p_description: input.description,
    p_unit_label: input.unit_label,
    p_base_price: input.base_price,
    p_group_price: input.group_price,
    p_threshold: input.threshold,
    p_deposit_amount: input.deposit_amount,
  });
  if (error) throw error;
  const payload = data as { ok?: boolean; offer?: Offer } | null;
  if (!payload?.offer) throw new Error("L'offre n'a pas pu être enregistrée. Réessayez.");
  return payload.offer;
}

export async function setOfferActive(offerId: string, active: boolean): Promise<void> {
  const { error } = await supabase.rpc(active ? "activate_offer" : "deactivate_offer", {
    p_offer_id: offerId,
  });
  if (error) throw error;
}

export async function fetchMerchantStats(merchantId: string) {
  const { data, error } = await supabase.rpc("merchant_stats", { p_merchant_id: merchantId });
  if (error) throw error;
  return data;
}

export async function fetchCommissionSummary(merchantId: string) {
  const { data, error } = await supabase.rpc("merchant_commission_summary", {
    p_merchant_id: merchantId,
  });
  if (error) throw error;
  return data;
}

export async function fetchMyPlan(merchantId: string) {
  const { data, error } = await supabase
    .from("merchant_plan")
    .select("*")
    .eq("merchant_id", merchantId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Erreurs métier : nos validations RPC sont rédigées en français, pour l'écran.
// Une erreur technique est remplacée par le message de repli de l'appelant.
// ---------------------------------------------------------------------------
const BUSINESS_PREFIXES = [
  "Indiquez",
  "Choisissez",
  "Le ",
  "La ",
  "Les ",
  "Cette ",
  "Ce ",
  "Un ",
  "Une ",
  "Seul",
  "Connectez-vous",
  "Votre ",
  "Position",
  "Trop de",
];

export function businessError(err: unknown, fallback: string): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : typeof err === "object" && err !== null && "message" in err
          ? String((err as { message?: unknown }).message ?? "")
          : "";
  const clean = raw.trim();
  if (clean && BUSINESS_PREFIXES.some((prefix) => clean.startsWith(prefix))) return clean;
  if (/network|fetch|offline|failed to fetch/i.test(clean)) {
    return "Problème de connexion. Vérifiez votre réseau puis réessayez.";
  }
  return fallback;
}
