import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

// Ces variables sont inlinées par Expo au build (préfixe EXPO_PUBLIC_).
// Renseignées dans mobile/.env — jamais de secret ici, uniquement l'URL + clé anon.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "Voizy : EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY manquantes. Copiez mobile/.env.example vers mobile/.env",
  );
}

export const supabase = createClient(supabaseUrl || "https://placeholder.supabase.co", supabaseAnonKey || "placeholder", {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

/** Hôte de l'API (ex. https://abcd.supabase.co) — sert à joindre les Edge Functions. */
export function apiOrigin(): string {
  const url = supabaseUrl || "https://placeholder.supabase.co";
  return url.replace(/\/+$/, "");
}