import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { EmptyState, ScreenHeader } from "../../components/ui";
import { OrderCard } from "../../components/OrderCard";
import { colors, radius, spacing } from "../../theme";
import { useAuth } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import { formatDistance } from "../../lib/format";
import { MERCHANT_CATEGORY_LABELS } from "../../types";
import type { FeedOrder, NearbyMerchant } from "../../types";

export default function DiscoverScreen() {
  const router = useRouter();
  const { profile } = useAuth();

  const [orders, setOrders] = useState<FeedOrder[]>([]);
  const [merchants, setMerchants] = useState<NearbyMerchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLocation, setHasLocation] = useState(false);

  const lat = profile?.lat ?? null;
  const lng = profile?.lng ?? null;

  const load = useCallback(async () => {
    if (lat == null || lng == null) {
      setLoading(false);
      setHasLocation(false);
      return;
    }
    setHasLocation(true);
    setError(null);

    const [ordersRes, merchantsRes] = await Promise.all([
      supabase.rpc("open_orders_feed", { p_lat: lat, p_lng: lng, p_radius_m: 5000, p_limit: 50 }),
      supabase.rpc("nearby_merchants", { p_lat: lat, p_lng: lng, p_radius_m: 5000, p_limit: 50 }),
    ]);

    if (ordersRes.error) {
      setError(ordersRes.error.message);
    } else {
      setOrders((ordersRes.data as unknown as FeedOrder[]) ?? []);
    }
    if (merchantsRes.error) {
      setError(merchantsRes.error.message);
    } else {
      setMerchants((merchantsRes.data as unknown as NearbyMerchant[]) ?? []);
    }
    setLoading(false);
    setRefreshing(false);
  }, [lat, lng]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const openOrders = orders.filter((o) => o.status === "open");

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Découvrir"
        subtitle={profile?.neighborhood ?? undefined}
        right={
          <View style={styles.headerActions}>
            <HeaderButton glyph="🔔" onPress={() => router.push("/notifications")} />
            <HeaderButton glyph="+" onPress={() => router.push("/new-order")} accent />
          </View>
        }
      />

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : loading ? (
        <ActivityIndicator size="large" color={colors.brand} style={{ marginTop: 60 }} />
      ) : !hasLocation ? (
        <EmptyState
          icon="📍"
          title="Définissez votre quartier"
          hint="Choisissez votre quartier (GPS ou adresse) pour voir les commerçants et les commandes groupées autour de chez vous."
        />
      ) : (
        <FlatList
          data={openOrders}
          keyExtractor={(o) => o.id}
          ListHeaderComponent={
            <View>
              <SectionTitle title="Commerçants partenaires" right="à proximité" />
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={merchants}
                keyExtractor={(m) => m.id}
                renderItem={({ item }) => (
                  <MerchantChip merchant={item} onPress={() => router.push(`/merchant/${item.id}`)} />
                )}
                contentContainerStyle={styles.merchantRow}
                ListEmptyComponent={
                  <Text style={styles.noMerchants}>
                    Aucun commerçant partenaire à proximité pour l'instant.
                  </Text>
                }
              />
              <SectionTitle title="Commandes à rejoindre" />
            </View>
          }
          renderItem={({ item }) => <OrderCard order={item} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <EmptyState
              icon="🧺"
              title="Aucune commande ouverte"
              hint="Soyez le premier à lancer une commande groupée chez un commerçant du quartier, puis partagez le lien à vos voisins."
            />
          }
        />
      )}
    </View>
  );
}

function SectionTitle({ title, right }: { title: string; right?: string }) {
  return (
    <View style={styles.sectionTitleRow}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {right ? <Text style={styles.sectionRight}>{right}</Text> : null}
    </View>
  );
}

function MerchantChip({ merchant, onPress }: { merchant: NearbyMerchant; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.merchantCard, pressed && { opacity: 0.85 }]}
    >
      <Text style={styles.merchantEmoji}>🏪</Text>
      <Text style={styles.merchantName} numberOfLines={2}>
        {merchant.name}
      </Text>
      <Text style={styles.merchantMeta}>
        {MERCHANT_CATEGORY_LABELS[merchant.category] ?? ""}
      </Text>
      <Text style={styles.merchantMeta}>
        {merchant.distance_m != null ? `📍 ${formatDistance(merchant.distance_m)}` : ""}
        {merchant.active_offers > 0 ? ` · ${merchant.active_offers} offre${merchant.active_offers > 1 ? "s" : ""}` : ""}
      </Text>
    </Pressable>
  );
}

function HeaderButton({ glyph, onPress, accent }: { glyph: string; onPress: () => void; accent?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[styles.headerBtn, accent && styles.headerBtnAccent]}>
      <Text style={[styles.headerBtnText, accent && { color: colors.onBrand }]}>{glyph}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: spacing.md, backgroundColor: colors.bg },
  headerActions: { flexDirection: "row", gap: 8 },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  headerBtnAccent: { backgroundColor: colors.brand, borderColor: colors.brand },
  headerBtnText: { fontSize: 17, fontWeight: "700", color: colors.text },
  listContent: { paddingBottom: 90 },
  errorBox: { padding: spacing.md, alignItems: "center" },
  errorText: { color: colors.danger, textAlign: "center" },
  sectionTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  sectionTitle: { fontSize: 17, fontWeight: "800", color: colors.text },
  sectionRight: { fontSize: 12, color: colors.textFaint },
  merchantRow: { gap: spacing.sm, paddingBottom: spacing.xs },
  merchantCard: {
    width: 150,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  merchantEmoji: { fontSize: 22 },
  merchantName: { fontSize: 14, fontWeight: "700", color: colors.text, marginTop: 6, lineHeight: 18 },
  merchantMeta: { fontSize: 11, color: colors.textMuted, marginTop: 3 },
  noMerchants: { fontSize: 13, color: colors.textMuted, paddingVertical: spacing.sm },
});