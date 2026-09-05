import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Badge, Button, Card, Row, ScreenHeader } from "../../components/ui";
import { ProgressBar } from "../../components/ProgressBar";
import { colors, radius, spacing } from "../../theme";
import { useAuth } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import { confirmPickup, joinOrder } from "../../lib/api";
import { startCardSetup } from "../../lib/checkout";
import { orderShareMessage, orderShareUrl } from "../../lib/share";
import { countdown, formatDateTime, formatPrice, formatTime } from "../../lib/format";
import type { GroupOrder, Merchant, Participation } from "../../types";

interface OrderDetail extends GroupOrder {
  merchants?: Merchant | null;
  offers?: { title: string } | null;
}

export default function OrderScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, profile } = useAuth();
  const uid = session?.user.id;

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [myParticipation, setMyParticipation] = useState<Participation | null>(null);
  const [participants, setParticipants] = useState<Participation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [joining, setJoining] = useState(false);
  const [needCard, setNeedCard] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [noShowIds, setNoShowIds] = useState<Set<string>>(new Set());

  const orderId = useMemo(() => order?.id ?? null, [order]);

  const load = useCallback(async () => {
    if (!id) return;

    // id peut être un UUID (navigation interne) ou un share_token (lien partagé).
    let { data, error: err } = await supabase
      .from("group_orders")
      .select("*, merchants(*), offers(title)")
      .eq("id", id)
      .maybeSingle();

    if (err || !data) {
      const byToken = await supabase
        .from("group_orders")
        .select("*, merchants(*), offers(title)")
        .eq("share_token", id)
        .maybeSingle();
      data = byToken.data;
      err = byToken.error;
    }

    if (err || !data) {
      setError(err?.message ?? "Commande introuvable.");
      setLoading(false);
      return;
    }

    setOrder(data as unknown as OrderDetail);
    setError(null);

    // Ma participation + participants (pour la confirmation de retrait).
    if (uid) {
      const [partRes, partsRes] = await Promise.all([
        supabase
          .from("participations")
          .select("*")
          .eq("group_order_id", (data as { id: string }).id)
          .eq("user_id", uid)
          .maybeSingle(),
        supabase
          .from("participations")
          .select("*")
          .eq("group_order_id", (data as { id: string }).id)
          .in("status", ["paid"]),
      ]);
      if (!partRes.error) setMyParticipation((partRes.data as Participation | null) ?? null);
      if (!partsRes.error) setParticipants((partsRes.data as Participation[]) ?? []);
    }
    setLoading(false);
  }, [id, uid]);

  useEffect(() => {
    load();
  }, [load]);

  // Progression en temps réel (seuil, statut).
  useEffect(() => {
    if (!orderId) return;
    const channel = supabase
      .channel(`order-${orderId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "group_orders", filter: `id=eq.${orderId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [orderId, load]);

  const doJoin = async () => {
    if (!order) return;
    setJoining(true);
    setError(null);
    try {
      const res = await joinOrder(order.id);
      if (!res.ok) {
        if (res.action === "setup_required") {
          setNeedCard(true);
        } else {
          setError(res.error);
        }
        return;
      }
      setNeedCard(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de rejoindre la commande.");
    } finally {
      setJoining(false);
    }
  };

  const onCardSetupDone = async () => {
    setNeedCard(false);
    await load();
  };

  const share = async () => {
    if (!order) return;
    const url = orderShareUrl(order.share_token);
    try {
      await Share.share({
        message: orderShareMessage(order.share_token, order.title, order.group_price, order.threshold, order.pickup_at),
        url,
      });
    } catch {
      // Partage annulé par l'utilisateur.
    }
  };

  const toggleNoShow = (partId: string) => {
    setNoShowIds((prev) => {
      const next = new Set(prev);
      if (next.has(partId)) next.delete(partId);
      else next.add(partId);
      return next;
    });
  };

  const doConfirmPickup = async () => {
    if (!order) return;
    const present = participants.length - noShowIds.size;
    Alert.alert(
      "Confirmer le retrait",
      `${present} participant${present > 1 ? "s" : ""} présent${present > 1 ? "s" : ""}${
        noShowIds.size > 0 ? `, ${noShowIds.size} no-show (caution retenue)` : ""
      }. Les cautions des présents seront libérées immédiatement.`,
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Confirmer",
          style: "destructive",
          onPress: async () => {
            setConfirming(true);
            setError(null);
            try {
              const res = await confirmPickup(order.id, [...noShowIds]);
              if (!res.ok) {
                setError(res.error);
              } else {
                await load();
                Alert.alert("Retrait confirmé 🎉", "Cautions libérées pour les participants présents.");
              }
            } catch (err) {
              setError(err instanceof Error ? err.message : "Erreur lors de la confirmation.");
            } finally {
              setConfirming(false);
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  if (!order) {
    return (
      <View style={styles.centered}>
        <Text style={styles.bigError}>{error ?? "Commande introuvable."}</Text>
        <Button title="Retour" variant="outline" onPress={() => router.back()} style={{ marginTop: spacing.md }} />
      </View>
    );
  }

  const isOrganizer = order.organizer_id === uid;
  const isParticipant = Boolean(myParticipation);
  const isOpen = order.status === "open";
  const canJoin = isOpen && !isOrganizer && !isParticipant;
  const merchant = order.merchants;
  const progressCurrent = Math.min(order.participants_current, order.threshold);

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Commande groupée"
        right={
          isOrganizer && isOpen ? (
            <Pressable onPress={share} style={styles.shareBtn}>
              <Text style={styles.shareText}>🔗 Partager</Text>
            </Pressable>
          ) : undefined
        }
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Statut + commerçant */}
        <Card>
          <Row style={{ justifyContent: "space-between", marginBottom: 8 }}>
            <StatusBadge status={order.status} />
            {isOrganizer ? <Badge label="Organisateur" tone="brand" /> : null}
          </Row>
          <Text style={styles.title}>{order.title}</Text>
          <Text style={styles.merchantLine}>🏪 {merchant?.name ?? "Commerçant"}</Text>
          <Text style={styles.merchantLine}>📍 {order.pickup_location}</Text>
        </Card>

        {/* Prix */}
        <Card style={styles.card}>
          <Row style={{ justifyContent: "space-between" }}>
            <View>
              <Text style={styles.groupPrice}>{formatPrice(order.group_price)}</Text>
              <Text style={styles.perUnit}>par {order.unit_label}</Text>
            </View>
            <View style={styles.priceRight}>
              <Text style={styles.basePrice}>{formatPrice(order.base_price)}</Text>
              <Badge label={`−${Math.round((1 - order.group_price / order.base_price) * 100)}%`} tone="accent" />
            </View>
          </Row>
          <Text style={styles.depositLine}>
            🔒 Caution remboursable : {formatPrice(order.deposit_amount)} (pré-autorisation, jamais débitée si vous venez chercher)
          </Text>
        </Card>

        {/* Progression */}
        <Card style={styles.card}>
          <ProgressBar current={progressCurrent} threshold={order.threshold} confirmed={order.status !== "open"} />
          {isOpen ? (
            <Text style={styles.countdown}>⏳ Verrouillage automatique {countdown(order.pickup_at)}</Text>
          ) : null}
        </Card>

        {/* Retrait */}
        <Card style={styles.card}>
          <Text style={styles.sectionLabel}>Retrait</Text>
          <Text style={styles.pickupWhen}>🗓 {formatDateTime(order.pickup_at)} ({formatTime(order.pickup_at)})</Text>
          <Text style={styles.pickupWhere}>chez {merchant?.name ?? "le commerçant"} — {order.pickup_location}</Text>
          <Text style={styles.organizerLine}>
            Organisé par <Text style={{ fontWeight: "700" }}>{profile && order.organizer_id === uid ? "vous" : "un voisin"}</Text>
          </Text>
        </Card>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Actions */}
        {canJoin && !needCard ? (
          <View style={styles.actions}>
            <Button
              title={`Rejoindre — ${formatPrice(order.group_price)} + ${formatPrice(order.deposit_amount)} de caution`}
              onPress={doJoin}
              loading={joining}
            />
            <Text style={styles.joinHint}>
              Le paiement n'est prélevé que si le seuil est atteint. Sinon, rien n'est débité.
            </Text>
          </View>
        ) : null}

        {canJoin && needCard ? (
          <View style={styles.actions}>
            <Text style={styles.needCardText}>
              Vous devez d'abord enregistrer une carte pour participer (paiement + caution).
            </Text>
            <Button title="💳 Enregistrer ma carte" onPress={async () => startCardSetup().then(onCardSetupDone)} />
          </View>
        ) : null}

        {isOrganizer && order.status === "confirmed" ? (
          <View style={styles.actions}>
            <Text style={styles.sectionLabel}>Retrait — participants</Text>
            {participants.length === 0 ? (
              <Text style={styles.organizerLine}>Aucun participant en attente de retrait.</Text>
            ) : (
              participants.map((p) => (
                <Pressable key={p.id} onPress={() => toggleNoShow(p.id)} style={styles.participantRow}>
                  <Text style={styles.participantName}>
                    {p.id === uid ? "Vous" : "Participant"}
                    {p.deposit_amount > 0 ? ` · caution ${formatPrice(p.deposit_amount)}` : ""}
                  </Text>
                  <Text style={[styles.noShowLabel, noShowIds.has(p.id) && styles.noShowLabelActive]}>
                    {noShowIds.has(p.id) ? "No-show (caution retenue)" : "Présent ✓"}
                  </Text>
                </Pressable>
              ))
            )}
            <Button title="Confirmer le retrait" onPress={doConfirmPickup} loading={confirming} disabled={participants.length === 0} />
          </View>
        ) : null}

        {isOrganizer && order.status === "open" ? (
          <View style={styles.actions}>
            <Button title="🔗 Partager à mes voisins" onPress={share} variant="secondary" />
          </View>
        ) : null}

        {isParticipant && order.status === "confirmed" ? (
          <Card style={styles.card}>
            <Text style={styles.sectionLabel}>Votre participation</Text>
            <Text style={styles.organizerLine}>
              Statut : <Badge label="Confirmée" tone="accent" />
            </Text>
            <Text style={styles.joinHint}>
              Présentez-vous au retrait : votre caution sera libérée automatiquement à la confirmation.
            </Text>
          </Card>
        ) : null}

        {isParticipant && order.status === "completed" ? (
          <Card style={styles.card}>
            <Text style={styles.sectionLabel}>Commande terminée 🎉</Text>
            <Text style={styles.organizerLine}>
              {myParticipation?.status === "no_show"
                ? "Vous n'avez pas récupéré votre commande — la caution a été retenue."
                : "Merci d'avoir participé ! Votre caution a été libérée."}
            </Text>
          </Card>
        ) : null}

        <View style={{ height: 60 }} />
      </ScrollView>
    </View>
  );
}

function StatusBadge({ status }: { status: GroupOrder["status"] }) {
  const map = {
    open: { label: "Ouverte", tone: "brand" as const },
    confirmed: { label: "Confirmée", tone: "accent" as const },
    completed: { label: "Terminée", tone: "muted" as const },
    cancelled: { label: "Annulée", tone: "danger" as const },
  };
  const st = map[status];
  return <Badge label={st.label} tone={st.tone} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg, padding: spacing.lg },
  bigError: { fontSize: 15, color: colors.danger, textAlign: "center" },
  scroll: { paddingHorizontal: spacing.md, paddingTop: spacing.xs },
  shareBtn: {
    backgroundColor: colors.brand,
    borderRadius: radius.full,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  shareText: { color: colors.onBrand, fontSize: 13, fontWeight: "700" },
  card: { marginTop: spacing.sm },
  title: { fontSize: 19, fontWeight: "800", color: colors.text, lineHeight: 24 },
  merchantLine: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  groupPrice: { fontSize: 26, fontWeight: "900", color: colors.accent },
  perUnit: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  priceRight: { alignItems: "flex-end", gap: 6 },
  basePrice: { fontSize: 15, color: colors.textFaint, textDecorationLine: "line-through" },
  depositLine: { fontSize: 12, color: colors.textMuted, marginTop: spacing.sm, lineHeight: 17 },
  countdown: { fontSize: 12, color: colors.warning, marginTop: spacing.sm, fontWeight: "600" },
  sectionLabel: { fontSize: 13, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  pickupWhen: { fontSize: 15, fontWeight: "700", color: colors.text },
  pickupWhere: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  organizerLine: { fontSize: 13, color: colors.textMuted, marginTop: 6, lineHeight: 18 },
  errorBox: { marginTop: spacing.md, backgroundColor: colors.dangerSoft, borderRadius: radius.md, padding: spacing.md },
  errorText: { color: colors.danger, fontSize: 13 },
  actions: { marginTop: spacing.md, gap: spacing.sm },
  joinHint: { fontSize: 12, color: colors.textFaint, textAlign: "center", lineHeight: 17 },
  needCardText: { fontSize: 13, color: colors.textMuted, textAlign: "center", lineHeight: 18 },
  participantRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    marginBottom: spacing.sm,
  },
  participantName: { fontSize: 14, fontWeight: "600", color: colors.text },
  noShowLabel: { fontSize: 12, color: colors.accent, fontWeight: "700" },
  noShowLabelActive: { color: colors.danger },
});