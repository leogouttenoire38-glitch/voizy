import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { colors, fonts, fontSizes, lineHeights, radius, shadow, spacing, THRESHOLD_HIGHLIGHT } from "../theme";
import { formatDateTime, formatDistance, formatPrice } from "../lib/format";
import { MERCHANT_CATEGORY_LABELS } from "../types";
import type { FeedOrder } from "../types";
import { ProgressBar } from "./ProgressBar";

/** Carte du fil « Découvrir » : commande groupée ouverte à rejoindre.
 *  Hiérarchie visuelle : une commande proche du seuil (≥ 75 %) se distingue
 *  nettement d'une commande qui vient d'être créée (liseré + fond Ocre). */
export function OrderCard({ order }: { order: FeedOrder }) {
  const router = useRouter();
  const ratio = order.threshold > 0 ? order.participants_current / order.threshold : 0;
  const hot = ratio >= THRESHOLD_HIGHLIGHT && order.status === "open";
  const missing = Math.max(0, order.threshold - order.participants_current);

  return (
    <Pressable
      style={({ pressed }) => [styles.card, hot && styles.cardHot, pressed && { opacity: 0.88 }]}
      onPress={() => router.push(`/order/${order.share_token}`)}
      accessibilityRole="button"
      accessibilityLabel={`Commande ${order.title}, chez ${order.merchant_name}`}
    >
      {hot ? (
        <View style={styles.hotBanner}>
          <Text style={styles.hotBannerText}>⚡ Il manque encore {missing} participant{missing > 1 ? "s" : ""}</Text>
        </View>
      ) : null}

      <View style={styles.topRow}>
        <Text style={[styles.merchant, hot && styles.merchantHot]} numberOfLines={1}>
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
        <Text style={[styles.groupPrice, hot && styles.groupPriceHot]}>{formatPrice(order.group_price)}</Text>
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
    ...shadow,
  },
  cardHot: {
    borderColor: colors.accent,
    borderWidth: 2,
    backgroundColor: "#FFFDF7",
  },
  hotBanner: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignSelf: "flex-start",
    marginBottom: spacing.sm,
  },
  hotBannerText: { color: colors.onAccent, fontSize: fontSizes.bodySmall, fontWeight: "700", fontFamily: fonts.bold },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  merchant: { fontSize: fontSizes.bodySmall, fontWeight: "700", color: colors.brand, flex: 1, fontFamily: fonts.bold },
  merchantHot: { color: "#7A4E0E" },
  distance: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, fontFamily: fonts.medium },
  title: { fontSize: fontSizes.heading, fontWeight: "800", color: colors.ink, marginTop: 6, lineHeight: lineHeights.heading, fontFamily: fonts.extraBold },
  priceRow: { flexDirection: "row", alignItems: "baseline", marginTop: 8 },
  groupPrice: { fontSize: fontSizes.title, fontWeight: "900", color: colors.brand, fontFamily: fonts.extraBold },
  groupPriceHot: { color: "#7A4E0E" },
  basePrice: {
    fontSize: fontSizes.bodySmall,
    color: colors.inkMuted,
    textDecorationLine: "line-through",
    marginLeft: 8,
    fontFamily: fonts.medium,
  },
  perUnit: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, marginLeft: 6, fontFamily: fonts.medium },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.sm,
  },
  meta: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, flex: 1, fontFamily: fonts.regular },
  cat: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, fontFamily: fonts.medium },
});