// Espace commerçant : rôle, fiche commerce, catalogue d'offres et compte de
// paiement. TOUT passe par les RPC / Edge Functions partagées avec le web —
// aucune règle métier n'est dupliquée ici (prix, seuil, caution, autorisations
// sont validés côté base, une seule fois pour les deux interfaces).
import { supabase } from "./supabase";
import { humanLoadError } from "./load";
import {
  merchantOnboardingLink,
  merchantOnboardingStatus,
  merchantSubscribe,
} from "./api";
import { openStripeHostedFlow } from "./checkout";
import { MERCHANT_PAYMENTS_LINK, merchantOnboardingReturnUrl } from "./links";
import type {
  CommissionSummary,
  Merchant,
  MerchantOffer,
  MerchantPlan,
  MerchantStats,
  Offer,
  OfferInput,
  UserRole,
} from "../types";

// ---------------------------------------------------------------------------
// Erreurs métier : nos validations sont rédigées en français, pour l'écran.
// Une erreur technique (PostgREST, réseau) est remplacée par le message de
// repli de l'appelant — jamais de jargon affiché.
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

function rawMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message?: unknown }).message ?? "");
  }
  return "";
}

/** Message d'erreur d'une action catalogue (validations françaises conservées). */
export function businessError(err: unknown, fallback: string): string {
  const raw = rawMessage(err).trim();
  if (raw && BUSINESS_PREFIXES.some((prefix) => raw.startsWith(prefix))) return raw;
  return humanLoadError(err, fallback);
}

// ---------------------------------------------------------------------------
// Rôle et fiche commerce
// ---------------------------------------------------------------------------

/** Enregistre le rôle choisi (« buyer » = voisin, « merchant » = commerçant). */
export async function chooseRole(role: UserRole): Promise<void> {
  const { error } = await supabase.rpc("choose_role", { p_role: role });
  if (error) throw error;
}

/**
 * Le commerce du compte connecté, ou null. Ne lève jamais pour un simple
 * « pas encore de commerce » : la navigation traite null comme « à créer ».
 */
export async function fetchMyMerchant(userId: string): Promise<Merchant | null> {
  const { data, error } = await supabase
    .from("merchants")
    .select("*")
    .eq("manager_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as Merchant | null) ?? null;
}

/** Crée la fiche commerce du compte connecté (nom, catégorie, adresse). */
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

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

/** Catalogue du commerce (offres actives en tête, commandes ouvertes comptées). */
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

/** Retire (active = false) ou remet (active = true) une offre au catalogue. */
export async function setOfferActive(offerId: string, active: boolean): Promise<void> {
  const { error } = await supabase.rpc(
    active ? "activate_offer" : "deactivate_offer",
    { p_offer_id: offerId },
  );
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Tableau de bord
// ---------------------------------------------------------------------------

export async function fetchMerchantStats(merchantId: string): Promise<MerchantStats> {
  const { data, error } = await supabase.rpc("merchant_stats", { p_merchant_id: merchantId });
  if (error) throw error;
  return data as MerchantStats;
}

export async function fetchCommissionSummary(merchantId: string): Promise<CommissionSummary> {
  const { data, error } = await supabase.rpc("merchant_commission_summary", {
    p_merchant_id: merchantId,
  });
  if (error) throw error;
  return data as CommissionSummary;
}

/** Palier d'abonnement (plan gratuit par défaut). */
export async function fetchMyPlan(merchantId: string): Promise<MerchantPlan | null> {
  const { data, error } = await supabase
    .from("merchant_plan")
    .select("*")
    .eq("merchant_id", merchantId)
    .maybeSingle();
  if (error) throw error;
  return (data as MerchantPlan | null) ?? null;
}

// ---------------------------------------------------------------------------
// Compte de paiement (Stripe Connect Express)
// ---------------------------------------------------------------------------

export type PayoutState =
  | "ready" // peut encaisser et recevoir ses virements
  | "incomplete" // compte créé mais onboarding non terminé (ou en cours de validation)
  | "missing" // aucun compte de paiement pour l'instant
  | "unknown"; // vérification impossible (réseau) — jamais présenté comme un échec

/** État du compte de paiement, sans jamais lever : les bandeaux restent lisibles. */
export async function fetchPayoutState(merchantId: string): Promise<PayoutState> {
  try {
    const status = await merchantOnboardingStatus(merchantId);
    if (!status.ok) return "unknown";
    if (status.ready || status.merchant_status === "active") return "ready";
    return status.has_account ? "incomplete" : "missing";
  } catch {
    return "unknown";
  }
}

export type OnboardingResult = { ok: true } | { ok: false; error: string };

/**
 * Ouvre le parcours Stripe hébergé du compte de paiement, puis vérifie le
 * retour réel (on ne se fie pas à l'URL de retour : Stripe est la vérité).
 * Ne lève jamais.
 */
export async function startMerchantOnboarding(merchantId: string): Promise<OnboardingResult> {
  let link: Awaited<ReturnType<typeof merchantOnboardingLink>>;
  try {
    link = await merchantOnboardingLink(merchantId, merchantOnboardingReturnUrl());
  } catch (err) {
    return { ok: false, error: humanLoadError(err, "Impossible d'ouvrir le compte de paiement. Réessayez.") };
  }
  if (!link.ok) {
    return { ok: false, error: link.error ?? "Impossible de créer le lien de paiement. Réessayez." };
  }
  if (!link.url) {
    return { ok: false, error: "Impossible de créer le lien de paiement. Réessayez." };
  }

  try {
    await openStripeHostedFlow(link.url, MERCHANT_PAYMENTS_LINK);
  } catch {
    return { ok: false, error: "Impossible d'ouvrir la page de Stripe. Réessayez." };
  }

  const state = await fetchPayoutState(merchantId);
  if (state === "ready") return { ok: true };
  return {
    ok: false,
    error:
      "Votre compte de paiement n'est pas encore validé par Stripe. Si vous venez de terminer, patientez un instant puis vérifiez à nouveau.",
  };
}

/**
 * Souscription au palier pro (Stripe Checkout, facturé sur la carte du
 * commerçant — hors flux de vente). Le plan réel est confirmé par Stripe
 * (webhook customer.subscription.*) : on vérifie donc après le retour.
 */
export async function startProSubscription(merchantId: string): Promise<OnboardingResult> {
  let session: Awaited<ReturnType<typeof merchantSubscribe>>;
  try {
    session = await merchantSubscribe(merchantId, `${MERCHANT_PAYMENTS_LINK}?plan=pro`);
  } catch (err) {
    return { ok: false, error: humanLoadError(err, "Impossible d'ouvrir l'abonnement. Réessayez.") };
  }
  if (!session.ok || !session.url) {
    return { ok: false, error: session.error ?? "Impossible de démarrer l'abonnement. Réessayez." };
  }

  try {
    await openStripeHostedFlow(session.url, MERCHANT_PAYMENTS_LINK);
  } catch {
    return { ok: false, error: "Impossible d'ouvrir la page de Stripe. Réessayez." };
  }

  try {
    const plan = await fetchMyPlan(merchantId);
    if (plan?.plan === "pro" && (plan.status === "active" || plan.status === "past_due")) {
      return { ok: true };
    }
  } catch {
    /* vérification impossible : on ne prétend pas que c'est activé */
  }
  return {
    ok: false,
    error:
      "Votre abonnement n'est pas encore confirmé par Stripe. Si vous venez de payer, patientez un instant puis vérifiez à nouveau.",
  };
}
