// Liens profonds de l'app, centralisés.
//
// Pourquoi pas `createURL()` d'expo-linking : dans un build autonome (APK),
// `createURL("/payments")` produit `voizy:///payments` — une URL sans hôte.
// Stripe refuse cette valeur (« Not a valid URL ») et l'enregistrement de carte
// échouait donc en build, alors qu'en dev (Expo Go) createURL renvoie une URL
// exp:// avec hôte, acceptée par Stripe. On construit ici des liens explicites,
// identiques en dev et en build, acceptés par Stripe et compris par expo-router
// (host + pathname → route).
export const APP_SCHEME = "voizy";

/** Base de retour après un parcours Stripe (carte, onboarding). */
export const PAYMENTS_LINK = `${APP_SCHEME}://payments`;

/** URL de retour d'un parcours d'enregistrement de carte. */
export function paymentsReturnUrl(outcome: "success" | "cancel"): string {
  return `${PAYMENTS_LINK}?setup=${outcome}`;
}

/** Lien partageable vers une commande groupée (token de partage). */
export function orderLink(shareToken: string): string {
  return `${APP_SCHEME}://order/${shareToken}`;
}
