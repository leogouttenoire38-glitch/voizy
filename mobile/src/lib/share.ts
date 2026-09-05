import { createURL } from "expo-linking";

/**
 * URL de partage d'une commande groupée. En dev (Expo Go) c'est une URL
 * exp://…/order/<token> ; en build autonome une URL voizy://order/<token>.
 * L'app reçoit le token via le deep link et affiche la commande.
 */
export function orderShareUrl(shareToken: string): string {
  return createURL(`/order/${shareToken}`);
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