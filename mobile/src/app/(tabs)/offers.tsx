import React, { useCallback, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Badge, Button, Card, EmptyState, LoadError, ScreenHeader } from "../../components/ui";
import { PayoutBanner } from "../../components/PayoutBanner";
import { colors, fonts, fontSizes, lineHeights, radius, spacing, touch } from "../../theme";
import { useAuth } from "../../lib/auth";
import { formatPrice } from "../../lib/format";
import { attemptLoad } from "../../lib/load";
import {
  businessError,
  fetchMerchantOffers,
  fetchMyMerchant,
  fetchPayoutState,
  setOfferActive,
  startMerchantOnboarding,
} from "../../lib/merchant";
import type { PayoutState } from "../../lib/merchant";
import type { Merchant, MerchantOffer } from "../../types";

export default function OffersScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const uid = session?.user.id;

  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [offers, setOffers] = useState<MerchantOffer[]>([]);
  const [payout, setPayout] = useState<PayoutState>("unknown");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [payBusy, setPayBusy] = useState(false);
  const [payNotice, setPayNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!uid) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const res = await attemptLoad(async () => {
      const mine = await fetchMyMerchant(uid);
      if (!mine) throw new Error("no-merchant");
      const [list, state] = await Promise.all([
        fetchMerchantOffers(mine.id),
        fetchPayoutState(mine.id),
      ]);
      return { mine, list, state };
    }, "Impossible de charger vos offres. Vérifiez votre connexion puis réessayez.");

    try {
      if (res.ok) {
        setMerchant(res.data.mine);
        setOffers(res.data.list);
        setPayout(res.data.state);
        setError(null);
      } else {
        setError(res.error);
      }
    } finally {
      // Toujours arrêter chargement et rafraîchissement, même en cas d'échec.
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

  const payouts = async () => {
    if (!merchant) return;
    setPayBusy(true);
    setPayNotice(null);
    try {
      const res = await startMerchantOnboarding(merchant.id);
      if (res.ok) {
        setPayNotice("Compte de paiement activé ✅ Vous recevrez l'argent de vos ventes.");
        await load();
      } else {
        setPayNotice(res.error);
        await load();
      }
    } finally {
      setPayBusy(false);
    }
  };

  const toggle = (offer: MerchantOffer) => {
    const retire = offer.active;
    Alert.alert(
      retire ? "Retirer cette offre ?" : "Remettre cette offre ?",
      retire
        ? "Elle disparaîtra du catalogue. Les commandes déjà lancées iront jusqu'au retrait."
        : "Elle redeviendra visible et commandable par les voisins.",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: retire ? "Retirer" : "Remettre",
          style: retire ? "destructive" : "default",
          onPress: async () => {
            setTogglingId(offer.id);
            setActionError(null);
            try {
              await setOfferActive(offer.id, !offer.active);
              await load();
            } catch (err) {
              setActionError(
                businessError(err, "Impossible de mettre à jour cette offre. Réessayez."),
              );
            } finally {
              setTogglingId(null);
            }
          },
        },
      ],
    );
  };

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Mes offres"
        subtitle={merchant?.name ?? "Mon commerce"}
        right={<CreateButton onPress={() => router.push("/offer-new")} />}
      />

      {error ? (
        <LoadError message={error} onRetry={onRefresh} retrying={refreshing} />
      ) : loading ? (
        <ActivityIndicator size="large" color={colors.brand} style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={offers}
          keyExtractor={(o) => o.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View>
              <PayoutBanner
                state={payout}
                busy={payBusy}
                notice={payNotice}
                onStart={payout === "missing" || payout === "incomplete" ? payouts : undefined}
                onRetry={payout === "unknown" ? onRefresh : undefined}
              />
              {actionError ? (
                <View style={styles.actionError}>
                  <Text style={styles.actionErrorText}>{actionError}</Text>
                </View>
              ) : null}
              {offers.length > 0 ? (
                <Text style={styles.hint}>
                  Décochez une offre pour la retirer du catalogue. Vos prix restent inchangés pour
                  les commandes déjà lancées.
                </Text>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              icon="🏪"
              title="Aucune offre publiée"
              hint="Publiez votre premier produit : vous choisissez le prix groupé, le nombre de voisins à atteindre et la caution."
            />
          }
          renderItem={({ item }) => (
            <OfferCard
              offer={item}
              busy={togglingId === item.id}
              onEdit={() => router.push({ pathname: "/offer-edit", params: { id: item.id } })}
              onToggle={() => toggle(item)}
            />
          )}
        />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Carte d'offre
// ---------------------------------------------------------------------------
function OfferCard({
  offer,
  busy,
  onEdit,
  onToggle,
}: {
  offer: MerchantOffer;
  busy: boolean;
  onEdit: () => void;
  onToggle: () => void;
}) {
  const discount = offer.base_price > 0
    ? Math.round(((offer.base_price - offer.group_price) / offer.base_price) * 100)
    : 0;

  return (
    <Card style={styles.offerCard}>
      <View style={styles.offerTop}>
        <Badge label={offer.active ? "En vente" : "Retirée"} tone={offer.active ? "brand" : "muted"} />
        {offer.open_orders > 0 ? (
          <Badge
            label={`${offer.open_orders} commande${offer.open_orders > 1 ? "s" : ""} en cours`}
            tone="accent"
          />
        ) : null}
      </View>

      <Text style={styles.offerTitle}>{offer.title}</Text>
      {offer.description ? (
        <Text style={styles.offerDesc} numberOfLines={2}>
          {offer.description}
        </Text>
      ) : null}

      <View style={styles.priceRow}>
        <Text style={styles.priceStrong}>{formatPrice(offer.group_price)}</Text>
        <Text style={styles.priceStrike}>{formatPrice(offer.base_price)}</Text>
        {discount > 0 ? <Text style={styles.priceOff}>−{discount} %</Text> : null}
      </View>
      <Text style={styles.offerMeta}>
        par {offer.unit_label} · à partir de {offer.threshold} participants · caution{" "}
        {formatPrice(offer.deposit_amount)}
      </Text>

      <View style={styles.offerActions}>
        <Button title="Modifier" variant="secondary" onPress={onEdit} style={styles.offerButton} />
        <Button
          title={offer.active ? "Retirer" : "Remettre"}
          variant={offer.active ? "outline" : "primary"}
          onPress={onToggle}
          loading={busy}
          style={styles.offerButton}
        />
      </View>
    </Card>
  );
}

/** Bouton d'action principal de l'écran : icône + texte ensemble. */
function CreateButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Créer une offre"
      style={({ pressed }) => [styles.createBtn, pressed && { opacity: 0.85 }]}
    >
      <Text style={styles.createBtnText}>＋ Créer</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: spacing.md, backgroundColor: colors.bg },
  listContent: { paddingBottom: 90 },
  hint: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, marginBottom: spacing.sm, lineHeight: lineHeights.bodySmall, fontFamily: fonts.regular },
  actionError: { backgroundColor: colors.dangerSoft, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  actionErrorText: { color: colors.danger, fontSize: fontSizes.body, fontFamily: fonts.medium },
  offerCard: { marginBottom: spacing.sm },
  offerTop: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  offerTitle: { fontSize: fontSizes.heading, fontWeight: "800", color: colors.ink, marginTop: 8, fontFamily: fonts.extraBold, lineHeight: lineHeights.heading },
  offerDesc: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, marginTop: 4, fontFamily: fonts.regular },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: spacing.sm },
  priceStrong: { fontSize: fontSizes.title, fontWeight: "800", color: colors.brand, fontFamily: fonts.extraBold },
  priceStrike: { fontSize: fontSizes.body, color: colors.inkMuted, textDecorationLine: "line-through", fontFamily: fonts.regular },
  priceOff: { fontSize: fontSizes.bodySmall, color: colors.ink, backgroundColor: colors.accentSoft, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.full, fontFamily: fonts.semiBold },
  offerMeta: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, marginTop: 4, fontFamily: fonts.regular },
  offerActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  offerButton: { flex: 1 },
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
