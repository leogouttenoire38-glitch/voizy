/** Traduit les erreurs Supabase/GoTrue en messages clairs, en langage humain. */
export function humanAuthError(message: string | null | undefined, fallback: string): string {
  const m = (message ?? "").toLowerCase();
  if (!m) return fallback;

  if (/invalid login credentials|invalid email or password/i.test(m))
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

  return message ?? fallback;
}