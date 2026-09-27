import React, { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Badge, Button, Card, LoadError, Screen, ScreenHeader } from "../../components/ui";
import { PayoutBanner } from "../../components/PayoutBanner";
import { colors, fonts, fontSizes, lineHeights, radius, spacing } from "../../theme";
import { useAuth } from "../../lib/auth";
import { formatPrice } from "../../lib/format";
import { attemptLoad } from "../../lib/load";
import {
  fetchCommissionSummary,
  fetchMerchantStats,
  fetchMyMerchant,
  fetchMyPlan,
  fetchPayoutState,
  startMerchantOnboarding,
  startProSubscription,
} from "../../lib/merchant";
import type { PayoutState } from "../../lib/merchant";
import type { CommissionSummary, Merchant, MerchantPlan, MerchantStats } from "../../types";

// Statistiques du commerce : les mêmes RPC que le back-office web
// (merchant_stats, merchant_commission_summary) — aucune règle recalculée ici.
export default function StatsScreen() {
  const { session } = useAuth();
  const uid = session?.user.id;

  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [stats, setStats] = useState<MerchantStats | null>(null);
  const [summary, setSummary] = useState<CommissionSummary | null>(null);
  const [plan, setPlan] = useState<MerchantPlan | null>(null);
  const [payout, setPayout] = useState<PayoutState>("unknown");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!uid) {
      setLoading(false);
      setRetrying(false);
      return;
    }
    const res = await attemptLoad(async () => {
      const mine = await fetchMyMerchant(uid);
      if (!mine) throw new Error("no-merchant");
      const [s, c, p, payoutState] = await Promise.all([
        fetchMerchantStats(mine.id),
        fetchCommissionSummary(mine.id),
        fetchMyPlan(mine.id),
        fetchPayoutState(mine.id),
      ]);
      return { mine, s, c, p, payoutState };
    }, "Impossible de charger vos statistiques. Vérifiez votre connexion puis réessayez.");

    try {
      if (res.ok) {
        setMerchant(res.data.mine);
        setStats(res.data.s);
        setSummary(res.data.c);
        setPlan(res.data.p);
        setPayout(res.data.payoutState);
        setError(null);
      } else {
        setError(res.error);
      }
    } finally {
      setLoading(false);
      setRetrying(false);
    }
  }, [uid]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const payoutStart = async () => {
    if (!merchant) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await startMerchantOnboarding(merchant.id);
      setNotice(res.ok ? "Compte de paiement activé ✅" : res.error);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const subscribe = async () => {
    if (!merchant) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await startProSubscription(merchant.id);
      setNotice(res.ok ? "Plan Pro activé ✅ Commandes illimitées." : res.error);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const billing = summary?.billing;
  const month = summary?.current_month;

  return (
    <Screen scroll>
      <ScreenHeader title="Statistiques" subtitle={merchant?.name ?? "Mon commerce"} />

      {error ? (
        <LoadError
          message={error}
          retrying={retrying}
          onRetry={() => {
            setRetrying(true);
            void load();
          }}
        />
      ) : loading ? (
        <ActivityIndicator size="large" color={colors.brand} style={{ marginTop: 60 }} />
      ) : (
        <>
          <PayoutBanner
            state={payout}
            busy={busy}
            notice={notice}
            onStart={payout === "missing" || payout === "incomplete" ? payoutStart : undefined}
            onRetry={payout === "unknown" ? load : undefined}
          />

          <View style={styles.grid}>
            <View style={styles.gridItem}>
              <Text style={styles.statValue}>{formatPrice(stats?.revenue ?? 0)}</Text>
              <Text style={styles.statLabel}>Volume généré</Text>
            </View>
            <View style={styles.gridItem}>
              <Text style={styles.statValue}>{stats?.unique_participants ?? 0}</Text>
              <Text style={styles.statLabel}>Participants uniques</Text>
            </View>
            <View style={styles.gridItem}>
              <Text style={styles.statValue}>
                {stats?.confirmed_orders ?? 0}/{stats?.total_orders ?? 0}
              </Text>
              <Text style={styles.statLabel}>Commandes confirmées</Text>
            </View>
            <View style={styles.gridItem}>
              <Text style={styles.statValue}>{stats?.threshold_rate ?? 0} %</Text>
              <Text style={styles.statLabel}>Seuil atteint</Text>
            </View>
          </View>

          <Card style={styles.card}>
            <Text style={styles.cardTitle}>Ce mois-ci</Text>
            {month && month.transactions > 0 ? (
              <>
                <Text style={styles.line}>
                  Volume capturé : {formatPrice(month.volume)} sur {month.transactions} paiement
                  {month.transactions > 1 ? "s" : ""}
                </Text>
                <Text style={styles.line}>
                  Vous recevez : {formatPrice(month.net)} · frais Stripe estimés :{" "}
                  {formatPrice(month.fees_estimated)}
                </Text>
              </>
            ) : (
              <Text style={styles.muted}>
                Aucun paiement capturé ce mois-ci. Les paiements sont prélevés quand une commande
                atteint son seuil et que le retrait est confirmé.
              </Text>
            )}
            <Text style={styles.policy}>
              Commission Voizy sur vos ventes : 0 % — vous gardez 100 % de vos ventes, hors frais
              bancaires standards. Voizy se rémunère par abonnement, jamais sur vos transactions.
            </Text>
          </Card>

          <Card style={styles.card}>
            <View style={styles.planTop}>
              <Text style={styles.cardTitle}>
                {billing?.is_pro ? "Plan Pro" : "Plan gratuit"}
              </Text>
              <Badge
                label={billing?.is_pro ? "Actif" : "Gratuit"}
                tone={billing?.is_pro ? "brand" : "muted"}
              />
            </View>
            <Text style={styles.muted}>
              {billing?.is_pro
                ? "Commandes groupées illimitées et commerce mis en avant dans Découvrir."
                : "1 commande groupée active à la fois. Le plan Pro débloque les commandes illimitées et la mise en avant."}
            </Text>

            {billing && !billing.enabled ? (
              <Text style={styles.muted}>
                Phase pilote : la facturation n'est pas encore activée — le plan Pro est offert à
                tous les commerçants, sans limite et sans aucun paiement.
              </Text>
            ) : null}

            {billing?.enabled && !billing.is_pro ? (
              <>
                <Text style={styles.line}>
                  Plan Pro : {formatPrice(billing.pro_price_eur ?? 0)} par mois, facturé sur votre
                  carte (hors ventes).
                </Text>
                <Button
                  title="Passer au plan Pro"
                  onPress={subscribe}
                  loading={busy}
                  style={styles.planButton}
                />
              </>
            ) : null}

            {plan?.current_period_end ? (
              <Text style={styles.muted}>
                Prochaine échéance :{" "}
                {new Date(plan.current_period_end).toLocaleDateString("fr-FR", {
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })}
              </Text>
            ) : null}
          </Card>

          <View style={styles.noteBox}>
            <Text style={styles.noteText}>
              Ces chiffres viennent directement de vos commandes réelles. Un volume plus élevé
              signifie plus de voisins servis, jamais plus de commission : chez Voizy, elle reste à
              0 %.
            </Text>
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  gridItem: {
    flexGrow: 1,
    flexBasis: "45%",
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  statValue: { fontSize: fontSizes.title, fontWeight: "800", color: colors.brand, fontFamily: fonts.extraBold },
  statLabel: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, marginTop: 4, fontFamily: fonts.regular },
  card: { marginBottom: spacing.md },
  cardTitle: { fontSize: fontSizes.heading, fontWeight: "800", color: colors.ink, fontFamily: fonts.extraBold },
  planTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  line: { fontSize: fontSizes.body, color: colors.ink, marginTop: 6, lineHeight: lineHeights.body, fontFamily: fonts.medium },
  muted: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, marginTop: 6, lineHeight: lineHeights.bodySmall, fontFamily: fonts.regular },
  policy: { fontSize: fontSizes.bodySmall, color: colors.ink, marginTop: spacing.md, lineHeight: lineHeights.bodySmall, fontFamily: fonts.semiBold },
  planButton: { marginTop: spacing.md },
  noteBox: { backgroundColor: colors.brandSoft, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg },
  noteText: { fontSize: fontSizes.bodySmall, color: colors.ink, lineHeight: lineHeights.bodySmall, fontFamily: fonts.regular },
});
