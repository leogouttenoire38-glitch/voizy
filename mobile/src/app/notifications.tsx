import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Badge, EmptyState, Screen, ScreenHeader } from "../components/ui";
import { colors, radius, spacing } from "../theme";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import type { AppNotification } from "../types";

const TYPE_META: Record<string, { icon: string; label: string; tone: "brand" | "accent" | "danger" | "warning" | "muted" }> = {
  order_joined: { icon: "👋", label: "Nouveau participant", tone: "brand" },
  order_confirmed: { icon: "🎉", label: "Commande confirmée", tone: "accent" },
  order_cancelled: { icon: "ℹ️", label: "Commande annulée", tone: "danger" },
  pickup_reminder: { icon: "⏰", label: "Rappel de retrait", tone: "warning" },
  deposit_released: { icon: "✅", label: "Caution libérée", tone: "accent" },
  deposit_captured: { icon: "🔒", label: "Caution retenue", tone: "danger" },
  order_completed: { icon: "🎉", label: "Commande terminée", tone: "muted" },
  no_show: { icon: "⚠️", label: "No-show signalé", tone: "danger" },
};

export default function NotificationsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const uid = session?.user.id;

  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!uid) return;
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(100);
    if (!error) setItems((data as AppNotification[]) ?? []);
    setLoading(false);
  }, [uid]);

  useEffect(() => {
    load();
  }, [load]);

  // Marque tout comme lu dès l'ouverture de l'écran.
  useEffect(() => {
    const unread = items.filter((n) => !n.read).map((n) => n.id);
    if (unread.length > 0) {
      supabase.rpc("set_notifications_read", { p_ids: unread }).then(() => load());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length > 0]);

  const body = (n: AppNotification): string => {
    const p = n.payload;
    switch (n.type) {
      case "order_joined":
        return `${p.actor_name ?? "Un voisin"} a rejoint « ${p.title ?? ""} » (${p.participants_current ?? "?"}/${p.threshold ?? "?"}).`;
      case "order_confirmed":
        return `« ${p.title ?? ""} » est confirmée chez ${p.merchant_name ?? ""} — retrait ${p.pickup_location ?? ""}.`;
      case "order_cancelled":
        return `Le seuil n'a pas été atteint pour « ${p.title ?? ""} ». Rien n'a été débité.`;
      case "pickup_reminder":
        return `Retrait chez ${p.merchant_name ?? ""} : présentez-vous à l'heure convenue.`;
      case "deposit_released":
        return `Votre caution de ${Number(p.amount ?? 0).toFixed(2).replace(".", ",")} € a été libérée.`;
      case "deposit_captured":
        return `Votre caution de ${Number(p.amount ?? 0).toFixed(2).replace(".", ",")} € a été retenue (no-show).`;
      case "order_completed":
        return `« ${p.title ?? ""} » est terminée. Merci d'avoir participé !`;
      case "no_show":
        return `${p.no_show_count ?? 0} participant(s) absent(s) au retrait — caution retenue.`;
      default:
        return "";
    }
  };

  const onPressItem = (n: AppNotification) => {
    const orderId = n.payload.group_order_id as string | undefined;
    if (orderId) router.push(`/order/${orderId}`);
  };

  return (
    <Screen>
      <ScreenHeader title="Notifications" />
      {loading ? (
        <ActivityIndicator size="large" color={colors.brand} style={{ marginTop: 60 }} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="🔔"
          title="Aucune notification"
          hint="Vous serez prévenu quand une commande atteint son seuil, quand un retrait approche, et quand votre caution est libérée."
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => n.id}
          renderItem={({ item }) => {
            const meta = TYPE_META[item.type] ?? { icon: "🔔", label: "Notification", tone: "muted" as const };
            return (
              <Pressable
                onPress={() => onPressItem(item)}
                style={({ pressed }) => [styles.row, !item.read && styles.rowUnread, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.icon}>{meta.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>{meta.label}</Text>
                  <Text style={styles.body} numberOfLines={3}>{body(item)}</Text>
                  <Text style={styles.date}>
                    {new Date(item.created_at).toLocaleString("fr-FR", {
                      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                    })}
                  </Text>
                </View>
                {!item.read ? <View style={styles.dot} /> : <Badge label="" tone="muted" />}
              </Pressable>
            );
          }}
          contentContainerStyle={{ paddingBottom: 60 }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rowUnread: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  icon: { fontSize: 22, marginRight: spacing.md },
  label: { fontSize: 14, fontWeight: "700", color: colors.text },
  body: { fontSize: 13, color: colors.textMuted, marginTop: 3, lineHeight: 18 },
  date: { fontSize: 11, color: colors.textFaint, marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand, marginLeft: spacing.sm },
});