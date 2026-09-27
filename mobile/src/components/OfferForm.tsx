import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { BackButton, Button, Card, Chip, Field, ProgressSteps, Screen } from "./ui";
import { colors, fonts, fontSizes, lineHeights, radius, spacing, touch } from "../theme";
import { businessError, createOffer, updateOffer } from "../lib/merchant";
import { formatPrice } from "../lib/format";
import type { Offer, OfferInput } from "../types";

// Formulaire d'offre, identique à la création et à la modification.
// QUATRE décisions, une par écran : le produit, le prix, le seuil, la caution.
// Les champs arrivent pré-remplis avec des valeurs raisonnables (un commerçant
// néophyte ne doit jamais faire face à une page blanche) et les règles sont
// revalidées côté base (create_offer / update_offer) — une seule source de vérité.
const UNIT_SUGGESTIONS = ["unité", "kg", "lot", "bouteille"];
const THRESHOLD_SUGGESTIONS = [3, 5, 10, 20];
const DEPOSIT_SUGGESTIONS = [0, 2, 5, 10];

/** Saisie décimale française : « 4,50 » comme « 4.50 ». null si vide/invalide. */
export function parseAmount(text: string): number | null {
  const clean = text.replace(/\s/g, "").replace(",", ".");
  if (!clean) return null;
  const value = Number(clean);
  return Number.isFinite(value) ? value : null;
}

function suggestGroupPrice(base: number): string {
  // −20 %, arrondi au dizainier de centime : une suggestion, jamais une règle.
  const suggested = Math.round((base * 0.8) * 10) / 10;
  return suggested.toFixed(2).replace(".", ",");
}

export function OfferForm({
  mode,
  merchantId,
  initial,
  onSaved,
}: {
  mode: "create" | "update";
  merchantId: string;
  initial?: Offer | null;
  onSaved: (offer: Offer) => void;
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
  const [deposit, setDeposit] = useState(
    initial ? String(initial.deposit_amount).replace(".", ",") : "5",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = 4;

  // Suggestion de prix groupé : remplie dès qu'un prix normal est saisi, tant
  // que le commerçant n'a pas écrit son propre prix.
  const onBaseChange = (text: string) => {
    setBasePrice(text);
    const base = parseAmount(text);
    if (base !== null && base > 0 && groupPrice.trim() === "") {
      setGroupPrice(suggestGroupPrice(base));
    }
  };

  const next = () => {
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
    if (step === 3) {
      const t = Number(threshold);
      if (!Number.isInteger(t) || t < 2 || t > 100) {
        return setError("Le seuil doit être un nombre entier entre 2 et 100 participants.");
      }
      setStep(4);
      return;
    }
    void submit();
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
      const offer =
        mode === "create"
          ? await createOffer(merchantId, input)
          : await updateOffer(initial!.id, input);
      onSaved(offer);
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
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.hero}>
          <BackButton />
          <Text style={styles.title}>{mode === "create" ? "Nouvelle offre" : "Modifier l'offre"}</Text>
          <Text style={styles.subtitle}>
            {mode === "create"
              ? "Quatre étapes simples. Vous pourrez tout changer plus tard."
              : "Vos modifications ne changent pas les commandes déjà lancées : leurs prix sont figés au moment où un voisin les rejoint."}
          </Text>
        </View>

        <ProgressSteps current={step} total={total} />

        {step === 1 ? (
          <>
            <Field
              label="Nom du produit"
              value={title}
              onChangeText={setTitle}
              placeholder="Ex. : Huile d'olive 75 cl"
              autoCapitalize="sentences"
            />
            <Text style={styles.sectionLabel}>Unité de vente</Text>
            <View style={styles.chipsWrap}>
              {UNIT_SUGGESTIONS.map((unit) => (
                <Chip key={unit} label={unit} selected={unitLabel === unit} onPress={() => setUnitLabel(unit)} />
              ))}
            </View>
            <Field
              label="Description (optionnel)"
              value={description}
              onChangeText={setDescription}
              placeholder="Ex. : huile extra vierge, récolte 2026"
              multiline
            />
          </>
        ) : null}

        {step === 2 ? (
          <>
            <Field
              label="Prix normal, à l'unité (€)"
              value={basePrice}
              onChangeText={onBaseChange}
              keyboardType="decimal-pad"
              placeholder="Ex. : 9,50"
            />
            <Field
              label="Prix groupé (€) — appliqué si le seuil est atteint"
              value={groupPrice}
              onChangeText={setGroupPrice}
              keyboardType="decimal-pad"
              placeholder="Ex. : 7,60"
            />
            <Text style={styles.hint}>
              Nous vous suggérons −20 %. Le prix groupé ne peut jamais dépasser le prix normal.
            </Text>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <Text style={styles.sectionLabel}>Combien de voisins faut-il pour débloquer le prix ?</Text>
            <View style={styles.chipsWrap}>
              {THRESHOLD_SUGGESTIONS.map((value) => (
                <Chip
                  key={value}
                  label={`${value} voisins`}
                  selected={Number(threshold) === value}
                  onPress={() => setThreshold(String(value))}
                />
              ))}
            </View>
            <Field
              label="Nombre de participants (2 à 100)"
              value={threshold}
              onChangeText={setThreshold}
              keyboardType="number-pad"
            />
            <Text style={styles.hint}>
              Un seuil bas se remplit vite ; un seuil haut offre un meilleur prix. La commande se
              confirme automatiquement si le seuil est atteint avant la date de retrait.
            </Text>
          </>
        ) : null}

        {step === 4 ? (
          <>
            <Text style={styles.sectionLabel}>Caution (€) — pré-autorisée, jamais débitée si le retrait est effectué</Text>
            <View style={styles.chipsWrap}>
              {DEPOSIT_SUGGESTIONS.map((value) => (
                <Chip
                  key={value}
                  label={value === 0 ? "Aucune" : `${value} €`}
                  selected={Number(deposit) === value}
                  onPress={() => setDeposit(String(value))}
                />
              ))}
            </View>
            <Field
              label="Montant de la caution (0 à 200 €)"
              value={deposit}
              onChangeText={setDeposit}
              keyboardType="decimal-pad"
            />
            <Text style={styles.hint}>
              La caution n'est débitée que si un voisin ne vient pas retirer sa commande (no-show).
            </Text>

            <Card style={styles.recap}>
              <Text style={styles.recapTitle}>Récapitulatif</Text>
              <Text style={styles.recapLine}>{title.trim()}</Text>
              <Text style={styles.recapLine}>
                {formatPrice(parseAmount(groupPrice))} au lieu de {formatPrice(parseAmount(basePrice))} par{" "}
                {unitLabel.trim() || "unité"}
              </Text>
              <Text style={styles.recapLine}>
                Seuil : {threshold} participants · caution {formatPrice(parseAmount(deposit))}
              </Text>
              <Text style={styles.recapNote}>
                Commission Voizy : 0 % — vous recevez 100 % de vos ventes, hors frais bancaires
                standards.
              </Text>
            </Card>
            <Text style={styles.categoryNote}>
              Privilégiez les produits non périssables (épicerie, conserves, boissons) : ce sont
              ceux que les voisins peuvent retirer plusieurs jours après la commande.
            </Text>
          </>
        ) : null}

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Button
          title={step === total ? (mode === "create" ? "Publier mon offre" : "Enregistrer") : "Continuer"}
          onPress={next}
          loading={busy}
          disabled={busy}
        />
        {step > 1 ? (
          <Pressable
            onPress={() => {
              setError(null);
              setStep(step - 1);
            }}
            accessibilityRole="button"
            style={styles.backLink}
          >
            <Text style={styles.backLinkText}>‹ Retour</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { marginTop: 32, marginBottom: spacing.lg },
  title: { fontSize: fontSizes.display, fontWeight: "800", color: colors.ink, marginTop: 12, fontFamily: fonts.extraBold, lineHeight: lineHeights.display },
  subtitle: { fontSize: fontSizes.body, color: colors.inkMuted, marginTop: 8, lineHeight: lineHeights.body, fontFamily: fonts.regular },
  sectionLabel: { fontSize: fontSizes.heading, fontWeight: "700", color: colors.ink, marginBottom: spacing.sm, fontFamily: fonts.bold },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  hint: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, marginBottom: spacing.md, lineHeight: lineHeights.bodySmall, fontFamily: fonts.regular },
  recap: { marginBottom: spacing.md },
  recapTitle: { fontSize: fontSizes.heading, fontWeight: "800", color: colors.ink, fontFamily: fonts.extraBold },
  recapLine: { fontSize: fontSizes.body, color: colors.ink, marginTop: 6, fontFamily: fonts.medium },
  recapNote: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, marginTop: spacing.sm, lineHeight: lineHeights.bodySmall, fontFamily: fonts.regular },
  categoryNote: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, fontFamily: fonts.regular },
  errorBox: { backgroundColor: colors.dangerSoft, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  errorText: { color: colors.danger, fontSize: fontSizes.body, fontFamily: fonts.medium },
  backLink: { minHeight: touch.secondary, justifyContent: "center", alignItems: "center", marginTop: spacing.sm },
  backLinkText: { color: colors.brand, fontSize: fontSizes.body, fontFamily: fonts.bold },
});
