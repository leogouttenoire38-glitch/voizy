import React, { useCallback, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Badge, Button, Card, EmptyState, LoadError, ScreenHeader } from "../../components/ui";
import { colors, fonts, fontSizes, lineHeights, radius, spacing, touch } from "../../theme";
import { useAuth } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import { formatDateTime, formatPrice } from "../../lib/format";
import { attemptLoad } from "../../lib/load";
import { confirmPickup } from "../../lib/api";
import { businessError, fetchMyMerchant } from "../../lib/merchant";
import type { GroupOrder, Merchant, Participation } from "../../types";

// Commandes du commerce — l'équivalent mobile de la vue web : mêmes règles,
// même Edge Function de confirmation de retrait (aucune logique dupliquée).
const STATUS_LABEL: Record<string, string> = {
  open: "En cours",
  confirmed: "Confirmée",
  completed: "Terminée",
  cancelled: "Annulée",
};

// Les commandes à traiter d'abord (retraits à confirmer), puis celles en cours,
// puis l'historique.
function statusRank(status: string): number {
  if (status === "confirmed") return 0;
  if (status === "open") return 1;
  return 2;
}

export default function MerchantOrdersScreen() {
  const { session } = useAuth();
  const uid = session?.user.id;

  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [orders, setOrders] = useState<GroupOrder[]>([]);
  const [parts, setParts] = useState<Record<string, Participation[]>>({});
  const [noShows, setNoShows] = useState<Record<string, string[]>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!uid) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const res = await attemptLoad(async () => {
      const mine = await fetchMyMerchant(uid);
      if (!mine) throw new Error("no-merchant");
      const { data, error: ordersErr } = await supabase
        .from("group_orders")
        .select("*")
        .eq("merchant_id", mine.id)
        .order("pickup_at", { ascending: false })
        .limit(100);
      if (ordersErr) throw ordersErr;
      const list = ((data as GroupOrder[]) ?? []).sort(
        (a, b) => statusRank(a.status) - statusRank(b.status),
      );

      // Participants en attente de retrait : uniquement les commandes confirmées.
      const confirmedIds = list.filter((o) => o.status === "confirmed").map((o) => o.id);
      let byOrder: Record<string, Participation[]> = {};
      if (confirmedIds.length > 0) {
        const { data: partRows, error: partsErr } = await supabase
          .from("participations")
          .select("*")
          .in("group_order_id", confirmedIds)
          .eq("status", "paid");
        if (partsErr) throw partsErr;
        byOrder = ((partRows as Participation[]) ?? []).reduce<Record<string, Participation[]>>(
          (acc, p) => {
            acc[p.group_order_id] = [...(acc[p.group_order_id] ?? []), p];
            return acc;
          },
          {},
        );
      }
      return { mine, list, byOrder };
    }, "Impossible de charger vos commandes. Vérifiez votre connexion puis réessayez.");

    try {
      if (res.ok) {
        setMerchant(res.data.mine);
        setOrders(res.data.list);
        setParts(res.data.byOrder);
        setNoShows({});
        setError(null);
      } else {
        setError(res.error);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [uid]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const toggleNoShow = (orderId: string, participationId: string) => {
    setNoShows((prev) => {
      const current = prev[orderId] ?? [];
      const next = current.includes(participationId)
        ? current.filter((x) => x !== participationId)
        : [...current, participationId];
      return { ...prev, [orderId]: next };
    });
  };

  const confirm = async (order: GroupOrder) => {
    setBusyId(order.id);
    setActionError(null);
    try {
      const res = await confirmPickup(order.id, noShows[order.id] ?? []);
      if (!res.ok) {
        setActionError(res.error ?? "La confirmation n'a pas abouti. Réessayez.");
        return;
      }
      Alert.alert(
        "Retrait confirmé 🎉",
        `${res.released} participant${(res.released ?? 0) > 1 ? "s" : ""} — cautions libérées.${
          (res.captured ?? 0) > 0
            ? ` ${res.captured} no-show : caution retenue (CGV Voizy).`
            : ""
        }`,
      );
      await load();
    } catch (err) {
      setActionError(businessError(err, "Impossible de confirmer le retrait. Réessayez."));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Commandes" subtitle={merchant?.name ?? "Mon commerce"} />

      {error ? (
        <LoadError message={error} onRetry={onRefresh} retrying={refreshing} />
      ) : loading ? (
        <ActivityIndicator size="large" color={colors.brand} style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View>
              {actionError ? (
                <View style={styles.actionError}>
                  <Text style={styles.actionErrorText}>{actionError}</Text>
                </View>
              ) : null}
              {orders.length > 0 ? (
                <Text style={styles.hint}>
                  Les commandes confirmées se déplient : décochez les participants absents, puis
                  validez le retrait.
                </Text>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              icon="📦"
              title="Aucune commande pour l'instant"
              hint="Dès qu'un voisin lance une commande sur l'une de vos offres, elle apparaît ici — avec le seuil à atteindre et sa date de retrait."
            />
          }
          renderItem={({ item }) => (
            <MerchantOrderCard
              order={item}
              participations={parts[item.id] ?? []}
              noShows={noShows[item.id] ?? []}
              open={openId === item.id}
              busy={busyId === item.id}
              onToggleOpen={() => setOpenId(openId === item.id ? null : item.id)}
              onToggleNoShow={(participationId) => toggleNoShow(item.id, participationId)}
              onConfirm={() => confirm(item)}
            />
          )}
        />
      )}
    </View>
  );
}

function MerchantOrderCard({
  order,
  participations,
  noShows,
  open,
  busy,
  onToggleOpen,
  onToggleNoShow,
  onConfirm,
}: {
  order: GroupOrder;
  participations: Participation[];
  noShows: string[];
  open: boolean;
  busy: boolean;
  onToggleOpen: () => void;
  onToggleNoShow: (participationId: string) => void;
  onConfirm: () => void;
}) {
  const remaining = participations.filter((p) => !noShows.includes(p.id)).length;
  const tone = order.status === "confirmed" ? "success" : order.status === "open" ? "brand" : "muted";

  return (
    <Card style={styles.card}>
      <Pressable
        onPress={onToggleOpen}
        accessibilityRole="button"
        accessibilityLabel={`Commande ${order.title}, ${STATUS_LABEL[order.status] ?? order.status}`}
        accessibilityState={{ expanded: open }}
      >
        <View style={styles.cardTop}>
          <Badge label={STATUS_LABEL[order.status] ?? order.status} tone={tone} />
          <Text style={styles.chevron}>{open ? "▾" : "▸"}</Text>
        </View>
        <Text style={styles.cardTitle}>{order.title}</Text>
        <Text style={styles.cardMeta}>
          🗓 {formatDateTime(order.pickup_at)} · {order.pickup_location}
        </Text>
        <Text style={styles.cardMeta}>
          {order.participants_current}/{order.threshold} participants · {formatPrice(order.group_price)} par{" "}
          {order.unit_label}
          {order.status === "open" && order.participants_current < order.threshold
            ? ` · ${order.threshold - order.participants_current} participant${order.threshold - order.participants_current > 1 ? "s" : ""} manquant${order.threshold - order.participants_current > 1 ? "s" : ""}`
            : ""}
        </Text>
      </Pressable>

      {open && order.status === "confirmed" ? (
        <View style={styles.body}>
          {participations.length === 0 ? (
            <Text style={styles.cardMeta}>Aucun participant en attente de retrait.</Text>
          ) : (
            participations.map((p) => {
              const isNoShow = noShows.includes(p.id);
              return (
                <Pressable
                  key={p.id}
                  onPress={() => onToggleNoShow(p.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isNoShow }}
                  accessibilityLabel={
                    isNoShow
                      ? "Participant absent : caution retenue"
                      : "Participant présent : caution libérée"
                  }
                  style={styles.participantRow}
                >
                  <Text style={styles.checkbox}>{isNoShow ? "☑" : "☐"}</Text>
                  <Text style={styles.participantText}>
                    Participant · {formatPrice(p.amount)} + caution {formatPrice(p.deposit_amount)}
                  </Text>
                  <Text style={isNoShow ? styles.noShow : styles.present}>
                    {isNoShow ? "absent" : "présent ✓"}
                  </Text>
                </Pressable>
              );
            })
          )}

          <Button
            title={`Confirmer le retrait — ${remaining} présent${remaining > 1 ? "s" : ""}${
              noShows.length > 0 ? `, ${noShows.length} no-show` : ""
            }`}
            onPress={onConfirm}
            loading={busy}
            disabled={participations.length === 0}
            style={{ marginTop: spacing.md }}
          />
          <Text style={styles.legal}>
            Les cautions des présents sont libérées immédiatement ; celles des no-show sont retenues
            (CGV Voizy).
          </Text>
        </View>
      ) : null}

      {open && order.status === "open" ? (
        <View style={styles.body}>
          <Text style={styles.cardMeta}>
            La commande se confirme automatiquement dès que le seuil est atteint, ou s'annule à la
            date de retrait si le seuil n'est pas atteint.
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: spacing.md, backgroundColor: colors.bg },
  listContent: { paddingBottom: 90 },
  hint: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, marginBottom: spacing.sm, lineHeight: lineHeights.bodySmall, fontFamily: fonts.regular },
  actionError: { backgroundColor: colors.dangerSoft, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  actionErrorText: { color: colors.danger, fontSize: fontSizes.body, fontFamily: fonts.medium },
  card: { marginBottom: spacing.sm },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  chevron: { fontSize: fontSizes.heading, color: colors.inkMuted, minWidth: 28, textAlign: "right" },
  cardTitle: { fontSize: fontSizes.heading, fontWeight: "800", color: colors.ink, marginTop: 8, fontFamily: fonts.extraBold, lineHeight: lineHeights.heading },
  cardMeta: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, marginTop: 4, lineHeight: lineHeights.bodySmall, fontFamily: fonts.regular },
  body: { marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  participantRow: { flexDirection: "row", alignItems: "center", minHeight: touch.secondary, gap: spacing.sm },
  checkbox: { fontSize: 22, color: colors.ink },
  participantText: { flex: 1, fontSize: fontSizes.bodySmall, color: colors.ink, fontFamily: fonts.regular },
  present: { fontSize: fontSizes.bodySmall, color: colors.brand, fontFamily: fonts.semiBold },
  noShow: { fontSize: fontSizes.bodySmall, color: colors.danger, fontFamily: fonts.semiBold },
  legal: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, marginTop: spacing.sm, lineHeight: lineHeights.bodySmall, fontFamily: fonts.regular },
});
