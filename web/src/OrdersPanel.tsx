import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { confirmPickup } from "./api";
import { humanError } from "./errors";
import type { Merchant, OrderRow, ParticipationRow } from "./types";

const fmtEuro = (v: number | null | undefined) => `${Number(v ?? 0).toFixed(2).replace(".", ",")} €`;
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Commandes du commerce — les retraits à confirmer d'abord. */
export function OrdersPanel({ merchant }: { merchant: Merchant }) {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error: err } = await supabase
        .from("group_orders")
        .select("*")
        .eq("merchant_id", merchant.id)
        .order("pickup_at", { ascending: false })
        .limit(100);
      if (err) throw err;
      setOrders((data as OrderRow[]) ?? []);
      setError(null);
    } catch (err) {
      setError(humanError(err instanceof Error ? err.message : "", "Impossible de charger vos commandes."));
    } finally {
      setLoading(false);
    }
  }, [merchant.id]);

  useEffect(() => {
    load();
  }, [load]);

  // Les commandes à traiter d'abord (retrait à confirmer), puis en cours, puis l'historique.
  const rank = (s: string) => (s === "confirmed" ? 0 : s === "open" ? 1 : 2);
  const sorted = [...orders].sort((a, b) => rank(a.status) - rank(b.status));

  const upcoming = sorted.filter((o) => o.status === "confirmed");
  const open = sorted.filter((o) => o.status === "open");
  const history = sorted.filter((o) => o.status === "completed" || o.status === "cancelled");

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

  return (
    <div>
      <h2>À confirmer — retraits</h2>
      {upcoming.length === 0 ? (
        <p className="muted">Aucune commande confirmée en attente de retrait.</p>
      ) : (
        upcoming.map((o) => <OrderRowView key={o.id} order={o} onDone={load} />)
      )}

      {open.length > 0 ? (
        <>
          <h2>Commandes en cours</h2>
          {open.map((o) => (
            <div className="card row" key={o.id}>
              <div>
                <strong>{o.title}</strong>
                <p className="muted">
                  {o.participants_current}/{o.threshold} participants · retrait {fmtWhen(o.pickup_at)}
                  {o.participants_current < o.threshold
                    ? ` · ${o.threshold - o.participants_current} participant${
                        o.threshold - o.participants_current > 1 ? "s" : ""
                      } manquant${o.threshold - o.participants_current > 1 ? "s" : ""}`
                    : ""}
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
                  {fmtWhen(o.pickup_at)} · {o.status === "completed" ? "terminée" : "annulée (seuil non atteint)"}
                </p>
              </div>
            </div>
          ))}
        </>
      ) : null}

      {orders.length === 0 ? (
        <div className="card">
          <p>
            <strong>Aucune commande pour l'instant.</strong>
          </p>
          <p className="muted">
            Dès qu'un voisin lance une commande sur l'une de vos offres, elle apparaît ici — avec le
            seuil à atteindre et sa date de retrait.
          </p>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Commande confirmée : participants + confirmation de retrait (cases no-show)
// ---------------------------------------------------------------------------
function OrderRowView({ order, onDone }: { order: OrderRow; onDone: () => void }) {
  const [participations, setParticipations] = useState<ParticipationRow[]>([]);
  const [noShows, setNoShows] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const loadParts = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("participations")
      .select("*")
      .eq("group_order_id", order.id)
      .eq("status", "paid");
    if (err) {
      setError(humanError(err.message, "Impossible de charger les participants."));
      return;
    }
    setParticipations((data as ParticipationRow[]) ?? []);
  }, [order.id]);

  useEffect(() => {
    if (open) void loadParts();
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
      if (!res.ok) {
        setError(res.error ?? "La confirmation n'a pas abouti. Réessayez.");
        return;
      }
      setOpen(false);
      onDone();
    } catch (err) {
      setError(humanError(err instanceof Error ? err.message : "", "Impossible de confirmer le retrait."));
    } finally {
      setBusy(false);
    }
  };

  const remaining = participations.filter((p) => !noShows.has(p.id)).length;

  return (
    <div className="card order">
      <button className="order-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <div>
          <strong>{order.title}</strong>
          <p className="muted">
            Retrait {fmtWhen(order.pickup_at)} · {order.pickup_location} ·{" "}
            {order.participants_current}/{order.threshold} participants
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
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
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
