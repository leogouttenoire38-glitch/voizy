import React, { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Button, Screen } from "../../components/ui";
import { colors, spacing } from "../../theme";
import { supabase } from "../../lib/supabase";

// Écran de vérification par code e-mail (OTP) : aucune URL de confirmation n'est
// envoyée — l'utilisateur saisit le code à 6 chiffres reçu dans sa boîte mail.
// type = "signup" (création de compte) | "email" (connexion par code).
export default function VerifyEmailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string; type?: string }>();
  const email = (params.email ?? "").trim();
  const type: "signup" | "email" = params.type === "email" ? "email" : "signup";

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(t);
  }, []);

  const doVerify = async () => {
    const token = code.trim();
    if (!/^\d{6}$/.test(token)) {
      return setError("Saisissez le code à 6 chiffres reçu par e-mail.");
    }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.verifyOtp({ email, token, type });
    setBusy(false);
    if (err) return setError(err.message);
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
    if (res.error) return setError(res.error.message);
    setResent(true);
    setCode("");
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

        <TextInput
          ref={inputRef}
          value={code}
          onChangeText={(t) => setCode(t.replace(/[^0-9]/g, "").slice(0, 6))}
          keyboardType="number-pad"
          autoFocus
          placeholder="••••••"
          placeholderTextColor={colors.textFaint}
          style={[styles.codeInput, error && styles.codeInputError]}
          onSubmitEditing={doVerify}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {resent ? <Text style={styles.notice}>Nouveau code envoyé ✉️</Text> : null}

        <Button title="Vérifier le code" onPress={doVerify} loading={busy} />
        <View style={{ height: spacing.sm }} />
        <Button title="Renvoyer le code" onPress={doResend} variant="secondary" disabled={busy} />
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { marginTop: 32, marginBottom: 28 },
  title: { fontSize: 26, fontWeight: "800", color: colors.text, letterSpacing: -0.4 },
  subtitle: { fontSize: 14, color: colors.textMuted, marginTop: 6, lineHeight: 20 },
  email: { color: colors.brand, fontWeight: "600" },
  codeInput: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingVertical: 14,
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: 12,
    textAlign: "center",
    color: colors.text,
    marginBottom: spacing.md,
  },
  codeInputError: { borderColor: colors.danger },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.sm },
  notice: { color: colors.accent, fontSize: 13, marginBottom: spacing.sm },
});