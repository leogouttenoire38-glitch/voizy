import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from "react-native";
import { Link } from "expo-router";
import { Button, Field, Screen } from "../../components/ui";
import { colors, spacing } from "../../theme";
import { supabase } from "../../lib/supabase";

export default function SignInScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"password" | "magic" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const doSignIn = async () => {
    if (!email || !password) return setError("Renseignez votre e-mail et votre mot de passe.");
    setBusy("password");
    setError(null);
    setNotice(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(null);
    if (err) setError(err.message);
    // Succès : le layout (tabs) redirige vers / ou /onboarding.
  };

  const doMagicLink = async () => {
    if (!email) return setError("Renseignez d'abord votre e-mail.");
    setBusy("magic");
    setError(null);
    setNotice(null);
    const { error: err } = await supabase.auth.signInWithOtp({ email });
    setBusy(null);
    if (err) setError(err.message);
    else setNotice("Lien magique envoyé ✉️ — vérifiez votre boîte mail.");
  };

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={styles.hero}>
          <Text style={styles.logo}>VOIZY</Text>
          <Text style={styles.tagline}>
            Achetez groupé entre voisins,{"\n"}chez les commerçants du quartier.
          </Text>
        </View>

        <Field label="E-mail" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
        <Field label="Mot de passe" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" />

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        <Button title="Se connecter" onPress={doSignIn} loading={busy === "password"} />
        <View style={{ height: spacing.sm }} />
        <Button title="Recevoir un lien magique" onPress={doMagicLink} variant="secondary" loading={busy === "magic"} />

        <View style={styles.footer}>
          <Text style={styles.footerText}>Pas encore de compte ? </Text>
          <Link href="/sign-up" style={styles.footerLink}>
            Créer un compte
          </Link>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { marginTop: 48, marginBottom: 32 },
  logo: { fontSize: 34, fontWeight: "900", color: colors.brand, letterSpacing: 1 },
  tagline: { fontSize: 16, color: colors.textMuted, lineHeight: 24, marginTop: 8 },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.sm },
  notice: { color: colors.accent, fontSize: 13, marginBottom: spacing.sm },
  footer: { flexDirection: "row", justifyContent: "center", marginTop: spacing.lg },
  footerText: { color: colors.textMuted, fontSize: 14 },
  footerLink: { color: colors.brand, fontWeight: "700", fontSize: 14 },
});