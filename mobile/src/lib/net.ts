// Délais réseau, partagés par toute l'app (auth Supabase, Edge Functions).
//
// Sans délai, un réseau muet (le paquet part mais rien ne revient) laisse la
// promesse en attente pour toujours : l'écran reste avec un bouton qui tourne
// et aucun message. On borne donc chaque requête HTTP, à un seul endroit.
//
// Ce module est volontairement autonome (aucun import React Native) : il tourne
// aussi bien dans l'app que dans les scripts de test Node (scénario J de
// scripts/e2e-stripe.mjs, qui vérifie le comportement réel sur un serveur muet).

export const REQUEST_TIMEOUT_MS = 20_000;

export class RequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Délai dépassé (${Math.round(timeoutMs / 1000)} s) : le serveur ne répond pas.`);
    this.name = "RequestTimeoutError";
  }
}

/** Vrai si l'erreur vient d'un abandon réseau (délai ou coupure). */
export function isTimeoutError(err: unknown): boolean {
  if (err instanceof RequestTimeoutError) return true;
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}

/**
 * `fetch` borné dans le temps : rejette avec RequestTimeoutError au lieu
 * d'attendre indéfiniment.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input as RequestInfo, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new RequestTimeoutError(timeoutMs);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
