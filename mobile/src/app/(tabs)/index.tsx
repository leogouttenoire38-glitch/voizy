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
import { Button, EmptyState, LoadError, ScreenHeader } from "../../components/ui";
import { OrderCard } from "../../components/OrderCard";
import { colors, fonts, fontSizes, lineHeights, radius, spacing, touch } from "../../theme";
import { useAuth } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import { attemptLoad } from "../../lib/load";
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
      setError(null);
      return;
    }
    const latVal = lat;
    const lngVal = lng;
    setHasLocation(true);
    // attemptLoad ne lève jamais (délai de 20 s borné via ./net) : le chargement
    // s'arrête toujours, et l'échec devient visible + réessayable au lieu de
    // laisser tourner l'indicateur en silence.
    const res = await attemptLoad(async () => {
      const [ordersRes, merchantsRes] = await Promise.all([
        supabase.rpc("open_orders_feed", { p_lat: latVal, p_lng: lngVal, p_radius_m: 5000, p_limit: 50 }),
        supabase.rpc("nearby_merchants", { p_lat: latVal, p_lng: lngVal, p_radius_m: 5000, p_limit: 50 }),
      ]);
      if (ordersRes.error) throw ordersRes.error;
      if (merchantsRes.error) throw merchantsRes.error;
      return {
        orders: (ordersRes.data as unknown as FeedOrder[]) ?? [],
        merchants: (merchantsRes.data as unknown as NearbyMerchant[]) ?? [],
      };
    }, "Impossible de charger les commandes et les commerçants du quartier. Vérifiez votre connexion puis réessayez.");
    try {
      if (res.ok) {
        setOrders(res.data.orders);
        setMerchants(res.data.merchants);
        setError(null);
      } else {
        setError(res.error);
      }
    } finally {
      // Toujours arrêter le chargement, même en cas d'échec inattendu :
      // l'écran affiche alors l'échec et propose « Réessayer ».
      setLoading(false);
      setRefreshing(false);
    }
  }, [lat, lng]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // « Réessayer » et tirer-pour-rafraîchir passent par le même chemin : l'état
  // d'échec ne disparaît qu'une fois les données réellement rechargées.
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const openOrders = orders.filter((o) => o.status === "open");

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Découvrir"
        subtitle={profile?.neighborhood ?? undefined}
        right={
          <View style={styles.headerActions}>
            <CreateButton onPress={() => router.push("/new-order")} />
          </View>
        }
      />

      {error ? (
        <LoadError message={error} onRetry={onRefresh} retrying={refreshing} />
      ) : loading ? (
        <ActivityIndicator size="large" color={colors.brand} style={{ marginTop: 60 }} />
      ) : !hasLocation ? (
        <View style={styles.noLocation}>
          <EmptyState
            icon="📍"
            title="Définissez votre quartier"
            hint="Choisissez votre quartier (GPS ou adresse) pour voir les commerçants et les commandes groupées autour de chez vous."
          />
          {/* Jamais de cul-de-sac : l'action est visible, pas cachée. */}
          <Button title="Choisir mon quartier" onPress={() => router.push("/onboarding")} />
        </View>
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
      accessibilityRole="button"
      accessibilityLabel={`Commerçant ${merchant.name}`}
      style={({ pressed }) => [styles.merchantCard, pressed && { opacity: 0.85 }]}
    >
      <Text style={styles.merchantEmoji}>🏪</Text>
      <Text style={styles.merchantName} numberOfLines={2}>
        {merchant.name}
      </Text>
      <Text style={styles.merchantMeta}>{MERCHANT_CATEGORY_LABELS[merchant.category] ?? ""}</Text>
      <Text style={styles.merchantMeta}>
        {merchant.distance_m != null ? `📍 ${formatDistance(merchant.distance_m)}` : ""}
        {merchant.active_offers > 0 ? ` · ${merchant.active_offers} offre${merchant.active_offers > 1 ? "s" : ""}` : ""}
      </Text>
    </Pressable>
  );
}

/** Bouton d'action principal de l'écran : icône + texte ensemble. */
function CreateButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Créer une commande"
      style={({ pressed }) => [styles.createBtn, pressed && { opacity: 0.85 }]}
    >
      <Text style={styles.createBtnText}>＋ Créer</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: spacing.md, backgroundColor: colors.bg },
  headerActions: { flexDirection: "row", gap: 8 },
  createBtn: {
    minHeight: touch.icon,
    borderRadius: radius.full,
    backgroundColor: colors.brand,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  createBtnText: { fontSize: fontSizes.body, fontWeight: "700", color: colors.onBrand, fontFamily: fonts.bold },
  listContent: { paddingBottom: 90 },
  noLocation: { gap: spacing.md },
  sectionTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  sectionTitle: { fontSize: fontSizes.heading, fontWeight: "800", color: colors.ink, fontFamily: fonts.extraBold },
  sectionRight: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, fontFamily: fonts.regular },
  merchantRow: { gap: spacing.sm, paddingBottom: spacing.xs },
  merchantCard: {
    width: 160,
    minHeight: 120,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  merchantEmoji: { fontSize: 26 },
  merchantName: { fontSize: fontSizes.body, fontWeight: "700", color: colors.ink, marginTop: 6, lineHeight: lineHeights.body, fontFamily: fonts.bold },
  merchantMeta: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, marginTop: 3, fontFamily: fonts.regular },
  noMerchants: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, paddingVertical: spacing.sm, fontFamily: fonts.regular },
});