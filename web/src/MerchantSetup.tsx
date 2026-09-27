import { useState } from "react";
import { businessError, createMyMerchant, geocodeAddress, merchantOnboarding } from "./api";
import { MERCHANT_CATEGORIES, MERCHANT_CATEGORY_LABELS } from "./types";

// Création du commerce par le commerçant lui-même : trois décisions simples
// (nom → catégorie → adresse), exactement le même parcours que sur mobile.
export function MerchantSetup({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geoFailed, setGeoFailed] = useState(false);
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const create = async (skipGeocoding: boolean) => {
    setBusy(true);
    setError(null);
    setGeoFailed(false);
    try {
      let lat: number | null = null;
      let lng: number | null = null;
      if (!skipGeocoding) {
        try {
          const geo = await geocodeAddress(address.trim());
          lat = geo.lat;
          lng = geo.lng;
        } catch {
          setGeoFailed(true);
          setError(
            "Nous n'avons pas réussi à situer cette adresse. Vérifiez-la, ou créez votre commerce sans localisation (vous pourrez la corriger plus tard).",
          );
          return;
        }
      }
      const merchant = await createMyMerchant({
        name: name.trim(),
        category: category ?? "autres",
        address: address.trim(),
        lat,
        lng,
        description: description.trim() ? description.trim() : null,
      });
      setCreated({ id: merchant.id, name: merchant.name });
    } catch (err) {
      setError(businessError(err, "Impossible de créer votre commerce. Vérifiez votre connexion puis réessayez."));
    } finally {
      setBusy(false);
    }
  };

  const startPayouts = async () => {
    if (!created) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await merchantOnboarding(created.id, `${window.location.origin}/`);
      if (res.ok && res.url) {
        window.open(res.url, "_blank", "noopener");
        setNotice(
          "Stripe vient de s'ouvrir dans un nouvel onglet. Revenez ici une fois le parcours terminé : vos paiements seront vérifiés automatiquement.",
        );
      } else {
        setNotice(res.error ?? "Impossible de créer le lien de paiement. Réessayez.");
      }
    } catch (err) {
      setNotice(businessError(err, "Impossible de créer le lien de paiement. Réessayez."));
    } finally {
      setBusy(false);
    }
  };

  // --- Le commerce existe : on propose les paiements puis le tableau de bord.
  if (created) {
    return (
      <div className="card">
        <h2>Votre commerce est prêt 🎉</h2>
        <p>
          <strong>{created.name}</strong> est maintenant sur Voizy. Publiez vos offres dès
          maintenant, et activez vos paiements pour recevoir l'argent de vos ventes.
        </p>
        <p className="muted small">
          Sans compte de paiement, vos offres restent visibles mais vos ventes ne peuvent pas vous
          être versées. Vous pourrez le finaliser à tout moment.
        </p>
        <button className="primary" onClick={startPayouts} disabled={busy}>
          {busy ? "Ouverture de Stripe…" : "Finaliser mon compte de paiement ↗"}
        </button>
        <button className="ghost" onClick={onDone} disabled={busy}>
          Je le ferai plus tard — continuer
        </button>
        {notice ? <p className="notice">{notice}</p> : null}
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Votre commerce</h2>
      <p className="muted small">
        Étape {step} sur 3 — trois informations suffisent, vous pourrez tout modifier plus tard.
      </p>

      {step === 1 ? (
        <>
          <div className="field-group">
            <label className="field-label" htmlFor="merchant-name">
              Nom de votre commerce
            </label>
            <input
              id="merchant-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="organization"
            />
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="merchant-desc">
              Description (optionnel)
            </label>
            <input
              id="merchant-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </>
      ) : null}

      {step === 2 ? (
        <div className="field-group">
          <p className="field-label">Quelle est votre activité ?</p>
          <div className="chips">
            {MERCHANT_CATEGORIES.map((key) => (
              <button
                key={key}
                className={category === key ? "chip selected" : "chip"}
                onClick={() => setCategory(key)}
                aria-pressed={category === key}
              >
                {MERCHANT_CATEGORY_LABELS[key]}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="field-group">
          <label className="field-label" htmlFor="merchant-address">
            Adresse de votre commerce
          </label>
          <input
            id="merchant-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Ex. : 12 rue de Cotte, 75012 Paris"
          />
          <p className="muted small">
            Elle sert à faire apparaître votre commerce dans « Découvrir », autour de votre
            quartier.
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      {step === 1 ? (
        <button
          className="primary"
          disabled={busy}
          onClick={() => {
            setError(null);
            if (name.trim().length < 2) return setError("Indiquez le nom de votre commerce.");
            setStep(2);
          }}
        >
          Continuer
        </button>
      ) : null}

      {step === 2 ? (
        <>
          <button
            className="primary"
            disabled={busy}
            onClick={() => {
              setError(null);
              if (!category) return setError("Choisissez la catégorie de votre commerce.");
              setStep(3);
            }}
          >
            Continuer
          </button>
          <button className="ghost" onClick={() => setStep(1)} disabled={busy}>
            ‹ Retour
          </button>
        </>
      ) : null}

      {step === 3 ? (
        <>
          <button
            className="primary"
            disabled={busy}
            onClick={() => {
              setError(null);
              if (address.trim().length < 4) {
                return setError("Indiquez l'adresse de votre commerce (ex. « 12 rue de Cotte, Paris »).");
              }
              void create(false);
            }}
          >
            {busy ? "Création…" : "Créer mon commerce"}
          </button>
          {geoFailed ? (
            <button className="secondary" disabled={busy} onClick={() => void create(true)}>
              Créer sans localiser mon commerce
            </button>
          ) : null}
          <button className="ghost" onClick={() => setStep(2)} disabled={busy}>
            ‹ Retour
          </button>
        </>
      ) : null}
    </div>
  );
}
