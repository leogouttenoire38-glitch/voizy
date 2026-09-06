import React, { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Button, Field, Screen } from "../components/ui";
import { colors, fonts, fontSizes, lineHeights, radius, spacing } from "../theme";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { geocodeAddress } from "../lib/api";
import { getLastKnown, requestPermission } from "../lib/geo";

export default function OnboardingScreen() {
  const router = useRouter();
  const { session, refreshProfile } = useAuth();
  const userId = session?.user.id;

  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState<"gps" | "address" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const saveZone = async (lat: number, lng: number, neighborhood: string) => {
    if (!userId) return;
    const { error: err } = await supabase
      .from("users")
      .update({ lat, lng, neighborhood })
      .eq("id", userId);
    if (err) throw new Error(err.message);
    await refreshProfile();
    router.replace("/");
  };

  const useGps = async () => {
    setBusy("gps");
    setError(null);
    try {
      const pos = (await requestPermission()) ?? (await getLastKnown());
      if (!pos) {
        setError("Position introuvable. Autorisez la localisation ou saisissez votre adresse.");
        return;
      }
      await saveZone(pos.coords.latitude, pos.coords.longitude, "Autour de moi");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de définir votre quartier.");
    } finally {
      setBusy(null);
    }
  };

  const useAddress = async () => {
    if (address.trim().length < 4) {
      setError("Saisissez une adresse ou un quartier (ex. « Aligre, Paris »).");
      return;
    }
    setBusy("address");
    setError(null);
    try {
      const geo = await geocodeAddress(address.trim());
      await saveZone(geo.lat, geo.lng, geo.label);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Adresse introuvable.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <View style={styles.hero}>
        <Text style={styles.logo}>VOIZY</Text>
        <Text style={styles.title}>Votre quartier ?</Text>
        <Text style={styles.subtitle}>
          Voizy fonctionne entre voisins : indiquez votre quartier pour voir les
          commerçants partenaires et les commandes groupées autour de chez vous.
        </Text>
      </View>

      <Button
        title="Utiliser ma position GPS"
        onPress={useGps}
        loading={busy === "gps"}
      />

      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>ou</Text>
        <View style={styles.dividerLine} />
      </View>

      <Field
        label="Adresse ou quartier"
        value={address}
        onChangeText={setAddress}
        placeholder="Ex. : place d'Aligre, Paris 12e"
        placeholderTextColor={colors.inkMuted}
        autoCapitalize="words"
        returnKeyType="search"
        onSubmitEditing={useAddress}
      />
      <Button title="Valider" onPress={useAddress} variant="secondary" loading={busy === "address"} />

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {busy ? (
        <View style={styles.busyRow}>
          <ActivityIndicator color={colors.brand} />
          <Text style={styles.busyText}>Localisation…</Text>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { marginTop: 48, marginBottom: 32 },
  logo: { fontSize: 36, fontWeight: "900", color: colors.brand, letterSpacing: 1.5, fontFamily: fonts.extraBold },
  title: { fontSize: fontSizes.title, fontWeight: "800", color: colors.ink, marginTop: 16, fontFamily: fonts.extraBold },
  subtitle: { fontSize: fontSizes.body, color: colors.inkMuted, lineHeight: lineHeights.body, marginTop: 8, fontFamily: fonts.regular },
  divider: { flexDirection: "row", alignItems: "center", marginVertical: spacing.lg },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.borderStrong },
  dividerText: { marginHorizontal: spacing.md, color: colors.inkMuted, fontSize: fontSizes.body, fontFamily: fonts.medium },
  errorBox: {
    marginTop: spacing.md,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  errorText: { color: colors.danger, fontSize: fontSizes.body, fontFamily: fonts.medium },
  busyRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: spacing.md },
  busyText: { color: colors.inkMuted, fontSize: fontSizes.body, fontFamily: fonts.regular },
});