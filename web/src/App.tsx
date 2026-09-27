import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { Auth } from "./Auth";
import { BuyerNotice, RoleChoice } from "./RoleChoice";
import { MerchantSetup } from "./MerchantSetup";
import { OffersPanel } from "./OffersPanel";
import { OrdersPanel } from "./OrdersPanel";
import { StatsPanel } from "./StatsPanel";
import { PayoutBanner } from "./PayoutBanner";
import { businessError, merchantOnboarding, merchantOnboardingStatus } from "./api";
import { humanError } from "./errors";
import type { Merchant, PayoutState, UserRole } from "./types";

// ---------------------------------------------------------------------------
// Shell : une session, un rôle, un commerce. La même logique que l'app mobile —
// un compte a UN rôle actif (voisin ou commerçant).
// ---------------------------------------------------------------------------
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        setSession(data.session);
      } catch (err) {
        // Jamais d'écran de chargement bloqué : on retombe sur la connexion,
        // avec un vrai message plutôt qu'un indicateur muet.
        setSessionError(humanError(err instanceof Error ? err.message : "", "Connexion impossible. Réessayez."));
      } finally {
        setLoading(false);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (loading) return <div className="center">Chargement…</div>;

  if (!session) {
    return (
      <>
        {sessionError ? (
          <p className="error" role="alert" style={{ margin: 16 }}>
            {sessionError}
          </p>
        ) : null}
        {/* La session est portée par Supabase : onAuthStateChange bascule
            automatiquement vers l'espace commerçant après connexion. */}
        <Auth onSignedIn={() => undefined} />
      </>
    );
  }

  return <MerchantSpace />;
}

// ---------------------------------------------------------------------------
// Espace connecté : rôle → commerce → tableau de bord
// ---------------------------------------------------------------------------
type Tab = "offers" | "orders" | "stats";

function MerchantSpace() {
  const [role, setRole] = useState<UserRole | null | "loading">("loading");
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [merchantLoaded, setMerchantLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [payout, setPayout] = useState<PayoutState>("unknown");
  const [payBusy, setPayBusy] = useState(false);
  const [payNotice, setPayNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("offers");

  const load = useCallback(async () => {
    // reloadKey sert de clé de rechargement volontaire (bouton Réessayer,
    // retour du parcours Stripe) : le referencer évite une dépendance inutile.
    void reloadKey;
    setError(null);
    setMerchantLoaded(false);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData.session?.user.id;
      if (!uid) return;

      const { data: profile, error: profileErr } = await supabase
        .from("users")
        .select("role")
        .eq("id", uid)
        .maybeSingle();
      if (profileErr) throw profileErr;

      const myRole = (profile?.role as UserRole | null) ?? null;
      setRole(myRole);

      if (myRole === "merchant") {
        const { data: merchantRow, error: merchantErr } = await supabase
          .from("merchants")
          .select("*")
          .eq("manager_id", uid)
          .maybeSingle();
        if (merchantErr) throw merchantErr;
        const mine = (merchantRow as Merchant | null) ?? null;
        setMerchant(mine);

        if (mine) {
          try {
            const status = await merchantOnboardingStatus(mine.id);
            setPayout(
              !status.ok
                ? "unknown"
                : status.ready || status.merchant_status === "active"
                  ? "ready"
                  : status.has_account
                    ? "incomplete"
                    : "missing",
            );
          } catch {
            setPayout("unknown");
          }
        }
      }
    } catch (err) {
      setError(
        businessError(err, "Impossible de charger votre espace commerçant. Vérifiez votre connexion puis réessayez."),
      );
    } finally {
      setMerchantLoaded(true);
    }
  }, [reloadKey]);

  useEffect(() => {
    load();
  }, [load]);

  const startPayouts = async () => {
    if (!merchant) return;
    setPayBusy(true);
    setPayNotice(null);
    try {
      const res = await merchantOnboarding(merchant.id, window.location.origin + "/");
      if (res.ok && res.url) {
        window.open(res.url, "_blank", "noopener");
        setPayNotice(
          "Stripe vient de s'ouvrir dans un nouvel onglet. Revenez ici une fois le parcours terminé, puis rechargez la page : vos paiements seront vérifiés automatiquement.",
        );
      } else {
        setPayNotice(res.error ?? "Impossible de créer le lien de paiement. Réessayez.");
      }
    } catch (err) {
      setPayNotice(businessError(err, "Impossible de créer le lien de paiement. Réessayez."));
    } finally {
      setPayBusy(false);
    }
  };

  const signOut = () => {
    void supabase.auth.signOut();
  };

  if (error) {
    return (
      <div className="login">
        <div className="card login-card">
          <h1 className="logo">VOIZY</h1>
          <p className="error" role="alert">
            {error}
          </p>
          <button className="secondary" onClick={() => setReloadKey((k) => k + 1)}>
            Réessayer
          </button>
          <button className="ghost" onClick={signOut}>
            Se déconnecter
          </button>
        </div>
      </div>
    );
  }

  if (role === "loading" || (role === "merchant" && !merchantLoaded)) {
    return <div className="center">Chargement…</div>;
  }

  if (!role) {
    return <RoleChoice onDone={() => setReloadKey((k) => k + 1)} />;
  }

  if (role === "buyer") {
    return <BuyerNotice onSignOut={signOut} />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="logo small">VOIZY</span>
        <span className="topbar-title">{merchant ? merchant.name : "Back-office commerçant"}</span>
        <button className="ghost" onClick={signOut}>
          Se déconnecter
        </button>
      </header>

      <main className="content">
        {!merchant ? (
          <MerchantSetup onDone={() => setReloadKey((k) => k + 1)} />
        ) : (
          <>
            <PayoutBanner
              state={payout}
              busy={payBusy}
              notice={payNotice}
              onStart={payout === "missing" || payout === "incomplete" ? startPayouts : undefined}
              onRetry={() => setReloadKey((k) => k + 1)}
            />

            <div className="tabs" role="tablist">
              <button
                className={tab === "offers" ? "tab active" : "tab"}
                onClick={() => setTab("offers")}
                role="tab"
                aria-selected={tab === "offers"}
              >
                Mes offres
              </button>
              <button
                className={tab === "orders" ? "tab active" : "tab"}
                onClick={() => setTab("orders")}
                role="tab"
                aria-selected={tab === "orders"}
              >
                Commandes
              </button>
              <button
                className={tab === "stats" ? "tab active" : "tab"}
                onClick={() => setTab("stats")}
                role="tab"
                aria-selected={tab === "stats"}
              >
                Statistiques
              </button>
            </div>

            {tab === "offers" ? <OffersPanel merchant={merchant} /> : null}
            {tab === "orders" ? <OrdersPanel merchant={merchant} /> : null}
            {tab === "stats" ? <StatsPanel merchant={merchant} /> : null}
          </>
        )}
      </main>
    </div>
  );
}
