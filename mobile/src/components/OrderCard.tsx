import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { colors, radius, spacing } from "../theme";
import { formatDateTime, formatDistance, formatPrice } from "../lib/format";
import { MERCHANT_CATEGORY_LABELS } from "../types";
import type { FeedOrder } from "../types";
import { ProgressBar } from "./ProgressBar";

/** Carte du fil « Découvrir » : commande groupée ouverte à rejoindre. */
export function OrderCard({ order }: { order: FeedOrder }) {
  const router = useRouter();

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.88 }]}
      onPress={() => router.push(`/order/${order.share_token}`)}
    >
      <View style={styles.topRow}>
        <Text style={styles.merchant} numberOfLines={1}>
          🏪 {order.merchant_name}
        </Text>
        {order.distance_m != null ? (
          <Text style={styles.distance}>📍 {formatDistance(order.distance_m)}</Text>
        ) : null}
      </View>

      <Text style={styles.title} numberOfLines={2}>
        {order.title}
      </Text>

      <View style={styles.priceRow}>
        <Text style={styles.groupPrice}>{formatPrice(order.group_price)}</Text>
        <Text style={styles.basePrice}>{formatPrice(order.base_price)}</Text>
        <Text style={styles.perUnit}>/ {order.unit_label}</Text>
      </View>

      <View style={{ marginTop: spacing.sm }}>
        <ProgressBar current={order.participants_current} threshold={order.threshold} />
      </View>

      <View style={styles.footer}>
        <Text style={styles.meta}>
          🗓 {formatDateTime(order.pickup_at)} · {order.organizer_name}
        </Text>
        <Text style={styles.cat}>{MERCHANT_CATEGORY_LABELS[order.merchant_category] ?? ""}</Text>
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
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  merchant: { fontSize: 13, fontWeight: "700", color: colors.brand, flex: 1 },
  distance: { fontSize: 12, color: colors.textMuted },
  title: { fontSize: 16, fontWeight: "800", color: colors.text, marginTop: 6, lineHeight: 21 },
  priceRow: { flexDirection: "row", alignItems: "baseline", marginTop: 8 },
  groupPrice: { fontSize: 20, fontWeight: "900", color: colors.accent },
  basePrice: {
    fontSize: 13,
    color: colors.textFaint,
    textDecorationLine: "line-through",
    marginLeft: 8,
  },
  perUnit: { fontSize: 13, color: colors.textMuted, marginLeft: 6 },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.sm,
  },
  meta: { fontSize: 12, color: colors.textMuted, flex: 1 },
  cat: { fontSize: 12, color: colors.textFaint },
});