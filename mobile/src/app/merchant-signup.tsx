import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { BackButton, Button, Chip, Field, ProgressSteps, Screen } from "../components/ui";
import { colors, fonts, fontSizes, lineHeights, radius, spacing, touch } from "../theme";
import { useAuth } from "../lib/auth";
import { geocodeAddress } from "../lib/api";
import { businessError, createMyMerchant, startMerchantOnboarding } from "../lib/merchant";
import { MERCHANT_CATEGORY_LABELS } from "../types";
import type { MerchantCategory } from "../types";

// Création du commerce par le commerçant lui-même : 3 décisions simples
// (nom → catégorie → adresse), puis le compte de paiement. Aucune étape ne
// bloque : le commerce existe dès la 3e étape, les paiements s'activent ensuite.
const CATEGORIES = Object.keys(MERCHANT_CATEGORY_LABELS) as MerchantCategory[];

type Step = 1 | 2 | 3 | 4;

export default function MerchantSignUpScreen() {
  const router = useRouter();
  const { session, profile, refreshProfile } = useAuth();

  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<MerchantCategory | null>(null);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Le géocodage peut échouer (adresse peu connue, réseau) : on laisse alors
  // créer le commerce quand même, la géolocalisation n'est pas une condition.
  const [locating, setLocating] = useState(false);
  const [geoFailed, setGeoFailed] = useState(false);
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!session) return <Redirect href="/sign-in" />;
  if (profile && profile.role !== "merchant") return <Redirect href="/role" />;

  const next = () => {
    setError(null);
    if (step === 1) {
      if (name.trim().length < 2) return setError("Indiquez le nom de votre commerce.");
      setStep(2);
      return;
    }
    if (step === 2) {
      if (!category) return setError("Choisissez la catégorie de votre commerce.");
      setStep(3);
      return;
    }
    if (step === 3) {
      if (address.trim().length < 4) {
        return setError("Indiquez l'adresse de votre commerce (ex. « 12 rue de Cotte, Paris »).");
      }
      void create(false);
    }
  };

  const create = async (skipGeocoding: boolean) => {
    setBusy(true);
    setError(null);
    setGeoFailed(false);
    try {
      let lat: number | null = null;
      let lng: number | null = null;

      if (!skipGeocoding) {
        setLocating(true);
        try {
          const geo = await geocodeAddress(address.trim());
          lat = geo.lat;
          lng = geo.lng;
        } catch {
          // Adresse introuvable : on propose de créer sans localisation.
          setGeoFailed(true);
          setError(
            "Nous n'avons pas réussi à situer cette adresse. Vérifiez-la, ou créez votre commerce sans localisation (vous pourrez la corriger plus tard).",
          );
          return;
        } finally {
          setLocating(false);
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
      setMerchantId(merchant.id);
      await refreshProfile();
      setStep(4);
    } catch (err) {
      setError(
        businessError(
          err,
          "Impossible de créer votre commerce. Vérifiez votre connexion puis réessayez.",
        ),
      );
    } finally {
      setLocating(false);
      setBusy(false);
    }
  };

  const startPayouts = async () => {
    if (!merchantId) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await startMerchantOnboarding(merchantId);
      setNotice(
        res.ok
          ? "Compte de paiement activé ✅ Vous recevrez l'argent de vos ventes directement."
          : res.error,
      );
    } finally {
      setBusy(false);
    }
  };

  // --- Écran final : le commerce existe, on propose les paiements
  if (step === 4) {
    return (
      <Screen>
        <View style={styles.hero}>
          <Text style={styles.bigIcon}>🎉</Text>
          <Text style={styles.title}>Votre commerce est prêt</Text>
          <Text style={styles.subtitle}>
            {name.trim()} est maintenant sur Voizy. Publiez vos offres dès maintenant, et activez
            vos paiements pour recevoir l'argent de vos ventes.
          </Text>
          <View style={styles.promise}>
            <Text style={styles.promiseTitle}>0 % de commission sur vos ventes, pour toujours</Text>
            <Text style={styles.promiseText}>
              Vous gardez 100 % de vos ventes, hors frais bancaires standards. Voizy se rémunère par
              abonnement, jamais sur vos transactions.
            </Text>
          </View>
        </View>

        {notice ? (
          <View style={styles.noticeBox}>
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        ) : null}

        <Button
          title="Finaliser mon compte de paiement"
          onPress={startPayouts}
          loading={busy}
          disabled={busy}
        />
        <Button
          title="Je le ferai plus tard"
          variant="ghost"
          onPress={() => router.replace("/offers")}
          disabled={busy}
        />
        <Text style={styles.footnote}>
          Sans compte de paiement, vos offres restent visibles mais vos ventes ne peuvent pas vous
          être versées. Vous pouvez le finaliser à tout moment depuis Profil.
        </Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.hero}>
          <BackButton />
          <Text style={styles.logo}>Votre commerce</Text>
          <Text style={styles.subtitle}>
            Trois informations suffisent. Vous pourrez tout modifier plus tard.
          </Text>
        </View>

        <ProgressSteps current={step} total={3} />

        {step === 1 ? (
          <>
            <Field
              label="Nom de votre commerce"
              value={name}
              onChangeText={setName}
              placeholder="Ex. : Épicerie du coin"
              autoCapitalize="words"
              returnKeyType="next"
            />
            <Field
              label="Description (optionnel)"
              value={description}
              onChangeText={setDescription}
              placeholder="Ex. : produits secs, épices et conserves"
              multiline
            />
          </>
        ) : null}

        {step === 2 ? (
          <View style={styles.chipsWrap}>
            <Text style={styles.sectionLabel}>Quelle est votre activité ?</Text>
            {CATEGORIES.map((key) => (
              <Chip
                key={key}
                label={MERCHANT_CATEGORY_LABELS[key]}
                selected={category === key}
                onPress={() => setCategory(key)}
              />
            ))}
          </View>
        ) : null}

        {step === 3 ? (
          <>
            <Field
              label="Adresse de votre commerce"
              value={address}
              onChangeText={setAddress}
              placeholder="Ex. : 12 rue de Cotte, 75012 Paris"
              autoCapitalize="words"
            />
            <Text style={styles.hint}>
              Elle sert à faire apparaître votre commerce dans « Découvrir », autour de votre
              quartier.
            </Text>
          </>
        ) : null}

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Button
          title={step === 3 ? "Créer mon commerce" : "Continuer"}
          onPress={next}
          loading={busy || locating}
          disabled={busy}
        />
        {step === 3 && geoFailed ? (
          <Button
            title="Créer sans localiser mon commerce"
            variant="secondary"
            onPress={() => void create(true)}
            disabled={busy}
          />
        ) : null}
        {step > 1 ? (
          <Pressable
            onPress={() => {
              setError(null);
              setStep((step - 1) as Step);
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
  logo: { fontSize: fontSizes.display, fontWeight: "800", color: colors.ink, marginTop: 12, fontFamily: fonts.extraBold, lineHeight: lineHeights.display },
  bigIcon: { fontSize: 46, marginTop: 24 },
  title: { fontSize: fontSizes.display, fontWeight: "800", color: colors.ink, marginTop: 8, fontFamily: fonts.extraBold, lineHeight: lineHeights.display },
  subtitle: { fontSize: fontSizes.body, color: colors.inkMuted, marginTop: 8, lineHeight: lineHeights.body, fontFamily: fonts.regular },
  sectionLabel: { fontSize: fontSizes.heading, fontWeight: "700", color: colors.ink, marginBottom: spacing.sm, fontFamily: fonts.bold },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  hint: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, marginBottom: spacing.md, lineHeight: lineHeights.bodySmall, fontFamily: fonts.regular },
  promise: { marginTop: spacing.lg, backgroundColor: colors.brandSoft, borderRadius: radius.md, padding: spacing.md },
  promiseTitle: { fontSize: fontSizes.body, color: colors.ink, fontFamily: fonts.semiBold },
  promiseText: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, lineHeight: lineHeights.bodySmall, marginTop: 4, fontFamily: fonts.regular },
  noticeBox: { backgroundColor: colors.success, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  noticeText: { color: colors.ink, fontSize: fontSizes.body, lineHeight: lineHeights.body, fontFamily: fonts.medium },
  errorBox: { backgroundColor: colors.dangerSoft, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  errorText: { color: colors.danger, fontSize: fontSizes.body, fontFamily: fonts.medium },
  backLink: { minHeight: touch.secondary, justifyContent: "center", alignItems: "center", marginTop: spacing.sm },
  backLinkText: { color: colors.brand, fontSize: fontSizes.body, fontFamily: fonts.bold },
  footnote: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, marginTop: spacing.md, lineHeight: lineHeights.bodySmall, fontFamily: fonts.regular },
});
