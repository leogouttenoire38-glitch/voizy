import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { colors, radius, spacing } from "../theme";
import { countdown, formatDateTime, formatPrice } from "../lib/format";
import type { GroupOrder } from "../types";
import { Badge } from "./ui";

const STATUS_LABEL: Record<string, { label: string; tone: "brand" | "accent" | "danger" | "warning" | "muted" }> = {
  open: { label: "En cours", tone: "brand" },
  confirmed: { label: "Confirmée", tone: "accent" },
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
  },
  topRow: { flexDirection: "row", gap: 8 },
  title: { fontSize: 16, fontWeight: "800", color: colors.text, marginTop: 8, lineHeight: 21 },
  merchant: { fontSize: 13, color: colors.textMuted, marginTop: 3 },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.sm,
  },
  meta: { fontSize: 12, color: colors.textMuted },
  price: { fontSize: 15, fontWeight: "800", color: colors.accent },
});