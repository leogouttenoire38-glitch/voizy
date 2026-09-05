import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from "react-native";
import { Link, useRouter } from "expo-router";
import { Button, Field, Screen } from "../../components/ui";
import { colors, spacing } from "../../theme";
import { supabase } from "../../lib/supabase";

export default function SignUpScreen() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doSignUp = async () => {
    if (!fullName.trim()) return setError("Indiquez votre prénom ou pseudo.");
    if (!email || !password) return setError("Renseignez votre e-mail et un mot de passe.");
    if (password.length < 6) return setError("Le mot de passe doit faire au moins 6 caractères.");
    setBusy(true);
    setError(null);

    const { data, error: err } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName.trim() },
        ...(phone.trim() ? { phone: phone.trim() } : {}),
      },
    });
    setBusy(false);

    if (err) return setError(err.message);
    if (data.session) {
      // Compte créé + session ouverte → on passe au choix du quartier.
      router.replace("/onboarding");
    } else {
      setError("Compte créé ! Confirmez votre e-mail avant de vous connecter.");
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={styles.hero}>
          <Text style={styles.title}>Créer un compte</Text>
          <Text style={styles.subtitle}>Rejoignez vos voisins et vos commerçants de quartier.</Text>
        </View>

        <Field label="Prénom / pseudo" value={fullName} onChangeText={setFullName} autoComplete="name" />
        <Field label="Téléphone (optionnel, pour le retrait)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" />
        <Field label="E-mail" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
        <Field label="Mot de passe" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button title="Créer mon compte" onPress={doSignUp} loading={busy} />

        <View style={styles.footer}>
          <Text style={styles.footerText}>Déjà un compte ? </Text>
          <Link href="/sign-in" style={styles.footerLink}>
            Se connecter
          </Link>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { marginTop: 32, marginBottom: 24 },
  title: { fontSize: 26, fontWeight: "800", color: colors.text, letterSpacing: -0.4 },
  subtitle: { fontSize: 14, color: colors.textMuted, marginTop: 6, lineHeight: 20 },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.sm },
  footer: { flexDirection: "row", justifyContent: "center", marginTop: spacing.lg },
  footerText: { color: colors.textMuted, fontSize: 14 },
  footerLink: { color: colors.brand, fontWeight: "700", fontSize: 14 },
});