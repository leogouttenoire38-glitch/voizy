/**
 * Traduit les erreurs Supabase/GoTrue en messages clairs, en langage humain.
 * Tout message non reconnu est remplacé par le message contextuel de l'écran :
 * les erreurs brutes de GoTrue sont en anglais et truffées de jargon technique
 * (codes HTTP, noms d'API) — jamais ce qu'un utilisateur doit lire.
 */
export function humanAuthError(message: string | null | undefined, fallback: string): string {
  const m = (message ?? "").toLowerCase();
  if (!m) return fallback;

  if (/délai dépassé|delai depasse|timeout|abort/i.test(m))
    return "Le serveur ne répond pas. Vérifiez votre connexion puis réessayez.";

  // GoTrue renvoie le texte lisible dans `msg` et l'identifiant machine dans
  // `error_code` : on accepte les deux formes.
  if (/invalid login credentials|invalid email or password|invalid_credentials/i.test(m))
    return "E-mail ou mot de passe incorrect. Vérifiez puis réessayez.";
  if (/email.*not.*confirm|confirm.*email|otp.*expired|expired token/i.test(m))
    return "Le code n'est plus valide. Demandez un nouveau code.";
  if (/invalid.*otp|invalid token|token has expired|code.*invalid/i.test(m))
    return "Le code n'est pas valide. Vérifiez-le puis réessayez.";
  if (/password.*(too short|weak)|at least 6/i.test(m))
    return "Le mot de passe doit contenir au moins 6 caractères.";
  if (/already.*(registered|exist|taken)/i.test(m))
    return "Un compte existe déjà avec cet e-mail. Connectez-vous à la place.";
  if (/email.*not.*valid|invalid email/i.test(m))
    return "Cette adresse e-mail ne semble pas valide. Vérifiez-la.";
  if (/rate.limit|too many requests|over.*request/i.test(m))
    return "Trop de demandes. Attendez un peu puis réessayez.";
  if (/network|fetch|offline|failed to fetch/i.test(m))
    return "Problème de connexion. Vérifiez votre réseau puis réessayez.";
  if (/user.*not found/i.test(m))
    return "Aucun compte trouvé avec cet e-mail. Créez un compte pour commencer.";

  return fallback;
}

/**
 * Traduit une erreur de paiement (Edge Function, Stripe, réseau) en message
 * clair. Jamais de jargon technique affiché à l'utilisateur.
 */
export function humanPaymentError(input: unknown): string {
  const message = input instanceof Error ? input.message : typeof input === "string" ? input : "";
  const m = message.toLowerCase();
  if (!m) return "Le paiement n'a pas pu être préparé. Réessayez.";

  if (/abort|timeout|trop long|délai|delai/i.test(m))
    return "Le serveur ne répond pas. Vérifiez votre connexion puis réessayez.";
  if (/network|fetch|offline|failed to fetch/i.test(m))
    return "Problème de connexion. Vérifiez votre réseau puis réessayez.";
  if (/not a valid url|invalid url/i.test(m))
    return "La page de paiement n'a pas pu être ouverte. Mettez l'application à jour puis réessayez.";
  if (/auth|unauthor|jwt|session|401|403/i.test(m))
    return "Votre session a expiré. Reconnectez-vous puis réessayez.";
  if (/rate|too many/i.test(m))
    return "Trop de tentatives. Attendez un instant puis réessayez.";

  return "Le paiement n'a pas pu être préparé. Réessayez dans un instant.";
}