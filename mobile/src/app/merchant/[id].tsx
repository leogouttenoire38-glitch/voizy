import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Button, Card, ScreenHeader } from "../../components/ui";
import { colors, fonts, fontSizes, lineHeights, radius, shadow, spacing, touch } from "../../theme";
import { supabase } from "../../lib/supabase";
import { formatDistance, formatPrice } from "../../lib/format";
import { MERCHANT_CATEGORY_LABELS } from "../../types";
import type { Merchant, Offer, UserRow } from "../../types";

export default function MerchantScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [distance, setDistance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [merchantRes, offersRes, profileRes] = await Promise.all([
      supabase.from("merchants").select("*").eq("id", id!).maybeSingle(),
      supabase.from("offers").select("*").eq("merchant_id", id!).eq("active", true).order("group_price"),
      supabase.from("users").select("lat, lng").maybeSingle(),
    ]);

    if (merchantRes.error || !merchantRes.data) {
      setError(merchantRes.error?.message ?? "Commerçant introuvable.");
      setLoading(false);
      return;
    }
    setMerchant(merchantRes.data as unknown as Merchant);
    setOffers((offersRes.data as Offer[]) ?? []);

    const profile = profileRes.data as Pick<UserRow, "lat" | "lng"> | null;
    if (profile?.lat != null && profile.lng != null && merchantRes.data.lat != null && merchantRes.data.lng != null) {
      setDistance(haversine(profile.lat, profile.lng, merchantRes.data.lat, merchantRes.data.lng));
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  if (!merchant) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error ?? "Commerçant introuvable."}</Text>
        <Button title="Retour" variant="outline" onPress={() => router.back()} style={{ marginTop: spacing.md }} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScreenHeader title={merchant.name} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card>
          <Text style={styles.category}>
            {MERCHANT_CATEGORY_LABELS[merchant.category] ?? ""}
            {distance != null ? ` · 📍 à ${formatDistance(distance)}` : ""}
          </Text>
          <Text style={styles.address}>📍 {merchant.address}</Text>
          {merchant.description ? (
            <Text style={styles.description}>{merchant.description}</Text>
          ) : null}
        </Card>

        <Text style={styles.sectionLabel}>Offres groupées</Text>
        {offers.length === 0 ? (
          <Text style={styles.muted}>Aucune offre active pour l'instant.</Text>
        ) : (
          offers.map((o) => (
            <Pressable
              key={o.id}
              accessibilityRole="button"
              accessibilityLabel={`Offre ${o.title}, ${formatPrice(o.group_price)}`}
              style={({ pressed }) => [styles.offerCard, pressed && { opacity: 0.88 }]}
              onPress={() => router.push(`/new-order?merchantId=${merchant.id}&offerId=${o.id}`)}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.offerTitle}>{o.title}</Text>
                <Text style={styles.offerDesc} numberOfLines={2}>{o.description}</Text>
                <View style={styles.priceRow}>
                  <Text style={styles.groupPrice}>{formatPrice(o.group_price)}</Text>
                  <Text style={styles.basePrice}>{formatPrice(o.base_price)}</Text>
                  <Text style={styles.offerMeta}> / {o.unit_label}</Text>
                </View>
                <Text style={styles.offerMeta}>
                  Seuil : {o.threshold} participants · Caution : {formatPrice(o.deposit_amount)}
                </Text>
              </View>
            </Pressable>
          ))
        )}

        {offers.length > 0 ? (
          <View style={{ marginTop: spacing.md }}>
            <Button
              title="Créer une commande groupée"
              onPress={() => router.push(`/new-order?merchantId=${merchant.id}`)}
              variant="accent"
            />
            <Text style={styles.hint}>
              Choisissez une offre, fixez l'heure de retrait, puis partagez le lien à vos voisins.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg, padding: spacing.lg },
  error: { fontSize: fontSizes.body, color: colors.danger, textAlign: "center", fontFamily: fonts.medium },
  scroll: { paddingHorizontal: spacing.md, paddingTop: spacing.xs, paddingBottom: 60 },
  category: { fontSize: fontSizes.body, fontWeight: "700", color: colors.brand, fontFamily: fonts.bold },
  address: { fontSize: fontSizes.body, color: colors.inkMuted, marginTop: 6, fontFamily: fonts.regular },
  description: { fontSize: fontSizes.body, color: colors.ink, lineHeight: lineHeights.body, marginTop: 10, fontFamily: fonts.regular },
  sectionLabel: {
    fontSize: fontSizes.heading,
    fontWeight: "700",
    color: colors.ink,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    fontFamily: fonts.bold,
  },
  muted: { fontSize: fontSizes.body, color: colors.inkMuted, fontFamily: fonts.regular },
  offerCard: {
    flexDirection: "row",
    minHeight: touch.secondary,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadow,
  },
  offerTitle: { fontSize: fontSizes.heading, fontWeight: "700", color: colors.ink, fontFamily: fonts.bold },
  offerDesc: { fontSize: fontSizes.body, color: colors.inkMuted, marginTop: 3, fontFamily: fonts.regular },
  priceRow: { flexDirection: "row", alignItems: "baseline", marginTop: 8 },
  groupPrice: { fontSize: fontSizes.title, fontWeight: "900", color: colors.brand, fontFamily: fonts.extraBold },
  basePrice: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, textDecorationLine: "line-through", marginLeft: 8, fontFamily: fonts.medium },
  offerMeta: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, marginLeft: 6, fontFamily: fonts.regular },
  hint: { fontSize: fontSizes.body, color: colors.inkMuted, textAlign: "center", marginTop: spacing.sm, lineHeight: lineHeights.body, fontFamily: fonts.regular },
});