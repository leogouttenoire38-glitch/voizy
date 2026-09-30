/** Messages d'erreur en langage humain (miroir de mobile/src/lib/errors.ts).
 *  Comme côté mobile : tout message non reconnu est remplacé par le message
 *  contextuel de l'écran — jamais le texte anglais de GoTrue à l'écran. */
export function humanError(message: string | null | undefined, fallback: string): string {
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
  if (/email.*not.*valid|invalid email/i.test(m))
    return "Cette adresse e-mail ne semble pas valide. Vérifiez-la.";

  // Fenêtre anti-abus par adresse (une demande par minute — `smtp_max_frequency`) :
  // GoTrue met le nombre de secondes restantes dans son message, on le réutilise
  // au lieu de le jeter (l'utilisateur en a besoin sur le bouton « Renvoyer »).
  if (/only request this after|for security purposes/i.test(m)) {
    const seconds = (m.match(/after\s+(\d+)\s*seconds?/) ?? [])[1];
    return seconds
      ? `Pour votre sécurité, patientez encore ${seconds} s avant de demander un nouveau code.`
      : "Pour votre sécurité, patientez une minute avant de demander un nouveau code.";
  }

  // Quota d'envoi d'e-mails d'authentification du projet (429) : plusieurs
  // personnes s'inscrivent en même temps, l'utilisateur n'a rien fait de mal.
  if (/email rate limit|email_send_rate_limit|too many emails/i.test(m))
    return "Beaucoup de monde s'inscrit en ce moment. Réessayez dans quelques minutes.";

  if (/rate.limit|too many requests|over.*request/i.test(m))
    return "Trop de demandes. Attendez un peu puis réessayez.";
  if (/network|fetch|offline|failed to fetch/i.test(m))
    return "Problème de connexion. Vérifiez votre réseau puis réessayez.";
  if (/user.*not found/i.test(m))
    return "Aucun compte trouvé avec cet e-mail. Créez un compte pour commencer.";
  // Rien de reconnu → message de l'écran. Jamais `message` : le texte brut de
  // GoTrue est en anglais et truffé de jargon (codes HTTP, noms d'API).
  return fallback;
}

/** Faut-il proposer la confirmation par code e-mail (au lieu d'un mot de passe) ? */
export function needsEmailConfirmation(message: string | null | undefined): boolean {
  return /already registered|already been registered/i.test(message ?? "");
}
