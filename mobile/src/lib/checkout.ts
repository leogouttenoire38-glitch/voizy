import { createURL } from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { setupPayment } from "./api";

/**
 * Ouvre une page Stripe (Checkout / onboarding) dans le navigateur intégré.
 * En dev (Expo Go) la redirection passe par une URL exp:// ; en build autonome
 * par le scheme voizy://. Retourne la dernière URL visitée si elle est captée.
 */
export async function openStripeUrl(url: string): Promise<string | null> {
  try {
    const result = await WebBrowser.openAuthSessionAsync(url, createURL("/"));
    if (result.type === "success" && typeof result.url === "string") return result.url;
    return null;
  } catch {
    // openAuthSessionAsync peut échouer sur Android → repli navigateur classique.
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      /* ignore */
    }
    return null;
  }
}

/**
 * Lance l'enregistrement de la carte du participant (Checkout mode setup).
 * Retourne true si le parcours aboutit (l'utilisateur est revenu de Stripe).
 */
export async function startCardSetup(): Promise<boolean> {
  const base = createURL("/payments");
  const res = await setupPayment(`${base}?setup=success`, `${base}?setup=cancel`);
  if (!res.ok || !res.url) return false;
  const returned = await openStripeUrl(res.url);
  return Boolean(returned && returned.includes("setup=success"));
}