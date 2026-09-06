import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Link, useRouter } from "expo-router";
import { BackButton, Button, Field, ProgressSteps, Screen } from "../../components/ui";
import { colors, fonts, fontSizes, lineHeights, spacing } from "../../theme";
import { humanAuthError } from "../../lib/errors";
import { supabase } from "../../lib/supabase";

// Inscription en 2 étapes : une seule décision par écran, avec progression.
// Étape 1 : identité. Étape 2 : e-mail + mot de passe.
export default function SignUpScreen() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextStep = () => {
    setError(null);
    if (step === 1) {
      if (!fullName.trim()) return setError("Indiquez votre prénom ou pseudo.");
      setStep(2);
      return;
    }
    // Étape 2 → inscription
    if (!email || !password) return setError("Renseignez votre e-mail et un mot de passe.");
    if (password.length < 6) return setError("Le mot de passe doit contenir au moins 6 caractères.");
    void doSignUp();
  };

  const doSignUp = async () => {
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

    if (err) {
      // Compte déjà créé mais non confirmé → renvoyer vers la vérification
      // (GoTrue refuse la double inscription, l'utilisateur a besoin du code).
      if (/already registered|already been registered/i.test(err.message)) {
        return router.replace({ pathname: "/verify-email", params: { email, type: "signup" } });
      }
      return setError(humanAuthError(err.message, "Impossible de créer le compte. Réessayez."));
    }
    if (data.session) {
      // Compte créé + session ouverte → on passe au choix du quartier.
      router.replace("/onboarding");
    } else {
      // Confirmation par code e-mail : on passe à la saisie du code reçu.
      router.replace({ pathname: "/verify-email", params: { email, type: "signup" } });
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
          <View style={styles.hero}>
            <BackButton />
            <Text style={styles.title}>Créer un compte</Text>
            <Text style={styles.subtitle}>Rejoignez vos voisins et vos commerçants de quartier.</Text>
          </View>

          <ProgressSteps current={step} total={2} />

          {step === 1 ? (
            <>
              <Field label="Votre prénom ou pseudo" value={fullName} onChangeText={setFullName} autoComplete="name" placeholder="Ex. : Monique" />
              <Field
                label="Téléphone (optionnel, pour le retrait)"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                autoComplete="tel"
                placeholder="Ex. : 06 12 34 56 78"
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Button title="Continuer" onPress={nextStep} loading={busy} />
            </>
          ) : (
            <>
              <Field label="E-mail" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder="votre@email.fr" />
              <Field label="Mot de passe (6 caractères minimum)" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" placeholder="••••••••" />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Button title="Créer mon compte" onPress={nextStep} loading={busy} />
              <Button title="Retour" variant="ghost" onPress={() => setStep(1)} disabled={busy} />
            </>
          )}

          <View style={styles.footer}>
            <Text style={styles.footerText}>Déjà un compte ? </Text>
            <Link href="/sign-in" style={styles.footerLink}>
              Se connecter
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { marginTop: 32, marginBottom: 24 },
  title: { fontSize: fontSizes.display, fontWeight: "800", color: colors.ink, fontFamily: fonts.extraBold, lineHeight: lineHeights.display },
  subtitle: { fontSize: fontSizes.body, color: colors.inkMuted, marginTop: 6, lineHeight: lineHeights.body, fontFamily: fonts.regular },
  error: { color: colors.danger, fontSize: fontSizes.body, marginBottom: spacing.sm, fontFamily: fonts.medium },
  footer: { flexDirection: "row", justifyContent: "center", marginTop: spacing.lg },
  footerText: { color: colors.inkMuted, fontSize: fontSizes.body, fontFamily: fonts.regular },
  footerLink: { color: colors.brand, fontWeight: "700", fontSize: fontSizes.body, fontFamily: fonts.bold },
});