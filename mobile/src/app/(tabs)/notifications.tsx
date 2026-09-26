import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Badge, EmptyState, LoadError, ScreenHeader, type BadgeTone } from "../../components/ui";
import { colors, fonts, fontSizes, lineHeights, radius, spacing } from "../../theme";
import { supabase } from "../../lib/supabase";
import { attemptLoad } from "../../lib/load";
import { useAuth } from "../../lib/auth";
import type { AppNotification } from "../../types";

const TYPE_META: Record<string, { icon: string; label: string; tone: BadgeTone }> = {
  order_joined: { icon: "👋", label: "Nouveau participant", tone: "brand" },
  order_confirmed: { icon: "🎉", label: "Commande confirmée", tone: "success" },
  order_cancelled: { icon: "ℹ️", label: "Commande annulée", tone: "danger" },
  pickup_reminder: { icon: "⏰", label: "Rappel de retrait", tone: "accent" },
  deposit_released: { icon: "✅", label: "Caution libérée", tone: "success" },
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
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    if (!uid) {
      setLoading(false);
      return;
    }
    const uidVal = uid;
    // attemptLoad ne lève jamais : plus de chargement infini ni d'
    // « Aucune notification » mensonger quand la requête échoue.
    const res = await attemptLoad(async () => {
      const { data, error: err } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", uidVal)
        .order("created_at", { ascending: false })
        .limit(100);
      if (err) throw err;
      return (data as AppNotification[]) ?? [];
    }, "Impossible de charger vos notifications. Vérifiez votre connexion puis réessayez.");
    try {
      if (res.ok) {
        setItems(res.data);
        setError(null);
      } else {
        setError(res.error);
      }
    } finally {
      // Toujours arrêter le chargement, même en cas d'échec inattendu :
      // l'écran affiche alors l'échec et propose « Réessayer ».
      setLoading(false);
      setRetrying(false);
    }
  }, [uid]);

  useEffect(() => {
    load();
  }, [load]);

  const retry = useCallback(() => {
    setRetrying(true);
    load();
  }, [load]);

  // Marque tout comme lu dès l'ouverture de l'écran. Un échec ici reste
  // silencieux : au pire les notifications seront re-marquées au prochain
  // affichage — il ne doit jamais casser l'écran de liste ni créer de
  // promesse non gérée.
  useEffect(() => {
    const unread = items.filter((n) => !n.read).map((n) => n.id);
    if (unread.length > 0) {
      (async () => {
        try {
          await supabase.rpc("set_notifications_read", { p_ids: unread });
          await load();
        } catch {
          // Silencieux : au pire les notifications seront re-marquées au
          // prochain affichage. Jamais de promesse non gérée.
        }
      })();
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
    <View style={styles.root}>
      <ScreenHeader title="Notifications" subtitle="Tout ce qui se passe sur vos commandes" />
      {error ? (
        <LoadError message={error} onRetry={retry} retrying={retrying} />
      ) : loading ? (
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
            const meta = TYPE_META[item.type] ?? { icon: "🔔", label: "Notification", tone: "muted" as BadgeTone };
            return (
              <Pressable
                onPress={() => onPressItem(item)}
                accessibilityRole="button"
                accessibilityLabel={`${meta.label} : ${body(item)}`}
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: spacing.md, backgroundColor: colors.bg },
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
  rowUnread: { borderColor: colors.brand, borderWidth: 2, backgroundColor: colors.brandSoft },
  icon: { fontSize: 26, marginRight: spacing.md },
  label: { fontSize: fontSizes.body, fontWeight: "700", color: colors.ink, fontFamily: fonts.bold },
  body: { fontSize: fontSizes.body, color: colors.inkMuted, marginTop: 3, lineHeight: lineHeights.body, fontFamily: fonts.regular },
  date: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, marginTop: 4, fontFamily: fonts.regular },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.brand, marginLeft: spacing.sm },
});