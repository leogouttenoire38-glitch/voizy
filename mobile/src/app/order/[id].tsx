import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Badge, Button, Card, Row, ScreenHeader, type BadgeTone } from "../../components/ui";
import { ProgressBar } from "../../components/ProgressBar";
import { colors, fonts, fontSizes, lineHeights, radius, spacing, touch } from "../../theme";
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

const STATUS_META: Record<GroupOrder["status"], { label: string; tone: BadgeTone }> = {
  open: { label: "En cours", tone: "brand" },
  confirmed: { label: "Confirmée", tone: "success" },
  completed: { label: "Terminée", tone: "muted" },
  cancelled: { label: "Annulée", tone: "danger" },
};

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
  const [payStep, setPayStep] = useState(false);
  const [busyCard, setBusyCard] = useState(false);
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
          // Pas de carte : on garde l'étape de paiement ouverte et on propose
          // l'enregistrement — le parcours reprend ensuite tout seul.
          setNeedCard(true);
        } else {
          setError(res.error);
        }
        return;
      }
      setNeedCard(false);
      setPayStep(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de rejoindre la commande.");
    } finally {
      setJoining(false);
    }
  };

  // Enregistre la carte puis reprend le parcours sans faire re-taper l'utilisateur.
  const onCardSetup = async () => {
    setBusyCard(true);
    setError(null);
    const ok = await startCardSetup();
    setBusyCard(false);
    if (!ok) {
      setError("La carte n'a pas été enregistrée. Réessayez.");
      return;
    }
    setNeedCard(false);
    await doJoin();
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
    // Action coûteuse (libération de cautions) : confirmation explicite requise.
    Alert.alert(
      "Confirmer le retrait",
      `${present} participant${present > 1 ? "s" : ""} présent${present > 1 ? "s" : ""}${
        noShowIds.size > 0 ? `, ${noShowIds.size} no-show (caution retenue)` : ""
      }. Les cautions des présents seront libérées immédiatement.`,
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Confirmer le retrait",
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
  const statusMeta = STATUS_META[order.status] ?? STATUS_META.open;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Commande groupée" back />
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Statut + commerçant */}
        <Card>
          <Row style={{ justifyContent: "space-between", marginBottom: 8 }}>
            <Badge label={statusMeta.label} tone={statusMeta.tone} />
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
          <View style={styles.depositBox}>
            <Text style={styles.depositLine}>
              🔒 Caution remboursable : {formatPrice(order.deposit_amount)}
            </Text>
            <Text style={styles.depositHint}>
              Pré-autorisation sur votre carte : jamais débitée si vous venez chercher votre commande.
            </Text>
          </View>
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
            Organisé par <Text style={{ fontWeight: "700", fontFamily: fonts.bold }}>{profile && order.organizer_id === uid ? "vous" : "un voisin"}</Text>
          </Text>
        </Card>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Action principale : ouvrir l'ÉTAPE DE PAIEMENT (jamais masquée). */}
        {canJoin ? (
          <View style={styles.actions}>
            <Button
              title={`Rejoindre — ${formatPrice(order.group_price)} + ${formatPrice(order.deposit_amount)} de caution`}
              onPress={() => {
                setError(null);
                setPayStep(true);
              }}
              variant="accent"
            />
            <Text style={styles.joinHint}>
              Le produit n'est débité que si le seuil de {order.threshold} participants est atteint.
            </Text>
          </View>
        ) : null}

        {isOrganizer && order.status === "confirmed" ? (
          <View style={styles.actions}>
            <Text style={styles.sectionLabel}>Retrait — participants</Text>
            {participants.length === 0 ? (
              <Text style={styles.organizerLine}>Aucun participant en attente de retrait.</Text>
            ) : (
              <>
                <Text style={styles.noShowHint}>
                  Appuyez sur un participant pour signaler une absence (no-show, caution retenue).
                </Text>
                {participants.map((p) => {
                  const isNoShow = noShowIds.has(p.id);
                  return (
                    <Pressable
                      key={p.id}
                      onPress={() => toggleNoShow(p.id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isNoShow }}
                      style={({ pressed }) => [
                        styles.participantRow,
                        isNoShow && styles.participantRowNoShow,
                        pressed && { opacity: 0.85 },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.participantName}>{p.id === uid ? "Vous" : "Participant"}</Text>
                        {p.deposit_amount > 0 ? (
                          <Text style={styles.participantDeposit}>Caution {formatPrice(p.deposit_amount)}</Text>
                        ) : null}
                      </View>
                      <View style={[styles.presenceBadge, isNoShow && styles.presenceBadgeNoShow]}>
                        <Text style={[styles.presenceText, isNoShow && styles.presenceTextNoShow]}>
                          {isNoShow ? "Absent · caution retenue" : "Présent ✓"}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </>
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
          <Card style={styles.card} tone="success">
            <Text style={styles.sectionLabel}>Votre participation</Text>
            <Text style={styles.organizerLine}>
              Statut : <Badge label="Confirmée" tone="success" />
            </Text>
            <Text style={styles.joinHint}>
              Présentez-vous au retrait : votre caution sera libérée automatiquement à la confirmation.
            </Text>
          </Card>
        ) : null}

        {isParticipant && order.status === "completed" ? (
          <Card style={styles.card} tone="success">
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

      {/* ------------------------------------------------------------------
          Étape de paiement explicite : montants détaillés + une seule
          décision. Le paiement n'est pas un endroit où simplifier en le
          cachant — il reste visible et annulable.
      ------------------------------------------------------------------ */}
      <Modal
        visible={payStep}
        transparent
        animationType="slide"
        onRequestClose={() => setPayStep(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet} accessibilityViewIsModal>
            <Text style={styles.modalTitle}>Vérifier le paiement</Text>
            <Text style={styles.modalSubtitle}>{order.title}</Text>

            <View style={styles.payBox}>
              <Row style={styles.payLine}>
                <Text style={styles.payLabel}>Produit — {order.unit_label}</Text>
                <Text style={styles.payValue}>{formatPrice(order.group_price)}</Text>
              </Row>
              <Row style={styles.payLine}>
                <Text style={styles.payLabel}>Caution (remboursable)</Text>
                <Text style={styles.payValue}>{formatPrice(order.deposit_amount)}</Text>
              </Row>
              <View style={styles.payDivider} />
              <Row style={styles.payLine}>
                <Text style={styles.payTotalLabel}>Bloqué aujourd'hui</Text>
                <Text style={styles.payTotal}>
                  {formatPrice(order.group_price + order.deposit_amount)}
                </Text>
              </Row>
            </View>

            <Text style={styles.payHint}>
              Le produit n'est débité que si le seuil de {order.threshold} participants est
              atteint. La caution est libérée au retrait : vous ne payez que le produit.
            </Text>

            {needCard ? (
              <Text style={styles.payWarn}>
                Aucune carte enregistrée. Ajoutez-la pour finaliser le paiement — vous reviendrez
                ici automatiquement.
              </Text>
            ) : null}

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {needCard ? (
              <Button
                title="💳 Enregistrer ma carte"
                onPress={onCardSetup}
                loading={busyCard}
                variant="accent"
              />
            ) : (
              <Button
                title={`Confirmer le paiement — ${formatPrice(order.group_price + order.deposit_amount)}`}
                onPress={doJoin}
                loading={joining}
                variant="accent"
              />
            )}

            <Button
              title="Annuler"
              variant="outline"
              onPress={() => {
                setPayStep(false);
                setError(null);
              }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg, padding: spacing.lg },
  bigError: { fontSize: fontSizes.body, color: colors.danger, textAlign: "center", fontFamily: fonts.medium },
  scroll: { paddingHorizontal: spacing.md, paddingTop: spacing.xs },
  card: { marginTop: spacing.sm },
  title: { fontSize: fontSizes.title, fontWeight: "800", color: colors.ink, lineHeight: lineHeights.title, fontFamily: fonts.extraBold },
  merchantLine: { fontSize: fontSizes.body, color: colors.inkMuted, marginTop: 4, fontFamily: fonts.regular },
  groupPrice: { fontSize: 30, fontWeight: "900", color: colors.brand, fontFamily: fonts.extraBold },
  perUnit: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, marginTop: 2, fontFamily: fonts.regular },
  priceRight: { alignItems: "flex-end", gap: 6 },
  basePrice: { fontSize: fontSizes.body, color: colors.inkMuted, textDecorationLine: "line-through", fontFamily: fonts.medium },
  depositBox: {
    marginTop: spacing.sm,
    backgroundColor: colors.brandSoft,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  depositLine: { fontSize: fontSizes.body, color: colors.ink, fontWeight: "700", fontFamily: fonts.bold },
  depositHint: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, marginTop: 4, lineHeight: lineHeights.bodySmall, fontFamily: fonts.regular },
  countdown: { fontSize: fontSizes.body, color: "#7A4E0E", marginTop: spacing.sm, fontWeight: "700", fontFamily: fonts.bold },
  sectionLabel: { fontSize: fontSizes.heading, fontWeight: "700", color: colors.ink, marginBottom: 6, fontFamily: fonts.bold },
  pickupWhen: { fontSize: fontSizes.body, fontWeight: "700", color: colors.ink, fontFamily: fonts.bold },
  pickupWhere: { fontSize: fontSizes.body, color: colors.inkMuted, marginTop: 4, fontFamily: fonts.regular },
  organizerLine: { fontSize: fontSizes.body, color: colors.inkMuted, marginTop: 6, lineHeight: lineHeights.body, fontFamily: fonts.regular },
  errorBox: { marginTop: spacing.md, backgroundColor: colors.dangerSoft, borderRadius: radius.md, padding: spacing.md },
  errorText: { color: colors.danger, fontSize: fontSizes.body, fontFamily: fonts.medium },
  actions: { marginTop: spacing.md, gap: spacing.sm },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(36,48,43,0.45)", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  modalTitle: { fontSize: fontSizes.title, fontWeight: "800", color: colors.ink, fontFamily: fonts.extraBold },
  modalSubtitle: { fontSize: fontSizes.body, color: colors.inkMuted, fontFamily: fonts.regular },
  payBox: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  payLine: { justifyContent: "space-between", paddingVertical: 6 },
  payLabel: { fontSize: fontSizes.body, color: colors.ink, fontFamily: fonts.regular },
  payValue: { fontSize: fontSizes.body, fontWeight: "700", color: colors.ink, fontFamily: fonts.bold },
  payDivider: { height: 1, backgroundColor: colors.border, marginVertical: 6 },
  payTotalLabel: { fontSize: fontSizes.heading, fontWeight: "800", color: colors.ink, fontFamily: fonts.extraBold },
  payTotal: { fontSize: fontSizes.heading, fontWeight: "800", color: colors.brand, fontFamily: fonts.extraBold },
  payHint: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, lineHeight: lineHeights.bodySmall, fontFamily: fonts.regular },
  payWarn: { fontSize: fontSizes.body, color: colors.danger, lineHeight: lineHeights.body, fontFamily: fonts.medium },
  joinHint: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, textAlign: "center", lineHeight: lineHeights.bodySmall, fontFamily: fonts.regular },
  needCardText: { fontSize: fontSizes.body, color: colors.inkMuted, textAlign: "center", lineHeight: lineHeights.body, fontFamily: fonts.regular },
  noShowHint: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, marginBottom: 4, lineHeight: lineHeights.bodySmall, fontFamily: fonts.regular },
  participantRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    minHeight: touch.secondary,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    marginBottom: spacing.sm,
  },
  participantRowNoShow: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  participantName: { fontSize: fontSizes.body, fontWeight: "700", color: colors.ink, fontFamily: fonts.bold },
  participantDeposit: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, marginTop: 2, fontFamily: fonts.regular },
  presenceBadge: {
    backgroundColor: colors.success,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  presenceBadgeNoShow: { backgroundColor: colors.danger },
  presenceText: { color: colors.ink, fontSize: fontSizes.bodySmall, fontWeight: "700", fontFamily: fonts.bold },
  presenceTextNoShow: { color: colors.onBrand },
});