import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("Voizy back-office : VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY manquantes. Copiez web/.env.example vers web/.env");
}

export const supabase = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabaseAnonKey || "placeholder",
  { auth: { persistSession: true, autoRefreshToken: true } },
);

export function apiOrigin(): string {
  return (supabaseUrl || "https://placeholder.supabase.co").replace(/\/+$/, "");
}