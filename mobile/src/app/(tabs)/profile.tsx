import React, { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import Constants from "expo-constants";
import { Badge, Button, Card, LoadError, Row, Screen, ScreenHeader } from "../../components/ui";
import { PayoutBanner } from "../../components/PayoutBanner";
import { colors, fonts, fontSizes, lineHeights, radius, spacing, touch } from "../../theme";
import { useAuth } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import { setupPaymentStatus } from "../../lib/api";
import { attemptLoad } from "../../lib/load";
import {
  fetchMyMerchant,
  fetchMyPlan,
  fetchPayoutState,
  startMerchantOnboarding,
} from "../../lib/merchant";
import type { PayoutState } from "../../lib/merchant";
import type { Merchant, MerchantPlan } from "../../types";

type CardState = "loading" | "yes" | "no" | "unknown";

// Version affichée : lue dans la config embarquée du build, pour qu'elle
// corresponde toujours au binaire réellement installé (jamais de valeur figée).
const appVersion = Constants.expoConfig?.version ?? "0.2.0";
const appBuildNumber = Constants.expoConfig?.android?.versionCode;
const buildLabel = appBuildNumber
  ? `Voizy · v${appVersion} (build ${appBuildNumber})`
  : `Voizy · v${appVersion}`;

export default function ProfileScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const isMerchant = profile?.role === "merchant";
  // Capturé hors du callback de focus : la dépendance reste une valeur stable
  // (un objet profil recréé à chaque rendu relancerait le chargement).
  const profileId = profile?.id ?? null;

  const [cardState, setCardState] = useState<CardState>("loading");
  const [signingOut, setSigningOut] = useState(false);

  // Espace commerçant (uniquement pour un compte commerçant)
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [payout, setPayout] = useState<PayoutState>("unknown");
  const [plan, setPlan] = useState<MerchantPlan | null>(null);
  const [merchantLoaded, setMerchantLoaded] = useState(false);
  const [merchantError, setMerchantError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [payNotice, setPayNotice] = useState<string | null>(null);

  const loadMerchant = useCallback(async () => {
    if (!profileId) return;
    // attemptLoad ne lève jamais : un échec devient un message + « Réessayer »,
    // jamais un « Créer mon commerce » qui laisserait croire à un commerce absent.
    const res = await attemptLoad(async () => {
      const mine = await fetchMyMerchant(profileId);
      if (!mine) return null;
      const [payoutState, myPlan] = await Promise.all([
        fetchPayoutState(mine.id),
        fetchMyPlan(mine.id),
      ]);
      return { mine, payoutState, myPlan };
    }, "Impossible de charger votre espace commerçant. Vérifiez votre connexion puis réessayez.");

    if (res.ok && res.data) {
      setMerchant(res.data.mine);
      setPayout(res.data.payoutState);
      setPlan(res.data.myPlan);
    }
    setMerchantError(res.ok ? null : res.error);
    setMerchantLoaded(true);
    setRetrying(false);
  }, [profileId]);

  // Vérifié à chaque affichage de l'onglet : au retour de l'écran Paiement (qui
  // porte le bouton « Réessayer » de cette vérification), l'état est à jour.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      if (!isMerchant) {
        (async () => {
          // attemptLoad ne lève jamais : en cas d'échec on affiche un état honnête
          // (« vérification impossible ») au lieu de mentir avec « Aucune carte ».
          const res = await attemptLoad(async () => {
            const status = await setupPaymentStatus();
            if (!status.ok) throw new Error(status.error || "statut carte indisponible");
            return Boolean(status.has_payment_method);
          }, "Vérification impossible — ouvrez la carte pour réessayer.");
          if (cancelled) return;
          setCardState(res.ok ? (res.data ? "yes" : "no") : "unknown");
        })();
        return () => {
          cancelled = true;
        };
      }

      if (!profileId) {
        setMerchantLoaded(true);
        return () => {
          cancelled = true;
        };
      }

      void loadMerchant();

      return () => {
        cancelled = true;
      };
    }, [isMerchant, profileId, loadMerchant]),
  );

  const startPayouts = async () => {
    if (!merchant) return;
    setPayBusy(true);
    setPayNotice(null);
    try {
      const res = await startMerchantOnboarding(merchant.id);
      setPayNotice(res.ok ? "Compte de paiement activé ✅" : res.error);
      setPayout(await fetchPayoutState(merchant.id));
    } finally {
      setPayBusy(false);
    }
  };

  const signOut = async () => {
    setSigningOut(true);
    try {
      await supabase.auth.signOut();
    } catch {
      // Même sans réseau, on ne laisse pas l'utilisateur coincé : il revient à
      // l'écran de connexion, qui affichera un vrai message d'erreur si besoin.
    } finally {
      setSigningOut(false);
      router.replace("/sign-in");
    }
  };

  if (!profile) {
    return (
      <Screen>
        <ActivityIndicator size="large" color={colors.brand} style={{ marginTop: 60 }} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <ScreenHeader title="Profil" subtitle={profile.email ?? undefined} />

      <Card style={styles.card}>
        <Row>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{profile.full_name.slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1, marginLeft: spacing.md }}>
            <Text style={styles.name}>{profile.full_name || "Sans nom"}</Text>
            <Text style={styles.muted}>
              {isMerchant
                ? merchant?.name
                  ? `Compte commerçant · ${merchant.name}`
                  : "Compte commerçant"
                : profile.neighborhood
                  ? `Quartier : ${profile.neighborhood}`
                  : "Quartier non défini"}
            </Text>
            {profile.phone ? <Text style={styles.muted}>📞 {profile.phone}</Text> : null}
          </View>
        </Row>
      </Card>

      {isMerchant ? (
        <>
          <Text style={styles.section}>Mon commerce</Text>

          {!merchantLoaded ? (
            <ActivityIndicator color={colors.brand} style={{ marginVertical: spacing.md }} />
          ) : merchantError ? (
            <LoadError
              message={merchantError}
              retrying={retrying}
              onRetry={() => {
                setRetrying(true);
                void loadMerchant();
              }}
            />
          ) : merchant ? (
            <>
              <PayoutBanner
                state={payout}
                busy={payBusy}
                notice={payNotice}
                onStart={payout === "missing" || payout === "incomplete" ? startPayouts : undefined}
                onRetry={() => setPayout("unknown")}
              />

              <Card style={styles.merchantCard}>
                <Text style={styles.merchantName}>{merchant.name}</Text>
                <Text style={styles.muted}>{merchant.address}</Text>
                <View style={styles.merchantBadges}>
                  <Badge
                    label={merchant.status === "active" ? "Visible dans Découvrir" : "Pas encore visible"}
                    tone={merchant.status === "active" ? "success" : "muted"}
                  />
                  <Badge
                    label={plan?.plan === "pro" ? "Plan Pro" : "Plan gratuit"}
                    tone={plan?.plan === "pro" ? "brand" : "muted"}
                  />
                </View>
                <Text style={styles.merchantPolicy}>
                  Commission Voizy sur vos ventes : 0 %, pour toujours.
                </Text>
              </Card>

              <MenuItem
                label="Mes offres"
                hint="Publier, modifier, retirer un produit"
                onPress={() => router.push("/offers")}
              />
              <MenuItem
                label="Statistiques"
                hint="Volume, participants, seuil atteint, abonnement"
                onPress={() => router.push("/stats")}
              />
            </>
          ) : (
            <MenuItem
              label="Créer mon commerce"
              hint="Il manque la fiche de votre commerce"
              onPress={() => router.push("/merchant-signup")}
            />
          )}

          <MenuItem label="Notifications" hint="" onPress={() => router.push("/notifications")} />
        </>
      ) : (
        <>
          <Text style={styles.section}>Mes réglages</Text>

          <MenuItem
            label="Quartier et géolocalisation"
            hint={profile.neighborhood ?? "Non défini"}
            onPress={() => router.push("/onboarding")}
          />
          <MenuItem
            label="Carte de paiement"
            hint={
              cardState === "loading"
                ? "Vérification…"
                : cardState === "yes"
                  ? "Carte enregistrée"
                  : cardState === "no"
                    ? "Aucune carte"
                    : "Vérification impossible — ouvrez la carte pour réessayer"
            }
            onPress={() => router.push("/payments")}
          />
          <MenuItem label="Notifications" hint="" onPress={() => router.push("/notifications")} />
        </>
      )}

      <View style={{ height: spacing.lg }} />
      <Button title="Se déconnecter" variant="danger" onPress={signOut} loading={signingOut} />
      <Text style={styles.version}>{buildLabel}</Text>
    </Screen>
  );
}

function MenuItem({ label, hint, onPress }: { label: string; hint: string; onPress: () => void }) {
  return (
    <PressableRow onPress={onPress}>
      <View style={{ flex: 1 }}>
        <Text style={styles.menuLabel}>{label}</Text>
        {hint ? <Text style={styles.menuHint}>{hint}</Text> : null}
      </View>
      <Text style={styles.chevron}>›</Text>
    </PressableRow>
  );
}

function PressableRow({ children, onPress }: { children: React.ReactNode; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.menuRow, pressed && { backgroundColor: colors.brandSoft }]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center" },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: radius.full,
    backgroundColor: colors.brandSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 24, fontWeight: "800", color: colors.brand, fontFamily: fonts.extraBold },
  name: { fontSize: fontSizes.heading, fontWeight: "800", color: colors.ink, fontFamily: fonts.extraBold },
  muted: { fontSize: fontSizes.body, color: colors.inkMuted, marginTop: 2, fontFamily: fonts.regular },
  section: {
    fontSize: fontSizes.heading,
    fontWeight: "700",
    color: colors.ink,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    fontFamily: fonts.bold,
  },
  merchantCard: { marginBottom: spacing.sm },
  merchantName: { fontSize: fontSizes.heading, fontWeight: "800", color: colors.ink, fontFamily: fonts.extraBold },
  merchantBadges: { flexDirection: "row", gap: 8, marginTop: spacing.sm, flexWrap: "wrap" },
  merchantPolicy: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, marginTop: spacing.sm, lineHeight: lineHeights.bodySmall, fontFamily: fonts.regular },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: touch.primary,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    marginBottom: spacing.sm,
  },
  menuLabel: { fontSize: fontSizes.body, fontWeight: "600", color: colors.ink, fontFamily: fonts.semiBold },
  menuHint: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, marginTop: 2, fontFamily: fonts.regular },
  chevron: { fontSize: 24, color: colors.inkMuted, marginLeft: spacing.sm, fontFamily: fonts.regular },
  version: { textAlign: "center", color: colors.inkMuted, fontSize: fontSizes.bodySmall, marginTop: spacing.lg, fontFamily: fonts.regular },
});
