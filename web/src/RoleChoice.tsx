import { useState } from "react";
import { chooseRole } from "./api";
import { businessError } from "./api";
import type { UserRole } from "./types";

// Même bascule de rôle que sur mobile : un compte Voizy a UN rôle actif.
export function RoleChoice({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState<UserRole | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async (role: UserRole) => {
    setBusy(role);
    setError(null);
    try {
      await chooseRole(role);
      onDone();
    } catch (err) {
      setError(businessError(err, "Impossible d'enregistrer votre choix. Réessayez."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="login">
      <div className="card login-card">
        <h1 className="logo">VOIZY</h1>
        <p className="tagline">Vous êtes plutôt…</p>
        <p className="muted small">
          Ce choix définit votre espace Voizy. Un compte a un seul rôle actif.
        </p>

        <button
          className="choice"
          onClick={() => pick("merchant")}
          disabled={busy !== null}
          aria-label="Un commerçant — je veux vendre mes produits"
        >
          <span className="choice-icon" aria-hidden="true">
            🏪
          </span>
          <span>
            <strong>Un commerçant</strong>
            <span className="choice-hint">
              Je veux vendre mes produits, avec 0 % de commission sur mes ventes.
            </span>
          </span>
        </button>

        <button
          className="choice"
          onClick={() => pick("buyer")}
          disabled={busy !== null}
          aria-label="Un voisin — je veux acheter groupé"
        >
          <span className="choice-icon" aria-hidden="true">
            🧺
          </span>
          <span>
            <strong>Un voisin</strong>
            <span className="choice-hint">
              Je veux acheter groupé avec mon quartier. L'espace de vente n'est pas nécessaire.
            </span>
          </span>
        </button>

        {busy ? <p className="muted small">Enregistrement…</p> : null}
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Un compte voisin n'a rien à faire dans le back-office : on le dit clairement. */
export function BuyerNotice({ onSignOut }: { onSignOut: () => void }) {
  return (
    <div className="login">
      <div className="card login-card">
        <h1 className="logo">VOIZY</h1>
        <p className="tagline">Votre compte est un compte voisin</p>
        <p className="muted">
          Cet espace sert aux commerçants pour publier leurs offres et suivre leurs ventes. En tant
          que voisin, tout se passe dans l'application mobile Voizy : découvrir les commandes
          groupées de votre quartier et y participer.
        </p>
        <button className="ghost" onClick={onSignOut}>
          Se déconnecter
        </button>
      </div>
    </div>
  );
}
