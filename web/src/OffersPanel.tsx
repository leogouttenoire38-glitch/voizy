import { useCallback, useEffect, useState } from "react";
import {
  businessError,
  createOffer,
  fetchMerchantOffers,
  setOfferActive,
  updateOffer,
} from "./api";
import type { Merchant, MerchantOffer, OfferInput } from "./types";

const UNIT_SUGGESTIONS = ["unité", "kg", "lot", "bouteille"];
const THRESHOLD_SUGGESTIONS = [3, 5, 10, 20];
const DEPOSIT_SUGGESTIONS = [0, 2, 5, 10];

const fmtEuro = (v: number | null | undefined) =>
  `${Number(v ?? 0).toFixed(2).replace(".", ",")} €`;

/** Saisie décimale française : « 4,50 » comme « 4.50 ». */
function parseAmount(text: string): number | null {
  const clean = text.replace(/\s/g, "").replace(",", ".");
  if (!clean) return null;
  const value = Number(clean);
  return Number.isFinite(value) ? value : null;
}

/**
 * Mes offres — catalogue du commerce, identique au mobile : mêmes RPC
 * (create_offer / update_offer / activate_offer / deactivate_offer), donc
 * exactement les mêmes règles et les mêmes validations.
 */
export function OffersPanel({ merchant }: { merchant: Merchant }) {
  const [offers, setOffers] = useState<MerchantOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [wizard, setWizard] = useState<{ mode: "create" } | { mode: "update"; offer: MerchantOffer } | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setOffers(await fetchMerchantOffers(merchant.id));
      setError(null);
    } catch (err) {
      setError(businessError(err, "Impossible de charger vos offres. Vérifiez votre connexion puis réessayez."));
    } finally {
      setLoading(false);
    }
  }, [merchant.id]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (offer: MerchantOffer) => {
    const retire = offer.active;
    const confirmed = window.confirm(
      retire
        ? "Retirer cette offre du catalogue ? Les commandes déjà lancées iront jusqu'au retrait."
        : "Remettre cette offre en vente ?",
    );
    if (!confirmed) return;
    setBusyId(offer.id);
    setError(null);
    try {
      await setOfferActive(offer.id, !offer.active);
      await load();
    } catch (err) {
      setError(businessError(err, "Impossible de mettre à jour cette offre. Réessayez."));
    } finally {
      setBusyId(null);
    }
  };

  if (wizard) {
    return (
      <OfferWizard
        merchantId={merchant.id}
        mode={wizard.mode}
        initial={wizard.mode === "update" ? wizard.offer : null}
        onCancel={() => setWizard(null)}
        onSaved={async () => {
          setWizard(null);
          await load();
        }}
      />
    );
  }

  return (
    <div>
      <div className="row" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Mes offres</h2>
        <button className="primary" onClick={() => setWizard({ mode: "create" })}>
          ＋ Créer une offre
        </button>
      </div>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="muted">Chargement…</p>
      ) : offers.length === 0 ? (
        <div className="card">
          <p>
            <strong>Aucune offre publiée.</strong>
          </p>
          <p className="muted">
            Publiez votre premier produit : vous choisissez le prix groupé, le nombre de voisins à
            atteindre et la caution. Vos offres apparaissent ensuite sur l'app mobile des voisins.
          </p>
          <button className="primary" onClick={() => setWizard({ mode: "create" })}>
            ＋ Créer ma première offre
          </button>
        </div>
      ) : (
        offers.map((offer) => {
          const discount =
            offer.base_price > 0
              ? Math.round(((offer.base_price - offer.group_price) / offer.base_price) * 100)
              : 0;
          return (
            <div className="card" key={offer.id}>
              <div className="offer-head">
                <span className={offer.active ? "badge brand" : "badge muted"}>
                  {offer.active ? "En vente" : "Retirée"}
                </span>
                {offer.open_orders > 0 ? (
                  <span className="badge accent">
                    {offer.open_orders} commande{offer.open_orders > 1 ? "s" : ""} en cours
                  </span>
                ) : null}
              </div>
              <h3 className="offer-title">{offer.title}</h3>
              {offer.description ? <p className="muted small">{offer.description}</p> : null}
              <p className="offer-price">
                <strong>{fmtEuro(offer.group_price)}</strong>{" "}
                <span className="strike">{fmtEuro(offer.base_price)}</span>
                {discount > 0 ? <span className="badge accent">−{discount} %</span> : null}
              </p>
              <p className="muted small">
                par {offer.unit_label} · à partir de {offer.threshold} participants · caution{" "}
                {fmtEuro(offer.deposit_amount)}
              </p>
              <div className="offer-actions">
                <button
                  className="secondary"
                  onClick={() => setWizard({ mode: "update", offer })}
                  disabled={busyId !== null}
                >
                  Modifier
                </button>
                <button
                  className={offer.active ? "ghost" : "primary"}
                  onClick={() => toggle(offer)}
                  disabled={busyId !== null}
                >
                  {busyId === offer.id ? "…" : offer.active ? "Retirer" : "Remettre"}
                </button>
              </div>
            </div>
          );
        })
      )}

      <p className="muted small">
        Les prix des commandes déjà lancées sont figés : modifier une offre ne change jamais ce
        qu'un voisin a déjà accepté.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assistant de création / modification : une décision par écran.
// ---------------------------------------------------------------------------
function OfferWizard({
  merchantId,
  mode,
  initial,
  onCancel,
  onSaved,
}: {
  merchantId: string;
  mode: "create" | "update";
  initial: MerchantOffer | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [unitLabel, setUnitLabel] = useState(initial?.unit_label ?? "unité");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [basePrice, setBasePrice] = useState(
    initial ? String(initial.base_price).replace(".", ",") : "",
  );
  const [groupPrice, setGroupPrice] = useState(
    initial ? String(initial.group_price).replace(".", ",") : "",
  );
  const [threshold, setThreshold] = useState(String(initial?.threshold ?? 5));
  const [deposit, setDeposit] = useState(initial ? String(initial.deposit_amount).replace(".", ",") : "5");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onBaseChange = (text: string) => {
    setBasePrice(text);
    const base = parseAmount(text);
    if (base !== null && base > 0 && groupPrice.trim() === "") {
      // Suggestion −20 %, arrondie au dizainier de centime.
      setGroupPrice((Math.round(base * 0.8 * 10) / 10).toFixed(2).replace(".", ","));
    }
  };

  const submit = async () => {
    const base = parseAmount(basePrice);
    const group = parseAmount(groupPrice);
    const dep = parseAmount(deposit);
    if (base === null || group === null || dep === null) {
      return setError("Vérifiez les montants saisis (prix et caution).");
    }
    const input: OfferInput = {
      title: title.trim(),
      description: description.trim() ? description.trim() : null,
      unit_label: unitLabel.trim() || "unité",
      base_price: base,
      group_price: group,
      threshold: Number(threshold),
      deposit_amount: dep,
    };
    setBusy(true);
    setError(null);
    try {
      if (mode === "create") await createOffer(merchantId, input);
      else await updateOffer(initial!.id, input);
      onSaved();
    } catch (err) {
      setError(
        businessError(
          err,
          mode === "create"
            ? "Impossible de publier l'offre. Vérifiez votre connexion puis réessayez."
            : "Impossible d'enregistrer vos modifications. Réessayez.",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2>{mode === "create" ? "Nouvelle offre" : "Modifier l'offre"}</h2>
      <p className="muted small">Étape {step} sur 4 — une seule décision par étape.</p>

      {step === 1 ? (
        <>
          <div className="field-group">
            <label className="field-label" htmlFor="offer-title">
              Nom du produit
            </label>
            <input
              id="offer-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex. : Huile d'olive 75 cl"
            />
          </div>
          <div className="field-group">
            <p className="field-label">Unité de vente</p>
            <div className="chips">
              {UNIT_SUGGESTIONS.map((unit) => (
                <button
                  key={unit}
                  className={unitLabel === unit ? "chip selected" : "chip"}
                  onClick={() => setUnitLabel(unit)}
                  aria-pressed={unitLabel === unit}
                >
                  {unit}
                </button>
              ))}
            </div>
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="offer-desc">
              Description (optionnel)
            </label>
            <input
              id="offer-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex. : huile extra vierge, récolte 2026"
            />
          </div>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <div className="field-group">
            <label className="field-label" htmlFor="offer-base">
              Prix normal, à l'unité (€)
            </label>
            <input
              id="offer-base"
              inputMode="decimal"
              value={basePrice}
              onChange={(e) => onBaseChange(e.target.value)}
              placeholder="Ex. : 9,50"
            />
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="offer-group">
              Prix groupé (€) — appliqué si le seuil est atteint
            </label>
            <input
              id="offer-group"
              inputMode="decimal"
              value={groupPrice}
              onChange={(e) => setGroupPrice(e.target.value)}
              placeholder="Ex. : 7,60"
            />
            <p className="muted small">
              Nous vous suggérons −20 %. Le prix groupé ne peut jamais dépasser le prix normal.
            </p>
          </div>
        </>
      ) : null}

      {step === 3 ? (
        <>
          <p className="field-label">Combien de voisins faut-il pour débloquer le prix ?</p>
          <div className="chips">
            {THRESHOLD_SUGGESTIONS.map((value) => (
              <button
                key={value}
                className={Number(threshold) === value ? "chip selected" : "chip"}
                onClick={() => setThreshold(String(value))}
                aria-pressed={Number(threshold) === value}
              >
                {value} voisins
              </button>
            ))}
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="offer-threshold">
              Nombre de participants (2 à 100)
            </label>
            <input
              id="offer-threshold"
              inputMode="numeric"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
            <p className="muted small">
              Un seuil bas se remplit vite ; un seuil haut offre un meilleur prix. La commande se
              confirme automatiquement si le seuil est atteint avant la date de retrait.
            </p>
          </div>
        </>
      ) : null}

      {step === 4 ? (
        <>
          <p className="field-label">
            Caution (€) — pré-autorisée, jamais débitée si le retrait est effectué
          </p>
          <div className="chips">
            {DEPOSIT_SUGGESTIONS.map((value) => (
              <button
                key={value}
                className={Number(deposit) === value ? "chip selected" : "chip"}
                onClick={() => setDeposit(String(value))}
                aria-pressed={Number(deposit) === value}
              >
                {value === 0 ? "Aucune" : `${value} €`}
              </button>
            ))}
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="offer-deposit">
              Montant de la caution (0 à 200 €)
            </label>
            <input
              id="offer-deposit"
              inputMode="decimal"
              value={deposit}
              onChange={(e) => setDeposit(e.target.value)}
            />
          </div>
          <div className="card recap">
            <p>
              <strong>Récapitulatif</strong>
            </p>
            <p>{title.trim()}</p>
            <p>
              {fmtEuro(parseAmount(groupPrice))} au lieu de {fmtEuro(parseAmount(basePrice))} par{" "}
              {unitLabel.trim() || "unité"}
            </p>
            <p>
              Seuil : {threshold} participants · caution {fmtEuro(parseAmount(deposit))}
            </p>
            <p className="muted small">
              Commission Voizy : 0 % — vous recevez 100 % de vos ventes, hors frais bancaires
              standards.
            </p>
          </div>
        </>
      ) : null}

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      {step < 4 ? (
        <button
          className="primary"
          disabled={busy}
          onClick={() => {
            setError(null);
            if (step === 1) {
              if (title.trim().length < 2) return setError("Indiquez le nom du produit.");
              setStep(2);
              return;
            }
            if (step === 2) {
              const base = parseAmount(basePrice);
              const group = parseAmount(groupPrice);
              if (base === null || base <= 0) return setError("Indiquez le prix normal (en euros, supérieur à 0).");
              if (group === null || group <= 0) return setError("Indiquez le prix groupé (en euros, supérieur à 0).");
              if (group > base) return setError("Le prix groupé doit être inférieur ou égal au prix normal.");
              setStep(3);
              return;
            }
            const t = Number(threshold);
            if (!Number.isInteger(t) || t < 2 || t > 100) {
              return setError("Le seuil doit être un nombre entier entre 2 et 100 participants.");
            }
            setStep(4);
          }}
        >
          Continuer
        </button>
      ) : (
        <button className="primary" disabled={busy} onClick={submit}>
          {busy ? "Enregistrement…" : mode === "create" ? "Publier mon offre" : "Enregistrer"}
        </button>
      )}

      {step > 1 ? (
        <button className="ghost" onClick={() => setStep(step - 1)} disabled={busy}>
          ‹ Retour
        </button>
      ) : null}
      <button className="ghost" onClick={onCancel} disabled={busy}>
        Annuler
      </button>
    </div>
  );
}
