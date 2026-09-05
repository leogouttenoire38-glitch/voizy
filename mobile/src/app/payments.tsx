import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Button, Card, Screen, ScreenHeader } from "../components/ui";
import { colors, spacing } from "../theme";
import { setupPaymentStatus } from "../lib/api";
import { startCardSetup } from "../lib/checkout";

export default function PaymentsScreen() {
  const [status, setStatus] = useState<"loading" | "has_card" | "no_card" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await setupPaymentStatus();
      if (res.ok) {
        setStatus(res.has_payment_method ? "has_card" : "no_card");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  };

  useEffect(() => {
    load();
  }, []);

  const addCard = async () => {
    setBusy(true);
    setNotice(null);
    const ok = await startCardSetup();
    setBusy(false);
    if (ok) {
      setNotice("Carte enregistrée ✅");
      await load();
    }
  };

  return (
    <Screen>
      <ScreenHeader title="Paiement" subtitle="Carte utilisée pour les commandes groupées et les cautions" />
      <Card>
        {status === "loading" ? (
          <ActivityIndicator color={colors.brand} style={{ marginVertical: spacing.md }} />
        ) : status === "has_card" ? (
          <View style={styles.okRow}>
            <Text style={styles.okIcon}>💳</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.okTitle}>Carte enregistrée</Text>
              <Text style={styles.okHint}>
                Elle sert au paiement du produit (prélevé si le seuil est atteint) et à la
                pré-autorisation de caution (jamais débitée si le retrait est effectué).
              </Text>
            </View>
          </View>
        ) : status === "no_card" ? (
          <Text style={styles.hint}>
            Aucune carte enregistrée. Vous en aurez besoin pour participer à une commande groupée.
          </Text>
        ) : (
          <Text style={styles.hint}>Impossible de vérifier votre carte. Réessayez.</Text>
        )}

        {status !== "loading" ? (
          <Button
            title={status === "has_card" ? "Changer de carte" : "Enregistrer ma carte"}
            onPress={addCard}
            loading={busy}
            style={{ marginTop: spacing.md }}
          />
        ) : null}

        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      </Card>

      <Text style={styles.legal}>
        Paiements sécurisés via Stripe. La caution est une pré-autorisation : elle n'est débitée
        qu'en cas de no-show au retrait (CGV Voizy).
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  okRow: { flexDirection: "row", alignItems: "center" },
  okIcon: { fontSize: 26, marginRight: spacing.md },
  okTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  okHint: { fontSize: 12, color: colors.textMuted, marginTop: 4, lineHeight: 17 },
  hint: { fontSize: 13, color: colors.textMuted, lineHeight: 19 },
  notice: { color: colors.accent, fontSize: 13, marginTop: spacing.md, fontWeight: "600" },
  legal: {
    fontSize: 12,
    color: colors.textFaint,
    lineHeight: 17,
    marginTop: spacing.md,
    paddingHorizontal: spacing.xs,
  },
});