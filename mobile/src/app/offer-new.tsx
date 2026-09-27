import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { LoadError, Screen } from "../components/ui";
import { OfferForm } from "../components/OfferForm";
import { colors } from "../theme";
import { useAuth } from "../lib/auth";
import { attemptLoad } from "../lib/load";
import { fetchMyMerchant } from "../lib/merchant";
import type { Merchant } from "../types";

// Publier une offre : on résout d'abord le commerce du compte (jamais de
// formulaire ouvert sans savoir où l'offre sera publiée), puis le formulaire.
export default function OfferNewScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const uid = session?.user.id;

  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const load = React.useCallback(async () => {
    if (!uid) {
      setLoading(false);
      setRetrying(false);
      return;
    }
    const res = await attemptLoad(
      () => fetchMyMerchant(uid),
      "Impossible de retrouver votre commerce. Vérifiez votre connexion puis réessayez.",
    );
    try {
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setMerchant(res.data);
      setError(null);
    } finally {
      setLoading(false);
      setRetrying(false);
    }
  }, [uid]);

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

  if (error || !merchant) {
    return (
      <Screen>
        <LoadError
          message={error ?? "Aucun commerce n'est rattaché à ce compte."}
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
      mode="create"
      merchantId={merchant.id}
      onSaved={() => {
        // Retour au catalogue : la nouvelle offre y apparaît (rechargé au focus).
        router.replace("/offers");
      }}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
});
