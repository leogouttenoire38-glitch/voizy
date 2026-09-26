import React, { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { EmptyState, LoadError, ScreenHeader } from "../../components/ui";
import { MyOrderCard } from "../../components/MyOrderCard";
import { colors, fonts, fontSizes, radius, spacing, touch } from "../../theme";
import { useAuth } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import { attemptLoad } from "../../lib/load";
import type { GroupOrder, Participation } from "../../types";

interface OrderWithMerchant extends GroupOrder {
  merchants?: { name: string } | null;
}

export default function OrdersScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const uid = session?.user.id;

  const [orders, setOrders] = useState<OrderWithMerchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!uid) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const uidVal = uid;
    // attemptLoad ne lève jamais : on n'avale plus l'erreur en silence (avant,
    // un échec affichait « Aucune commande », un mensonge, sans moyen de
    // réessayer). Ici l'échec devient visible et réessayable.
    const res = await attemptLoad(async () => {
      const { data: myParts, error: partsErr } = await supabase
        .from("participations")
        .select("group_order_id")
        .eq("user_id", uidVal);
      if (partsErr) throw partsErr;

      const joinedIds = ((myParts ?? []) as Participation[]).map((p) => p.group_order_id);

      const { data, error: ordersErr } = await supabase
        .from("group_orders")
        .select("*, merchants(name)")
        .or(
          joinedIds.length > 0
            ? `organizer_id.eq.${uidVal},id.in.(${joinedIds.join(",")})`
            : `organizer_id.eq.${uidVal}`,
        )
        .order("created_at", { ascending: false });
      if (ordersErr) throw ordersErr;
      return (data as unknown as OrderWithMerchant[]) ?? [];
    }, "Impossible de charger vos commandes. Vérifiez votre connexion puis réessayez.");
    try {
      if (res.ok) {
        setOrders(res.data);
        setError(null);
      } else {
        setError(res.error);
      }
    } finally {
      // Toujours arrêter le chargement (et le rafraîchissement), même en cas
      // d'échec inattendu : plus de spinner ni de « tirez pour rafraîchir » figés.
      setLoading(false);
      setRefreshing(false);
    }
  }, [uid]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Mes commandes"
        subtitle="Organisées ou rejointes"
        right={
          <CreateButton onPress={() => router.push("/new-order")} />
        }
      />

      {error ? (
        <LoadError message={error} onRetry={onRefresh} retrying={refreshing} />
      ) : loading ? (
        <ActivityIndicator size="large" color={colors.brand} style={{ marginTop: 60 }} />
      ) : orders.length === 0 ? (
        <EmptyState
          icon="📦"
          title="Aucune commande pour l'instant"
          hint="Lancez une commande groupée chez un commerçant du quartier, ou rejoignez-en une depuis l'onglet Découvrir."
        />
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id}
          renderItem={({ item }) => (
            <MyOrderCard
              order={item}
              merchantName={item.merchants?.name ?? "Commerçant"}
              isOrganizer={item.organizer_id === uid}
            />
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <Text style={styles.hint}>
              Les seuils se verrouillent automatiquement à l'heure de retrait.
            </Text>
          }
        />
      )}
    </View>
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
  listContent: { paddingBottom: 90 },
  hint: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, marginBottom: spacing.sm, fontFamily: fonts.regular },
  createBtn: {
    minHeight: touch.icon,
    borderRadius: radius.full,
    backgroundColor: colors.brand,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  createBtnText: { fontSize: fontSizes.body, fontWeight: "700", color: colors.onBrand, fontFamily: fonts.bold },
});