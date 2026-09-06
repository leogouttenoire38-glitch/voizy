import React, { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { EmptyState, ScreenHeader } from "../../components/ui";
import { MyOrderCard } from "../../components/MyOrderCard";
import { colors, fonts, fontSizes, radius, spacing, touch } from "../../theme";
import { useAuth } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
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

  const load = useCallback(async () => {
    if (!uid) return;
    const { data: myParts } = await supabase
      .from("participations")
      .select("group_order_id")
      .eq("user_id", uid);

    const joinedIds = ((myParts ?? []) as Participation[]).map((p) => p.group_order_id);

    const { data, error } = await supabase
      .from("group_orders")
      .select("*, merchants(name)")
      .or(
        joinedIds.length > 0
          ? `organizer_id.eq.${uid},id.in.(${joinedIds.join(",")})`
          : `organizer_id.eq.${uid}`,
      )
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("orders load", error.message);
    } else {
      setOrders((data as unknown as OrderWithMerchant[]) ?? []);
    }
    setLoading(false);
    setRefreshing(false);
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

      {loading ? (
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