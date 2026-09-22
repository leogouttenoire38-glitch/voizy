import { AppState, Linking } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { setupPayment, setupPaymentStatus } from "./api";
import { PAYMENTS_LINK, paymentsReturnUrl } from "./links";
import { humanPaymentError } from "./errors";

// Délai maximum pendant lequel on attend le retour de l'utilisateur (il peut
// saisir sa carte tranquillement). Passé ce délai on rend la main et on vérifie
// l'état réel chez Stripe — on ne laisse jamais un bouton tourner sans fin.
const RETURN_TIMEOUT_MS = 10 * 60 * 1000;

type ReturnSignal = { promise: Promise<void>; cleanup: () => void };

/**
 * Signal « l'utilisateur est revenu dans l'app », avec trois filets :
 * le deep link de retour (voizy://payments…), le retour au premier plan
 * (AppState) et un délai maximum. Le délai garantit que la promesse se résout
 * toujours — sur Android, openAuthSessionAsync (polyfill Custom Tab + AppState)
 * peut sinon ne jamais se résoudre et laisser l'écran en chargement.
 */
function onceReturnedToApp(): ReturnSignal {
  let done = false;
  let cleanup = () => {};
  const promise = new Promise<void>((resolve) => {
    const finish = () => {
      if (done) return;
      done = true;
      cleanup();
      resolve();
    };
    const subscriptions = [
      Linking.addEventListener("url", ({ url }) => {
        if (url.startsWith(PAYMENTS_LINK)) finish();
      }),
      AppState.addEventListener("change", (state) => {
        if (state === "active") finish();
      }),
    ];
    const timer = setTimeout(finish, RETURN_TIMEOUT_MS);
    cleanup = () => {
      clearTimeout(timer);
      subscriptions.forEach((sub) => sub.remove());
    };
  });
  return { promise, cleanup };
}

/** Ouvre la page Stripe et attend le retour de l'utilisateur (jamais bloquant). */
async function openStripeAndWait(url: string): Promise<void> {
  const returned = onceReturnedToApp();
  try {
    const session = WebBrowser.openAuthSessionAsync(url, PAYMENTS_LINK);
    const outcome = await Promise.race([
      session.then(
        () => "closed" as const,
        () => "failed" as const,
      ),
      returned.promise.then(() => "returned" as const),
    ]);
    if (outcome === "failed") {
      // Aucun navigateur pour la session d'auth : repli sur le navigateur système.
      try {
        await WebBrowser.openBrowserAsync(url);
      } catch {
        /* ignore */
      }
      await returned.promise;
    }
  } finally {
    returned.cleanup();
  }
}

/**
 * Vérité terrain : une carte est-elle réellement enregistrée chez Stripe ?
 * Bien plus fiable que d'analyser l'URL de retour (normalisée ou non par
 * Android) : c'est Stripe qui détient l'état.
 */
async function cardIsSaved(): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const status = await setupPaymentStatus();
      if (status.ok && status.has_payment_method) return true;
    } catch {
      /* on retente une fois */
    }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return false;
}

export type CardSetupResult = { ok: true } | { ok: false; error: string };

/**
 * Lance l'enregistrement de la carte du participant (Checkout mode setup).
 * Ne lève jamais : retourne toujours un résultat exploitable (succès ou message
 * en langage humain) pour que l'écran appelant puisse arrêter son chargement.
 */
export async function startCardSetup(): Promise<CardSetupResult> {
  let session: Awaited<ReturnType<typeof setupPayment>>;
  try {
    session = await setupPayment(paymentsReturnUrl("success"), paymentsReturnUrl("cancel"));
  } catch (err) {
    return { ok: false, error: humanPaymentError(err) };
  }
  if (!session.ok) {
    return { ok: false, error: humanPaymentError(session.error) };
  }
  if (!session.url) {
    return { ok: false, error: "La page de paiement n'a pas pu être ouverte. Réessayez." };
  }

  try {
    await openStripeAndWait(session.url);
  } catch {
    return { ok: false, error: "Impossible d'ouvrir la page de paiement. Réessayez." };
  }

  const saved = await cardIsSaved();
  if (saved) return { ok: true };
  return {
    ok: false,
    error: "La carte n'a pas été enregistrée. Vérifiez les informations de votre carte puis réessayez.",
  };
}
