// Accès aux Edge Functions Supabase depuis l'app : en-têtes auth + parse des
// réponses. Aucun secret ici — le JWT de session est ajouté automatiquement.
import { supabase, apiOrigin } from "./supabase";
import type {
  ConfirmPickupResponse,
  JoinOrderResponse,
  OnboardingResponse,
  SetupPaymentResponse,
} from "../types";

export class ApiError extends Error {}

interface CallOptions {
  method?: "POST" | "GET";
  body?: Record<string, unknown>;
}

async function callEdge<T>(name: string, opts: CallOptions = {}): Promise<T> {
  const { method = "POST", body } = opts;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

  const res = await fetch(`${apiOrigin()}/functions/v1/${name}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(anon ? { apikey: anon } : {}),
    },
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
  });

  const payload = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new ApiError(payload.error ?? `Erreur serveur (${res.status})`);
  }
  return payload;
}

// --- Géocodage (quartier de l'utilisateur) -----------------------------------
export async function geocodeAddress(address: string) {
  const res = await fetch(`${apiOrigin()}/functions/v1/geocode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    lat?: number;
    lng?: number;
    label?: string;
    error?: string;
  };
  if (!res.ok || !data.ok) throw new ApiError(data.error ?? "Géocodage impossible");
  return { lat: data.lat as number, lng: data.lng as number, label: data.label ?? "" };
}

// --- Commandes groupées -------------------------------------------------------
export function joinOrder(groupOrderId: string) {
  return callEdge<JoinOrderResponse>("join-order", { body: { group_order_id: groupOrderId } });
}

export function confirmPickup(groupOrderId: string, noShowUserIds: string[] = []) {
  return callEdge<ConfirmPickupResponse>("confirm-pickup", {
    body: { group_order_id: groupOrderId, no_show_user_ids: noShowUserIds },
  });
}

// --- Paiements ----------------------------------------------------------------
export function setupPaymentStatus() {
  return callEdge<SetupPaymentResponse>("setup-payment", { method: "GET" });
}

export function setupPayment(successUrl: string, cancelUrl: string) {
  return callEdge<SetupPaymentResponse>("setup-payment", {
    body: { success_url: successUrl, cancel_url: cancelUrl },
  });
}

// --- Concierge (back-office web) ----------------------------------------------
export function merchantOnboarding(merchantId: string, returnUrl: string) {
  return callEdge<OnboardingResponse>("merchant-onboarding", {
    body: { merchant_id: merchantId, return_url: returnUrl, refresh_url: returnUrl },
  });
}