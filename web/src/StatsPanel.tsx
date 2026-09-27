import { useCallback, useEffect, useState } from "react";
import {
  businessError,
  fetchCommissionSummary,
  fetchMerchantStats,
  fetchMyPlan,
  merchantSubscribe,
} from "./api";
import { humanError } from "./errors";
import type { CommissionSummary, Merchant, MerchantPlan, MerchantStats } from "./types";

const fmtEuro = (v: number | null | undefined) => `${Number(v ?? 0).toFixed(2).replace(".", ",")} €`;

/** Statistiques du commerce : mêmes RPC (merchant_stats, merchant_commission_summary). */
export function StatsPanel({ merchant }: { merchant: Merchant }) {
  const [stats, setStats] = useState<MerchantStats | null>(null);
  const [summary, setSummary] = useState<CommissionSummary | null>(null);
  const [plan, setPlan] = useState<MerchantPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, c, p] = await Promise.all([
        fetchMerchantStats(merchant.id),
        fetchCommissionSummary(merchant.id),
        fetchMyPlan(merchant.id),
      ]);
      setStats(s as MerchantStats);
      setSummary(c as CommissionSummary);
      setPlan(p as MerchantPlan | null);
      setError(null);
    } catch (err) {
      setError(
        businessError(
          err,
          "Impossible de charger vos statistiques. Vérifiez votre connexion puis réessayez.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [merchant.id]);

  useEffect(() => {
    load();
  }, [load]);

  const subscribe = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await merchantSubscribe(merchant.id, window.location.href);
      if (res.ok && res.url) window.location.href = res.url;
      else setNotice(res.error ?? "Impossible de démarrer l'abonnement. Réessayez.");
    } catch (err) {
      setNotice(humanError(err instanceof Error ? err.message : "", "Impossible de démarrer l'abonnement."));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="muted">Chargement…</p>;

  if (error) {
    return (
      <div className="card">
        <p className="error" role="alert">
          {error}
        </p>
        <button className="secondary" onClick={load}>
          Réessayer
        </button>
      </div>
    );
  }

  const billing = summary?.billing;
  const month = summary?.current_month;

  return (
    <div>
      <div className="stats">
        <div className="stat">
          <span className="stat-value">{fmtEuro(stats?.revenue ?? 0)}</span>
          <span className="stat-label">Volume généré</span>
        </div>
        <div className="stat">
          <span className="stat-value">{stats?.unique_participants ?? 0}</span>
          <span className="stat-label">Participants uniques</span>
        </div>
        <div className="stat">
          <span className="stat-value">
            {stats?.confirmed_orders ?? 0}/{stats?.total_orders ?? 0}
          </span>
          <span className="stat-label">Commandes confirmées</span>
        </div>
        <div className="stat">
          <span className="stat-value">{stats?.threshold_rate ?? 0} %</span>
          <span className="stat-label">Seuil atteint</span>
        </div>
      </div>

      <div className="card">
        <p>
          <strong>Ce mois-ci</strong>
          {month && month.transactions > 0
            ? ` · volume ${fmtEuro(month.volume)} sur ${month.transactions} paiement${
                month.transactions > 1 ? "s" : ""
              } · vous recevez ${fmtEuro(month.net)} · frais Stripe estimés ${fmtEuro(
                month.fees_estimated,
              )}`
            : ""}
        </p>
        {!month || month.transactions === 0 ? (
          <p className="muted small">
            Aucun paiement capturé ce mois-ci. Les paiements sont prélevés quand une commande
            atteint son seuil et que le retrait est confirmé.
          </p>
        ) : null}
        <p className="muted small">
          Commission Voizy sur vos ventes : 0 % — vous gardez 100 % de vos ventes, hors frais
          bancaires standards. Voizy se rémunère par abonnement, jamais sur vos transactions.
        </p>
      </div>

      <div className="card">
        <p>
          <strong>{billing?.is_pro ? "Plan Pro" : "Plan gratuit"}</strong> —{" "}
          {billing?.is_pro
            ? "commandes groupées illimitées et commerce mis en avant dans Découvrir."
            : "1 commande groupée active à la fois."}
        </p>
        {billing && !billing.enabled ? (
          <p className="muted small">
            Phase pilote : la facturation n'est pas encore activée — le plan Pro est offert à tous
            les commerçants, sans limite et sans aucun paiement.
          </p>
        ) : null}
        {billing?.enabled && !billing.is_pro ? (
          <>
            <p className="muted small">
              Plan Pro : {fmtEuro(billing.pro_price_eur ?? 0)} par mois, facturé sur votre carte
              (hors ventes).
            </p>
            <button className="primary" onClick={subscribe} disabled={busy}>
              {busy ? "Ouverture…" : "Passer au plan Pro ↗"}
            </button>
          </>
        ) : null}
        {plan?.current_period_end ? (
          <p className="muted small">
            Prochaine échéance :{" "}
            {new Date(plan.current_period_end).toLocaleDateString("fr-FR", {
              day: "2-digit",
              month: "long",
              year: "numeric",
            })}
          </p>
        ) : null}
        {notice ? (
          <p className="error" role="alert">
            {notice}
          </p>
        ) : null}
      </div>
    </div>
  );
}
