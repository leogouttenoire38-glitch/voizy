import type { PayoutState } from "./types";

/**
 * Bandeau « compte de paiement » : visible tant que Stripe n'a pas confirmé le
 * compte — sur web comme sur mobile, un commerçant ne doit jamais découvrir
 * trop tard que l'argent de ses ventes ne peut pas lui être versé.
 */
export function PayoutBanner({
  state,
  busy,
  notice,
  onStart,
  onRetry,
}: {
  state: PayoutState;
  busy?: boolean;
  notice?: string | null;
  onStart?: () => void;
  onRetry?: () => void;
}) {
  if (state === "ready") {
    return (
      <div className="card banner ok">
        <p>
          <strong>✅ Paiements actifs.</strong> Vous recevez l'argent de vos ventes directement sur
          votre compte bancaire. Commission Voizy sur vos ventes : 0 %, pour toujours.
        </p>
        {notice ? <p className="muted small">{notice}</p> : null}
      </div>
    );
  }

  if (state === "unknown") {
    return (
      <div className="card banner">
        <p>
          <strong>Paiements : vérification impossible.</strong> Nous n'avons pas pu vérifier votre
          compte de paiement. Réessayez dans un instant.
        </p>
        {onRetry ? (
          <button className="secondary" onClick={onRetry} disabled={busy}>
            Vérifier à nouveau
          </button>
        ) : null}
        {notice ? <p className="muted small">{notice}</p> : null}
      </div>
    );
  }

  return (
    <div className="card banner">
      <p>
        <strong>Finalisez votre compte de paiement.</strong> Vous pouvez publier vos offres dès
        maintenant ; pour recevoir l'argent de vos ventes, finalisez votre compte de paiement chez
        Stripe (environ 5 minutes). Tout est sécurisé par Stripe : aucune coordonnée bancaire ne
        passe par Voizy.
      </p>
      <p className="muted small">
        Commission Voizy sur vos ventes : 0 %, pour toujours — vous gardez 100 % de vos ventes, hors
        frais bancaires standards.
      </p>
      {onStart ? (
        <button className="primary" onClick={onStart} disabled={busy}>
          {busy ? "Ouverture de Stripe…" : "Finaliser mon compte de paiement ↗"}
        </button>
      ) : null}
      {notice ? <p className="muted small">{notice}</p> : null}
    </div>
  );
}
