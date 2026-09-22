import { createURL } from "expo-linking";
import { orderLink } from "./links";

/**
 * URL de partage d'une commande groupée. En dev (Expo Go) c'est une URL
 * exp://…/order/<token> (seul Expo Go sait l'ouvrir) ; en build autonome
 * `voizy://order/<token>`. createURL y produirait `voizy:///order/<token>`
 * (hôte vide) : on préfère la forme avec hôte, comprise par expo-router et par
 * les filtres d'intent Android.
 */
export function orderShareUrl(shareToken: string): string {
  const devUrl = createURL(`/order/${shareToken}`);
  return /^exp(s|o)?:/.test(devUrl) ? devUrl : orderLink(shareToken);
}

/** Message prêt à partager (WhatsApp / SMS / réseaux). */
export function orderShareMessage(shareToken: string, title: string, groupPrice: number, threshold: number, pickupAt: string): string {
  const when = new Date(pickupAt).toLocaleString("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    `🧺 Achat groupé Voizy : « ${title} » à ${groupPrice.toFixed(2).replace(".", ",")} € ` +
    `(au lieu de plus, dès ${threshold} participants). ` +
    `Retrait le ${when}. Rejoignez-moi : ${orderShareUrl(shareToken)}`
  );
}