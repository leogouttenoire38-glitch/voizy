import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { fetchWithTimeout } from "./net";

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
  // Toutes les requêtes du client (auth, REST, RPC) sont bornées dans le temps :
  // un réseau muet rejette au bout de 20 s au lieu de laisser l'écran en
  // chargement indéfiniment.
  global: { fetch: (input, init) => fetchWithTimeout(input, init) },
});

/** Hôte de l'API (ex. https://abcd.supabase.co) — sert à joindre les Edge Functions. */
export function apiOrigin(): string {
  const url = supabaseUrl || "https://placeholder.supabase.co";
  return url.replace(/\/+$/, "");
}