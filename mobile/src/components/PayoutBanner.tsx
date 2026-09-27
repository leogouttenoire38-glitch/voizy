import React from "react";
import { StyleSheet, Text } from "react-native";
import { Button, Card } from "./ui";
import { colors, fonts, fontSizes, lineHeights, spacing } from "../theme";
import type { PayoutState } from "../lib/merchant";

/**
 * Bandeau « compte de paiement », identique sur les écrans commerçant du mobile
 * (Mes offres, Statistiques, Profil). Il reste visible tant que Stripe n'a pas
 * confirmé le compte : un commerçant ne doit jamais découvrir trop tard que
 * l'argent de ses ventes ne peut pas lui être versé.
 */
export function PayoutBanner({
  state,
  busy,
  notice,
  onStart,
  onRetry,
}: {
  state: PayoutState;
  busy?: boolean;
  notice?: string | null;
  onStart?: () => void;
  onRetry?: () => void;
}) {
  if (state === "ready") {
    return (
      <Card tone="success" style={styles.banner}>
        <Text style={styles.okTitle}>✅ Paiements actifs</Text>
        <Text style={styles.text}>
          Vous recevez l'argent de vos ventes directement sur votre compte bancaire. Commission
          Voizy sur vos ventes : 0 %, pour toujours.
        </Text>
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      </Card>
    );
  }

  if (state === "unknown") {
    return (
      <Card style={styles.banner}>
        <Text style={styles.title}>Paiements : vérification impossible</Text>
        <Text style={styles.text}>
          Nous n'avons pas pu vérifier votre compte de paiement. Réessayez dans un instant.
        </Text>
        {onRetry ? (
          <Button
            title="Vérifier à nouveau"
            variant="secondary"
            onPress={onRetry}
            style={styles.button}
          />
        ) : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      </Card>
    );
  }

  return (
    <Card style={styles.banner}>
      <Text style={styles.title}>Finalisez votre compte de paiement</Text>
      <Text style={styles.text}>
        Vous pouvez publier vos offres dès maintenant. Pour recevoir l'argent de vos ventes,
        finalisez votre compte de paiement chez Stripe (environ 5 minutes). Tout est sécurisé par
        Stripe : aucune coordonnée bancaire ne passe par Voizy.
      </Text>
      <Text style={styles.text}>
        Commission Voizy sur vos ventes : 0 %, pour toujours — vous gardez 100 % de vos ventes, hors
        frais bancaires standards.
      </Text>
      {onStart ? (
        <Button
          title="Finaliser mon compte de paiement"
          onPress={onStart}
          loading={busy}
          style={styles.button}
        />
      ) : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  banner: { marginBottom: spacing.md },
  title: { fontSize: fontSizes.heading, fontWeight: "800", color: colors.ink, fontFamily: fonts.extraBold },
  okTitle: { fontSize: fontSizes.heading, fontWeight: "800", color: colors.ink, fontFamily: fonts.extraBold },
  text: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, marginTop: 6, lineHeight: lineHeights.bodySmall, fontFamily: fonts.regular },
  notice: { fontSize: fontSizes.bodySmall, color: colors.ink, marginTop: spacing.sm, lineHeight: lineHeights.bodySmall, fontFamily: fonts.semiBold },
  button: { marginTop: spacing.md },
});
