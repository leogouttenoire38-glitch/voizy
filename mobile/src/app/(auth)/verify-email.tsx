import React, { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Button, Screen } from "../../components/ui";
import { colors, fonts, fontSizes, lineHeights, spacing } from "../../theme";
import { humanAuthError } from "../../lib/errors";
import { supabase } from "../../lib/supabase";

// Écran de vérification par code e-mail (OTP) : aucune URL de confirmation n'est
// envoyée — l'utilisateur saisit le code à 6 chiffres reçu dans sa boîte mail.
// type = "signup" (création de compte) | "email" (connexion par code).
const RESEND_WAIT = 30; // secondes avant de pouvoir renvoyer un code

export default function VerifyEmailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string; type?: string }>();
  const email = (params.email ?? "").trim();
  const type: "signup" | "email" = params.type === "email" ? "email" : "signup";

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [wait, setWait] = useState(0);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(t);
  }, []);

  // Compte à rebours avant de pouvoir renvoyer un code.
  useEffect(() => {
    if (wait <= 0) return;
    const t = setInterval(() => setWait((w) => Math.max(0, w - 1)), 1000);
    return () => clearInterval(t);
  }, [wait]);

  const doVerify = async () => {
    const token = code.trim();
    if (!/^\d{6}$/.test(token)) {
      return setError("Saisissez les 6 chiffres du code reçu par e-mail.");
    }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.verifyOtp({ email, token, type });
    setBusy(false);
    if (err) return setError(humanAuthError(err.message, "Le code n'est pas valide. Réessayez."));
    // Session ouverte : le layout aiguille vers /onboarding si le quartier
    // n'est pas encore choisi, sinon vers les onglets.
    router.replace(type === "signup" ? "/onboarding" : "/");
  };

  const doResend = async () => {
    setBusy(true);
    setError(null);
    setResent(false);
    const res =
      type === "signup"
        ? await supabase.auth.resend({ type: "signup", email })
        : await supabase.auth.signInWithOtp({ email });
    setBusy(false);
    if (res.error) return setError(humanAuthError(res.error.message, "Impossible d'envoyer un nouveau code."));
    setResent(true);
    setCode("");
    setWait(RESEND_WAIT);
  };

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={styles.hero}>
          <Text style={styles.title}>Vérifiez votre e-mail</Text>
          <Text style={styles.subtitle}>
            Nous avons envoyé un code à 6 chiffres à{"\n"}
            <Text style={styles.email}>{email || "votre adresse e-mail"}</Text>.
          </Text>
        </View>

        <Text style={styles.codeLabel}>Votre code à 6 chiffres</Text>
        <TextInput
          ref={inputRef}
          value={code}
          onChangeText={(t) => setCode(t.replace(/[^0-9]/g, "").slice(0, 6))}
          keyboardType="number-pad"
          autoFocus
          accessibilityLabel="Code à 6 chiffres reçu par e-mail"
          placeholder="••••••"
          placeholderTextColor={colors.inkMuted}
          style={[styles.codeInput, error && styles.codeInputError]}
          onSubmitEditing={doVerify}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {resent ? <Text style={styles.notice}>Nouveau code envoyé ✉️</Text> : null}

        <Button title="Vérifier le code" onPress={doVerify} loading={busy} />
        <View style={{ height: spacing.sm }} />
        <Button
          title={wait > 0 ? `Renvoyer le code (${wait} s)` : "Renvoyer le code"}
          onPress={doResend}
          variant="secondary"
          disabled={busy || wait > 0}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { marginTop: 32, marginBottom: 24 },
  title: { fontSize: fontSizes.display, fontWeight: "800", color: colors.ink, fontFamily: fonts.extraBold, lineHeight: lineHeights.display },
  subtitle: { fontSize: fontSizes.body, color: colors.inkMuted, marginTop: 6, lineHeight: lineHeights.body, fontFamily: fonts.regular },
  email: { color: colors.brand, fontWeight: "700", fontFamily: fonts.bold },
  codeLabel: { fontSize: fontSizes.body, fontWeight: "600", color: colors.ink, marginBottom: 6, fontFamily: fonts.semiBold },
  codeInput: {
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    backgroundColor: colors.card,
    borderRadius: 12,
    minHeight: 72,
    paddingVertical: 12,
    fontSize: 34,
    fontWeight: "700",
    fontFamily: fonts.bold,
    letterSpacing: 16,
    textAlign: "center",
    color: colors.ink,
    marginBottom: spacing.md,
  },
  codeInputError: { borderColor: colors.danger },
  error: { color: colors.danger, fontSize: fontSizes.body, marginBottom: spacing.sm, fontFamily: fonts.medium },
  notice: { color: colors.brand, fontSize: fontSizes.body, marginBottom: spacing.sm, fontFamily: fonts.semiBold },
});