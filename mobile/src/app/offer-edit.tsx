import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { LoadError, Screen } from "../components/ui";
import { OfferForm } from "../components/OfferForm";
import { colors } from "../theme";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { attemptLoad } from "../lib/load";
import { fetchMyMerchant } from "../lib/merchant";
import type { Merchant, Offer } from "../types";

// Modifier une offre : on charge l'offre et le commerce du compte, puis le
// même formulaire que la création (règles validées côté base).
export default function OfferEditScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const uid = session?.user.id;

  const [offer, setOffer] = useState<Offer | null>(null);
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    if (!uid || !id) {
      setLoading(false);
      setRetrying(false);
      return;
    }
    const res = await attemptLoad(async () => {
      const [offerRes, mine] = await Promise.all([
        supabase.from("offers").select("*").eq("id", id).maybeSingle(),
        fetchMyMerchant(uid),
      ]);
      if (offerRes.error) throw offerRes.error;
      return { offer: (offerRes.data as Offer | null) ?? null, mine };
    }, "Impossible de charger cette offre. Vérifiez votre connexion puis réessayez.");

    try {
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (!res.data.offer) {
        setError("Cette offre n'existe plus.");
        return;
      }
      // Sécurité : une offre ne se modifie que depuis le commerce qui la porte.
      if (!res.data.mine || res.data.mine.id !== res.data.offer.merchant_id) {
        setError("Cette offre n'appartient pas à votre commerce.");
        return;
      }
      setOffer(res.data.offer);
      setMerchant(res.data.mine);
      setError(null);
    } finally {
      setLoading(false);
      setRetrying(false);
    }
  }, [uid, id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  if (error || !offer || !merchant) {
    return (
      <Screen>
        <LoadError
          message={error ?? "Cette offre n'est pas disponible."}
          retrying={retrying}
          onRetry={() => {
            setRetrying(true);
            void load();
          }}
        />
      </Screen>
    );
  }

  return (
    <OfferForm
      mode="update"
      merchantId={merchant.id}
      initial={offer}
      onSaved={() => router.replace("/offers")}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
});
