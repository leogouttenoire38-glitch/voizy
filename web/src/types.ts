// Types du back-office web — miroir du schéma Supabase et des RPC métier.
// Source de vérité des règles : les RPC (create_offer, update_offer, …), pas ce
// fichier : il ne fait que décrire ce que l'API renvoie.

export type UserRole = "buyer" | "merchant";

export interface Merchant {
  id: string;
  name: string;
  description: string | null;
  category: string;
  address: string;
  lat: number | null;
  lng: number | null;
  status: "onboarding" | "pending" | "active" | "paused";
  commission_rate: number;
  stripe_account_id: string | null;
  created_at: string;
}

export interface Offer {
  id: string;
  merchant_id: string;
  title: string;
  description: string | null;
  unit_label: string;
  base_price: number;
  group_price: number;
  threshold: number;
  deposit_amount: number;
  active: boolean;
  created_at: string;
}

/** Offre du catalogue, avec le nombre de commandes encore ouvertes. */
export interface MerchantOffer extends Offer {
  open_orders: number;
}

export interface OfferInput {
  title: string;
  description: string | null;
  unit_label: string;
  base_price: number;
  group_price: number;
  threshold: number;
  deposit_amount: number;
}

export interface MerchantPlan {
  merchant_id: string;
  plan: "free" | "pro";
  status: "inactive" | "active" | "past_due" | "canceled";
  current_period_end: string | null;
}

export interface OrderRow {
  id: string;
  status: string;
  title: string;
  participants_current: number;
  threshold: number;
  unit_label: string;
  group_price: number;
  pickup_at: string;
  pickup_location: string;
  share_token: string;
  created_at: string;
}

export interface ParticipationRow {
  id: string;
  user_id: string;
  status: string;
  amount: number;
  deposit_amount: number;
  deposit_status: string;
}

export interface MerchantStats {
  total_orders: number;
  confirmed_orders: number;
  cancelled_orders: number;
  open_orders: number;
  threshold_rate: number;
  revenue: number;
  unique_participants: number;
  avg_fill: number;
}

export interface CommissionSummary {
  current_month: {
    volume: number;
    commission: number;
    fees_estimated: number;
    fees_real: number;
    net: number;
    transactions: number;
  };
  /** TOUJOURS 0 : Voizy ne prend jamais de pourcentage sur les ventes. */
  commission_rate_percent: number;
  policy: string;
  billing: {
    enabled: boolean;
    plan: "free" | "pro";
    status: string;
    is_pro: boolean;
    current_period_end: string | null;
    pro_price_eur: number | null;
  };
}

export type PayoutState = "ready" | "incomplete" | "missing" | "unknown";

export const MERCHANT_CATEGORY_LABELS: Record<string, string> = {
  epicerie: "Épicerie",
  primeur: "Primeur",
  torrefaction: "Torréfacteur",
  cave: "Cave & conserverie",
  epicerie_fine: "Épicerie fine",
  autres: "Autre commerce",
};

export const MERCHANT_CATEGORIES = Object.keys(MERCHANT_CATEGORY_LABELS);
