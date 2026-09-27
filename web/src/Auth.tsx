import { useState } from "react";
import { supabase } from "./supabase";
import { humanError, needsEmailConfirmation } from "./errors";

// ---------------------------------------------------------------------------
// Authentification du back-office : se connecter ET créer un compte (le
// commerçant qui démarre sur ordinateur doit pouvoir tout faire ici), avec la
// même confirmation par code à 6 chiffres que l'app mobile.
// ---------------------------------------------------------------------------
type Mode = "signin" | "signup" | "verify";

export function Auth({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [otpType, setOtpType] = useState<"signup" | "email">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reset = (next: Mode) => {
    setMode(next);
    setError(null);
    setNotice(null);
    setCode("");
  };

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) setError(humanError(err.message, "Impossible de vous connecter. Réessayez."));
      else onSignedIn();
    } catch (err) {
      setError(humanError(err instanceof Error ? err.message : "", "Impossible de vous connecter. Réessayez."));
    } finally {
      setBusy(false);
    }
  };

  const signUp = async () => {
    setError(null);
    if (fullName.trim().length < 2) return setError("Indiquez votre prénom ou pseudo.");
    if (!email.trim()) return setError("Renseignez votre e-mail.");
    if (password.length < 6) return setError("Le mot de passe doit contenir au moins 6 caractères.");
    setBusy(true);
    try {
      const { data, error: err } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName.trim() } },
      });
      if (err) {
        if (needsEmailConfirmation(err.message)) {
          setOtpType("signup");
          setNotice("Ce compte existe déjà. Saisissez le code reçu par e-mail pour le confirmer.");
          setMode("verify");
          return;
        }
        setError(humanError(err.message, "Impossible de créer le compte. Réessayez."));
        return;
      }
      if (data.session) {
        onSignedIn();
        return;
      }
      setOtpType("signup");
      setNotice("Compte créé ✉️ Saisissez le code à 6 chiffres reçu par e-mail.");
      setMode("verify");
    } catch (err) {
      setError(humanError(err instanceof Error ? err.message : "", "Impossible de créer le compte. Réessayez."));
    } finally {
      setBusy(false);
    }
  };

  const sendCode = async () => {
    if (!email.trim()) return setError("Renseignez d'abord votre e-mail.");
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase.auth.signInWithOtp({ email });
      if (err) {
        setError(humanError(err.message, "Impossible d'envoyer le code. Réessayez."));
        return;
      }
      setOtpType("email");
      setNotice("Code envoyé par e-mail ✉️ Saisissez les 6 chiffres reçus.");
      setMode("verify");
    } catch (err) {
      setError(humanError(err instanceof Error ? err.message : "", "Impossible d'envoyer le code. Réessayez."));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!/^\d{6}$/.test(code.trim())) return setError("Saisissez les 6 chiffres du code reçu par e-mail.");
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase.auth.verifyOtp({
        email,
        token: code.trim(),
        type: otpType,
      });
      if (err) {
        setError(humanError(err.message, "Le code n'est pas valide. Réessayez."));
        return;
      }
      onSignedIn();
    } catch (err) {
      setError(humanError(err instanceof Error ? err.message : "", "Le code n'est pas valide. Réessayez."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="card login-card">
        <h1 className="logo">VOIZY</h1>
        <p className="tagline">
          {mode === "signup" ? "Créer mon compte commerçant" : "Back-office commerçant"}
        </p>
        <p className="muted small">
          0 % de commission sur vos ventes, pour toujours — Voizy se rémunère par abonnement,
          jamais sur vos transactions.
        </p>

        {mode === "signup" ? (
          <div className="field-group">
            <label className="field-label" htmlFor="signup-name">
              Votre prénom ou pseudo
            </label>
            <input
              id="signup-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="name"
            />
          </div>
        ) : null}

        <div className="field-group">
          <label className="field-label" htmlFor="login-email">
            E-mail
          </label>
          <input
            id="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </div>

        {mode !== "verify" ? (
          <div className="field-group">
            <label className="field-label" htmlFor="login-password">
              {mode === "signup" ? "Mot de passe (6 caractères minimum)" : "Mot de passe"}
            </label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />
          </div>
        ) : (
          <div className="field-group">
            <label className="field-label" htmlFor="login-code">
              Code reçu par e-mail (6 chiffres)
            </label>
            <input
              id="login-code"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="one-time-code"
            />
          </div>
        )}

        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? <p className="notice">{notice}</p> : null}

        {mode === "signin" ? (
          <>
            <button className="primary" onClick={signIn} disabled={busy}>
              {busy ? "…" : "Se connecter"}
            </button>
            <button className="ghost" onClick={sendCode} disabled={busy}>
              Recevoir un code par e-mail
            </button>
            <button className="ghost" onClick={() => reset("signup")} disabled={busy}>
              Créer un compte
            </button>
          </>
        ) : null}

        {mode === "signup" ? (
          <>
            <button className="primary" onClick={signUp} disabled={busy}>
              {busy ? "…" : "Créer mon compte"}
            </button>
            <button className="ghost" onClick={() => reset("signin")} disabled={busy}>
              J'ai déjà un compte
            </button>
          </>
        ) : null}

        {mode === "verify" ? (
          <>
            <button className="primary" onClick={verify} disabled={busy}>
              {busy ? "…" : "Valider le code"}
            </button>
            <button className="ghost" onClick={sendCode} disabled={busy}>
              Renvoyer un code
            </button>
            <button className="ghost" onClick={() => reset("signin")} disabled={busy}>
              Revenir à la connexion
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
