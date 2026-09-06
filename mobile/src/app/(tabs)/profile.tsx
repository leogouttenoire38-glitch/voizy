import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Button, Card, Row, Screen, ScreenHeader } from "../../components/ui";
import { colors, fonts, fontSizes, radius, spacing, touch } from "../../theme";
import { useAuth } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import { setupPaymentStatus } from "../../lib/api";

export default function ProfileScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const [hasCard, setHasCard] = useState<boolean | null>(null);

  useEffect(() => {
    setupPaymentStatus()
      .then((res) => {
        if (res.ok) setHasCard(Boolean(res.has_payment_method));
      })
      .catch(() => setHasCard(false));
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    router.replace("/sign-in");
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
              {profile.neighborhood ? `Quartier : ${profile.neighborhood}` : "Quartier non défini"}
            </Text>
            {profile.phone ? <Text style={styles.muted}>📞 {profile.phone}</Text> : null}
          </View>
        </Row>
      </Card>

      <Text style={styles.section}>Mes réglages</Text>

      <MenuItem
        label="Quartier et géolocalisation"
        hint={profile.neighborhood ?? "Non défini"}
        onPress={() => router.push("/onboarding")}
      />
      <MenuItem
        label="Carte de paiement"
        hint={hasCard === null ? "…" : hasCard ? "Carte enregistrée" : "Aucune carte"}
        onPress={() => router.push("/payments")}
      />
      <MenuItem
        label="Notifications"
        hint=""
        onPress={() => router.push("/notifications")}
      />

      <View style={{ height: spacing.lg }} />
      <Button title="Se déconnecter" variant="danger" onPress={signOut} />
      <Text style={styles.version}>Voizy · v0.1.0</Text>
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