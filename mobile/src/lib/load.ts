// Chargement d'écran : un seul chemin, qui ne peut pas rester en attente.
//
// Angle mort corrigé ici : un `await` qui rejette dans une IIFE de useEffect ou
// dans un useCallback de chargement n'était géré nulle part → `setLoading(false)`
// ne s'exécutait jamais et l'écran restait figé sur un indicateur muet, sans
// aucun moyen de réessayer (listes commerçants/offres, onglets, fiches).
//
// `attemptLoad` ne lève JAMAIS : elle rend toujours un résultat exploitable
// (données, ou message en langage humain). L'appelant peut donc toujours arrêter
// son chargement, afficher « Échec du chargement » + « Réessayer » et relancer
// l'appel. Le délai de 20 s vient de ./net (branché globalement sur le client
// Supabase et sur les Edge Functions) : un réseau muet finit en erreur bornée,
// il n'attend pas indéfiniment.
//
// La tâche DOIT lever (throw) pour signaler un échec : un `{ error }` renvoyé
// par Supabase se transforme donc en exception dans la tâche (`if (error) throw error`).
//
// Ce module est volontairement autonome (aucun import) : il tourne dans l'app
// et dans les scripts de test Node (scénario K de scripts/e2e-stripe.mjs, qui
// vérifie le comportement réel sur un serveur muet), comme ./net.

export type LoadResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Traduit l'échec d'un chargement d'écran (liste, fiche, statut) en message
 * humain. Comme pour l'auth et le paiement : tout message non reconnu est
 * remplacé par le message contextuel de l'écran — les erreurs de PostgREST sont
 * en anglais et truffées de jargon (codes, noms de tables), jamais affichables.
 * `input` peut être une Error, une chaîne ou un objet `{ message }`.
 */
export function humanLoadError(input: unknown, fallback: string): string {
  const message =
    input instanceof Error
      ? input.message
      : typeof input === "string"
        ? input
        : typeof input === "object" && input !== null && "message" in input
          ? String((input as { message?: unknown }).message ?? "")
          : "";
  const m = message.toLowerCase();
  if (!m) return fallback;

  if (/délai dépassé|delai depasse|timeout|abort/i.test(m))
    return "Le serveur ne répond pas. Vérifiez votre connexion puis réessayez.";
  if (/network|fetch|offline|failed to fetch|connexion/i.test(m))
    return "Problème de connexion. Vérifiez votre réseau puis réessayez.";
  if (/auth|unauthor|jwt|session|401|403|invalid token/i.test(m))
    return "Votre session a expiré. Reconnectez-vous puis réessayez.";
  if (/rate|too many|over.*request/i.test(m))
    return "Trop de demandes d'un coup. Attendez un instant puis réessayez.";

  return fallback;
}

export async function attemptLoad<T>(
  task: () => Promise<T>,
  fallback: string,
): Promise<LoadResult<T>> {
  try {
    return { ok: true, data: await task() };
  } catch (err) {
    return { ok: false, error: humanLoadError(err, fallback) };
  }
}
