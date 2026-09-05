// Types partagés — miroir du schéma Supabase (colonnes en snake_case telles
// que renvoyées par PostgREST).

export interface Profile {
  id: string;
  full_name: string;
  neighborhood: string | null;
  created_at: string;
}

/** Ligne public.users (l'utilisateur courant uniquement — RLS). */
export interface UserRow extends Profile {
  email: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  stripe_customer_id: string | null;
  updated_at: string;
}

export type MerchantCategory =
  | "epicerie"
  | "primeur"
  | "torrefaction"
  | "cave"
  | "epicerie_fine"
  | "autres";

export const MERCHANT_CATEGORY_LABELS: Record<MerchantCategory, string> = {
  epicerie: "Épicerie",
  primeur: "Primeur",
  torrefaction: "Torréfacteur",
  cave: "Cave & conserverie",
  epicerie_fine: "Épicerie fine",
  autres: "Autre commerce",
};

export interface Merchant {
  id: string;
  name: string;
  description: string | null;
  category: MerchantCategory;
  address: string;
  lat: number | null;
  lng: number | null;
  status: "onboarding" | "pending" | "active" | "paused";
  commission_rate: number;
  created_at: string;
}

/** Merchant enrichi par la RPC nearby_merchants. */
export interface NearbyMerchant extends Merchant {
  distance_m: number | null;
  active_offers: number;
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

export type GroupOrderStatus = "open" | "confirmed" | "completed" | "cancelled";

export interface GroupOrder {
  id: string;
  merchant_id: string;
  offer_id: string | null;
  organizer_id: string;
  status: GroupOrderStatus;
  participants_current: number;
  threshold: number;
  title: string;
  unit_label: string;
  base_price: number;
  group_price: number;
  deposit_amount: number;
  commission_rate: number;
  pickup_at: string;
  pickup_location: string;
  share_token: string;
  confirmed_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancelled_reason: string | null;
  created_at: string;
}

/** Commande enrichie par la RPC open_orders_feed (fil « Découvrir »). */
export interface FeedOrder {
  id: string;
  status: GroupOrderStatus;
  participants_current: number;
  threshold: number;
  title: string;
  unit_label: string;
  base_price: number;
  group_price: number;
  deposit_amount: number;
  pickup_at: string;
  pickup_location: string;
  share_token: string;
  created_at: string;
  merchant_id: string;
  merchant_name: string;
  merchant_category: MerchantCategory;
  merchant_address: string;
  organizer_name: string;
  distance_m: number | null;
}

export type ParticipationStatus =
  | "pending_payment"
  | "paid"
  | "completed"
  | "no_show"
  | "cancelled";

export interface Participation {
  id: string;
  group_order_id: string;
  user_id: string;
  status: ParticipationStatus;
  amount: number;
  deposit_amount: number;
  deposit_status: "pending" | "held" | "released" | "captured" | "failed";
  product_pi_id: string | null;
  deposit_pi_id: string | null;
  product_captured_at: string | null;
  picked_up_at: string | null;
  cancelled_at: string | null;
  created_at: string;
}

export interface Transaction {
  id: string;
  participation_id: string | null;
  user_id: string;
  type:
    | "product_payment"
    | "product_release"
    | "deposit_hold"
    | "deposit_release"
    | "deposit_capture";
  amount: number;
  stripe_ref: string | null;
  status: "pending" | "succeeded" | "failed" | "refunded";
  created_at: string;
}

export type NotificationType =
  | "order_joined"
  | "order_confirmed"
  | "order_cancelled"
  | "pickup_reminder"
  | "deposit_released"
  | "deposit_captured"
  | "order_completed"
  | "no_show";

export interface AppNotification {
  id: string;
  user_id: string;
  type: NotificationType;
  payload: Record<string, unknown>;
  read: boolean;
  sent_at: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Réponses des Edge Functions
// ---------------------------------------------------------------------------
export type EdgeOk<T> = { ok: true } & T;
export type EdgeErr = { ok: false; error: string; action?: string };

export type JoinOrderResponse = EdgeOk<{
  participation: Participation;
  order: GroupOrder;
  threshold_reached: boolean;
}> | EdgeErr;

export type ConfirmPickupResponse = EdgeOk<{
  released: number;
  captured: number;
  no_shows: number;
}> | EdgeErr;

export type SetupPaymentResponse = EdgeOk<{
  has_payment_method?: boolean;
  customer_id?: string | null;
  card?: { id?: string } | null;
  url?: string;
}> | EdgeErr;

export type OnboardingResponse = EdgeOk<{ url: string; account_id: string }> | EdgeErr;