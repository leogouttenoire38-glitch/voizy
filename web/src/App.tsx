import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";
import { confirmPickup, merchantOnboarding } from "./api";
import type { Session } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Types (miroir du schéma)
// ---------------------------------------------------------------------------
interface Merchant {
  id: string;
  name: string;
  address: string;
  status: string;
  stripe_account_id: string | null;
  commission_rate: number;
}

interface OrderRow {
  id: string;
  status: string;
  title: string;
  participants_current: number;
  threshold: number;
  pickup_at: string;
  pickup_location: string;
  share_token: string;
  created_at: string;
}

interface ParticipationRow {
  id: string;
  user_id: string;
  status: string;
  amount: number;
  deposit_amount: number;
  deposit_status: string;
}

interface MerchantStats {
  total_orders: number;
  confirmed_orders: number;
  cancelled_orders: number;
  open_orders: number;
  threshold_rate: number;
  revenue: number;
  unique_participants: number;
  avg_fill: number;
}

interface CommissionSummary {
  current_month: {
    volume: number;
    commission: number;
    fees_estimated: number;
    net: number;
    transactions: number;
  };
}

const fmtEuro = (v: number) => `${v.toFixed(2).replace(".", ",")} €`;
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Messages d'erreur en langage humain (miroir de mobile/src/lib/errors.ts). */
function humanError(message: string | null | undefined, fallback: string): string {
  const m = (message ?? "").toLowerCase();
  if (!m) return fallback;
  if (/invalid login credentials|invalid email or password/i.test(m))
    return "E-mail ou mot de passe incorrect. Vérifiez puis réessayez.";
  if (/email.*not.*confirm|confirm.*email|otp.*expired|expired token/i.test(m))
    return "Le code n'est plus valide. Demandez un nouveau code.";
  if (/invalid.*otp|invalid token|token has expired|code.*invalid/i.test(m))
    return "Le code n'est pas valide. Vérifiez-le puis réessayez.";
  if (/password.*(too short|weak)|at least 6/i.test(m))
    return "Le mot de passe doit contenir au moins 6 caractères.";
  if (/email.*not.*valid|invalid email/i.test(m))
    return "Cette adresse e-mail ne semble pas valide. Vérifiez-la.";
  if (/rate.limit|too many requests|over.*request/i.test(m))
    return "Trop de demandes. Attendez un peu puis réessayez.";
  if (/network|fetch|offline|failed to fetch/i.test(m))
    return "Problème de connexion. Vérifiez votre réseau puis réessayez.";
  if (/user.*not found/i.test(m))
    return "Aucun compte trouvé avec cet e-mail. Créez un compte pour commencer.";
  return message ?? fallback;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (loading) return <div className="center">Chargement…</div>;
  if (!session) return <Login onDone={() => {}} />;
  return <Dashboard />;
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) setError(humanError(err.message, "Impossible de vous connecter. Réessayez."));
    else onDone();
  };

  const magicLink = async () => {
    if (!email) return setError("Renseignez d'abord votre e-mail.");
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({ email });
    setBusy(false);
    if (err) setError(humanError(err.message, "Impossible d'envoyer le code. Réessayez."));
    else setNotice("Code envoyé par e-mail ✉️");
  };

  return (
    <div className="login">
      <div className="card login-card">
        <h1 className="logo">VOIZY</h1>
        <p className="tagline">Back-office commerçant</p>
        <div className="field-group">
          <label className="field-label" htmlFor="login-email">E-mail</label>
          <input
            id="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="login-password">Mot de passe</label>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        {error ? <p className="error" role="alert">{error}</p> : null}
        {notice ? <p className="notice">{notice}</p> : null}
        <button className="primary" onClick={signIn} disabled={busy}>
          {busy ? "…" : "Se connecter"}
        </button>
        <button className="ghost" onClick={magicLink} disabled={busy}>
          Recevoir un code par e-mail
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
function Dashboard() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("merchants").select("*").order("name");
      const list = (data ?? []) as Merchant[];
      setMerchants(list);
      setMerchantId((prev) => prev ?? list[0]?.id ?? null);
    })();
  }, []);

  // En phase concierge, la colonne manager_id n'est pas encore renseignée pour
  // tous les commerces : on affiche l'ensemble des partenaires pour faciliter
  // le test (à restreindre à manager_id = uid en production).
  const myMerchants = useMemo(() => merchants, [merchants]);

  const selected = myMerchants.find((m) => m.id === merchantId) ?? null;

  return (
    <div className="app">
      <header className="topbar">
        <span className="logo small">VOIZY</span>
        <span className="topbar-title">Back-office commerçant</span>
        <button className="ghost" onClick={() => supabase.auth.signOut()}>
          Se déconnecter
        </button>
      </header>

      <main className="content">
        {myMerchants.length > 0 ? (
          <>
            <div className="tabs">
              {myMerchants.map((m) => (
                <button
                  key={m.id}
                  className={m.id === merchantId ? "tab active" : "tab"}
                  onClick={() => setMerchantId(m.id)}
                >
                  {m.name}
                </button>
              ))}
            </div>
            {selected ? (
              <MerchantPanel merchant={selected} refreshKey={refreshKey} onChanged={() => setRefreshKey((k) => k + 1)} />
            ) : null}
          </>
        ) : (
          <div className="card">
            <p>
              Aucun commerçant n'est rattaché à votre compte. En phase concierge, l'équipe Voizy
              relie votre compte à votre commerce (colonne <code>manager_id</code> de la table{" "}
              <code>merchants</code>).
            </p>
            <p className="muted">Compte de démo : commercant@voizy.test / voizy-demo</p>
          </div>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Merchant panel : onboarding + stats + commandes
// ---------------------------------------------------------------------------
function MerchantPanel({ merchant, refreshKey, onChanged }: { merchant: Merchant; refreshKey: number; onChanged: () => void }) {
  const [stats, setStats] = useState<MerchantStats | null>(null);
  const [comm, setComm] = useState<CommissionSummary | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onboardingBusy, setOnboardingBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [statsRes, ordersRes, commRes] = await Promise.all([
      supabase.rpc("merchant_stats", { p_merchant_id: merchant.id }),
      supabase
        .from("group_orders")
        .select("*")
        .eq("merchant_id", merchant.id)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.rpc("merchant_commission_summary", { p_merchant_id: merchant.id }),
    ]);
    if (!statsRes.error) setStats((statsRes.data as MerchantStats | null) ?? null);
    if (!commRes.error) setComm((commRes.data as CommissionSummary | null) ?? null);
    if (ordersRes.error) setError(humanError(ordersRes.error.message, "Impossible de charger les commandes."));
    else setOrders((ordersRes.data as OrderRow[]) ?? []);
    setLoading(false);
  }, [merchant.id]);

  useEffect(() => {
    load();
  }, [load, merchant.id, refreshKey]);

  const startOnboarding = async () => {
    setOnboardingBusy(true);
    setError(null);
    try {
      const res = await merchantOnboarding(merchant.id, `${window.location.origin}/concierge`);
      if (res.ok && res.url) {
        window.open(res.url, "_blank", "noopener");
      } else {
        setError(res.error ?? "Impossible de lancer l'onboarding Stripe.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau.");
    } finally {
      setOnboardingBusy(false);
    }
  };

  const needsOnboarding = !merchant.stripe_account_id || merchant.status !== "active";
  const upcoming = orders.filter((o) => o.status === "confirmed");
  const history = orders.filter((o) => o.status === "completed" || o.status === "cancelled");
  const open = orders.filter((o) => o.status === "open");

  return (
    <div>
      {needsOnboarding ? (
        <div className="card banner">
          <p>
            <strong>Paiements non activés.</strong> Complétez l'onboarding Stripe (connexion
            sécurisée, ~5 min) pour recevoir les paiements de vos commandes groupées.
          </p>
          <button className="primary" onClick={startOnboarding} disabled={onboardingBusy}>
            {onboardingBusy ? "Création du lien…" : "Lancer l'onboarding Stripe ↗"}
          </button>
        </div>
      ) : (
        <div className="card banner ok">
          <p>✅ Paiements actifs — commission Voizy : {(merchant.commission_rate * 100).toFixed(0)} %</p>
        </div>
      )}

      {error ? <p className="error">{error}</p> : null}

      {loading ? (
        <p className="muted">Chargement…</p>
      ) : (
        <>
          {stats ? (
            <div className="stats">
              <Stat label="Volume généré" value={fmtEuro(stats.revenue ?? 0)} />
              <Stat label="Participants uniques" value={String(stats.unique_participants ?? 0)} />
              <Stat label="Commandes confirmées" value={`${stats.confirmed_orders ?? 0}/${stats.total_orders ?? 0}`} />
              <Stat label="Seuil atteint" value={`${stats.threshold_rate ?? 0} %`} />
            </div>
          ) : null}

          {comm?.current_month && comm.current_month.transactions > 0 ? (
            <div className="card">
              <p>
                <strong>Ce mois-ci</strong> · volume {fmtEuro(comm.current_month.volume)} ·{" "}
                commission Voizy {fmtEuro(comm.current_month.commission)} · frais Stripe (est.){" "}
                {fmtEuro(comm.current_month.fees_estimated)} · net commerçant{" "}
                {fmtEuro(comm.current_month.net)} (sur {comm.current_month.transactions} paiement
                {comm.current_month.transactions > 1 ? "s" : ""} capturé
                {comm.current_month.transactions > 1 ? "s" : ""})
              </p>
            </div>
          ) : null}

          <h2>À venir — retraits</h2>
          {upcoming.length === 0 ? (
            <p className="muted">Aucune commande confirmée en attente de retrait.</p>
          ) : (
            upcoming.map((o) => <OrderRowView key={o.id} order={o} onDone={onChanged} />)
          )}

          {open.length > 0 ? (
            <>
              <h2>Commandes ouvertes</h2>
              {open.map((o) => (
                <div className="card row" key={o.id}>
                  <div>
                    <strong>{o.title}</strong>
                    <p className="muted">
                      {o.participants_current}/{o.threshold} participants · retrait {fmtWhen(o.pickup_at)}
                    </p>
                  </div>
                </div>
              ))}
            </>
          ) : null}

          {history.length > 0 ? (
            <>
              <h2>Historique</h2>
              {history.map((o) => (
                <div className="card row" key={o.id}>
                  <div>
                    <strong>{o.title}</strong>
                    <p className="muted">
                      {fmtWhen(o.pickup_at)} ·{" "}
                      {o.status === "completed" ? "terminée" : "annulée (seuil non atteint)"}
                    </p>
                  </div>
                </div>
              ))}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Commande confirmée : participants + confirmation de retrait
// ---------------------------------------------------------------------------
function OrderRowView({ order, onDone }: { order: OrderRow; onDone: () => void }) {
  const [participations, setParticipations] = useState<ParticipationRow[]>([]);
  const [noShows, setNoShows] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const loadParts = useCallback(async () => {
    const { data } = await supabase
      .from("participations")
      .select("*")
      .eq("group_order_id", order.id)
      .eq("status", "paid");
    setParticipations(((data ?? []) as ParticipationRow[]).filter((p) => p.status === "paid"));
  }, [order.id]);

  useEffect(() => {
    if (open) loadParts();
  }, [open, loadParts]);

  const toggleNoShow = (id: string) => {
    setNoShows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await confirmPickup(order.id, [...noShows]);
      if (!res.ok) setError(res.error ?? "Erreur.");
      else {
        setOpen(false);
        onDone();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau.");
    } finally {
      setBusy(false);
    }
  };

  const remaining = participations.filter((p) => !noShows.has(p.id)).length;

  return (
    <div className="card order">
      <button className="order-head" onClick={() => setOpen(!open)}>
        <div>
          <strong>{order.title}</strong>
          <p className="muted">
            Retrait {fmtWhen(order.pickup_at)} · {order.pickup_location} · {order.participants_current}/
            {order.threshold} participants
          </p>
        </div>
        <span className="chevron">{open ? "▾" : "▸"}</span>
      </button>

      {open ? (
        <div className="order-body">
          {participations.length === 0 ? (
            <p className="muted">Aucun participant en attente de retrait.</p>
          ) : (
            participations.map((p) => (
              <label key={p.id} className="participant">
                <input
                  type="checkbox"
                  checked={noShows.has(p.id)}
                  onChange={() => toggleNoShow(p.id)}
                />
                <span>
                  Participant · {fmtEuro(p.amount)} + caution {fmtEuro(p.deposit_amount)}
                </span>
                <span className={noShows.has(p.id) ? "noshow" : "ok"}>
                  {noShows.has(p.id) ? "no-show (caution retenue)" : "présent ✓"}
                </span>
              </label>
            ))
          )}
          {error ? <p className="error">{error}</p> : null}
          <button
            className="primary"
            onClick={confirm}
            disabled={busy || participations.length === 0}
          >
            {busy
              ? "Confirmation…"
              : `Confirmer le retrait — ${remaining} présent${remaining > 1 ? "s" : ""}${
                  noShows.size > 0 ? `, ${noShows.size} no-show` : ""
                }`}
          </button>
          <p className="muted small">
            Les cautions des présents sont libérées immédiatement ; celles des no-show sont retenues
            (CGV Voizy).
          </p>
        </div>
      ) : null}
    </div>
  );
}