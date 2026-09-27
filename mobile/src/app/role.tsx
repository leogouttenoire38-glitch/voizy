import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { Screen } from "../components/ui";
import { colors, fonts, fontSizes, lineHeights, radius, shadow, spacing, touch } from "../theme";
import { useAuth } from "../lib/auth";
import { chooseRole } from "../lib/merchant";
import { humanLoadError } from "../lib/load";
import type { UserRole } from "../types";

// Choix du rôle, juste après l'inscription : une seule décision, deux chemins
// clairs, aucune notion technique. Un compte = un rôle actif.
interface Choice {
  role: UserRole;
  icon: string;
  title: string;
  hint: string;
}

const CHOICES: Choice[] = [
  {
    role: "buyer",
    icon: "🧺",
    title: "Un voisin",
    hint: "Je veux acheter groupé avec mon quartier, au juste prix.",
  },
  {
    role: "merchant",
    icon: "🏪",
    title: "Un commerçant",
    hint: "Je veux vendre mes produits, 0 % de commission sur mes ventes.",
  },
];

export default function RoleScreen() {
  const router = useRouter();
  const { session, profile, refreshProfile } = useAuth();
  const [busy, setBusy] = useState<UserRole | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!session) return <Redirect href="/sign-in" />;

  const pick = async (choice: Choice) => {
    setBusy(choice.role);
    setError(null);
    try {
      await chooseRole(choice.role);
      await refreshProfile();
      router.replace(choice.role === "merchant" ? "/merchant-signup" : "/onboarding");
    } catch (err) {
      // Jamais d'écran bloqué : le bouton revient au repos avec un vrai message.
      setError(
        humanLoadError(err, "Impossible d'enregistrer votre choix. Vérifiez votre connexion puis réessayez."),
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.hero}>
          <Text style={styles.logo}>VOIZY</Text>
          <Text style={styles.title}>Vous êtes plutôt…</Text>
          <Text style={styles.subtitle}>
            Ce choix définit votre espace Voizy. Vous pourrez toujours nous écrire si vous
            souhaitez en changer.
          </Text>
          {profile?.full_name ? (
            <Text style={styles.hello}>Bonjour {profile.full_name} 👋</Text>
          ) : null}
        </View>

        {CHOICES.map((choice) => (
          <Pressable
            key={choice.role}
            onPress={() => pick(choice)}
            disabled={busy !== null}
            accessibilityRole="button"
            accessibilityLabel={`${choice.title} — ${choice.hint}`}
            accessibilityState={{ disabled: busy !== null, busy: busy === choice.role }}
            style={({ pressed }) => [
              styles.choice,
              pressed && styles.choicePressed,
              busy === choice.role && styles.choiceBusy,
            ]}
          >
            <Text style={styles.choiceIcon}>{choice.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.choiceTitle}>
                {choice.title}
                {busy === choice.role ? "  ⏳" : ""}
              </Text>
              <Text style={styles.choiceHint}>{choice.hint}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Text style={styles.footnote}>
          Un compte Voizy a un seul rôle à la fois : soit acheteur, soit commerçant.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { marginTop: 40, marginBottom: spacing.lg },
  logo: { fontSize: 32, fontWeight: "900", color: colors.brand, letterSpacing: 1.5, fontFamily: fonts.extraBold },
  title: { fontSize: fontSizes.display, fontWeight: "800", color: colors.ink, marginTop: 12, fontFamily: fonts.extraBold, lineHeight: lineHeights.display },
  subtitle: { fontSize: fontSizes.body, color: colors.inkMuted, marginTop: 8, lineHeight: lineHeights.body, fontFamily: fonts.regular },
  hello: { fontSize: fontSizes.body, color: colors.ink, marginTop: spacing.md, fontFamily: fonts.semiBold },
  choice: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: touch.primary + 32,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadow,
  },
  choicePressed: { backgroundColor: colors.brandSoft },
  choiceBusy: { opacity: 0.7 },
  choiceIcon: { fontSize: 34, marginRight: spacing.md },
  choiceTitle: { fontSize: fontSizes.heading, fontWeight: "800", color: colors.ink, fontFamily: fonts.extraBold },
  choiceHint: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, marginTop: 4, lineHeight: lineHeights.bodySmall, fontFamily: fonts.regular },
  chevron: { fontSize: 30, color: colors.brand, marginLeft: spacing.sm, fontFamily: fonts.bold },
  errorBox: { backgroundColor: colors.dangerSoft, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm },
  errorText: { color: colors.danger, fontSize: fontSizes.body, fontFamily: fonts.medium },
  footnote: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, textAlign: "center", marginTop: spacing.lg, lineHeight: lineHeights.bodySmall, fontFamily: fonts.regular },
});
