import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { colors, fonts, fontSizes, lineHeights, radius, shadow, spacing } from "../theme";
import { countdown, formatDateTime, formatPrice } from "../lib/format";
import type { GroupOrder } from "../types";
import { Badge, type BadgeTone } from "./ui";

// Vocabulaire figé : « En cours » = commande ouverte, partout dans l'app.
const STATUS_LABEL: Record<string, { label: string; tone: BadgeTone }> = {
  open: { label: "En cours", tone: "brand" },
  confirmed: { label: "Confirmée", tone: "success" },
  completed: { label: "Terminée", tone: "muted" },
  cancelled: { label: "Annulée", tone: "danger" },
};

/** Carte de la liste « Mes commandes » (organisées ou rejointes). */
export function MyOrderCard({
  order,
  merchantName,
  isOrganizer,
}: {
  order: GroupOrder;
  merchantName: string;
  isOrganizer: boolean;
}) {
  const router = useRouter();
  const st = STATUS_LABEL[order.status] ?? STATUS_LABEL.open;

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.88 }]}
      onPress={() => router.push(`/order/${order.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`Commande ${order.title}, ${st.label}`}
    >
      <View style={styles.topRow}>
        <Badge label={isOrganizer ? "Organisateur" : "Participant"} tone={isOrganizer ? "brand" : "muted"} />
        <Badge label={st.label} tone={st.tone} />
      </View>

      <Text style={styles.title} numberOfLines={2}>
        {order.title}
      </Text>
      <Text style={styles.merchant}>🏪 {merchantName}</Text>

      <View style={styles.metaRow}>
        <Text style={styles.meta}>
          {order.status === "open"
            ? `⏳ ${countdown(order.pickup_at)} · ${order.participants_current}/${order.threshold}`
            : `🗓 ${formatDateTime(order.pickup_at)}`}
        </Text>
        <Text style={styles.price}>{formatPrice(order.group_price)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadow,
  },
  topRow: { flexDirection: "row", gap: 8 },
  title: { fontSize: fontSizes.heading, fontWeight: "800", color: colors.ink, marginTop: 8, lineHeight: lineHeights.heading, fontFamily: fonts.extraBold },
  merchant: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, marginTop: 3, fontFamily: fonts.regular },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.sm,
  },
  meta: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, fontFamily: fonts.regular },
  price: { fontSize: fontSizes.heading, fontWeight: "800", color: colors.brand, fontFamily: fonts.extraBold },
});