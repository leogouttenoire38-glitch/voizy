import React, { useCallback, useEffect, useState } from "react";
import { Redirect, Tabs } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { colors, fontSizes, fonts } from "../../theme";
import { useAuth } from "../../lib/auth";
import { registerPushToken } from "../../lib/push";
import { fetchMyMerchant } from "../../lib/merchant";
import { attemptLoad } from "../../lib/load";
import { LoadError } from "../../components/ui";
import type { Merchant } from "../../types";

function TabIcon({ glyph, active }: { glyph: string; active: boolean }) {
  return (
    <View style={[styles.iconWrap, active && styles.iconWrapActive]}>
      <Text style={styles.iconText}>{glyph}</Text>
    </View>
  );
}

const tabOptions = {
  headerShown: false,
  tabBarActiveTintColor: colors.brand,
  tabBarInactiveTintColor: colors.inkMuted,
  tabBarLabelStyle: { fontSize: fontSizes.caption, fontFamily: fonts.semiBold },
  tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
};

/** Routes masquées : elles existent pour le routeur mais hors de la barre. */
const HIDDEN = { href: null } as const;

export default function TabsLayout() {
  const { status, session, profile } = useAuth();
  const uid = session?.user.id ?? null;

  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [merchantLoaded, setMerchantLoaded] = useState(false);
  const [merchantError, setMerchantError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  // Enregistrement push « au mieux » : la promesse est toujours gérée (jamais
  // de rejet non capté) et jamais un écran ne dépend de son résultat.
  useEffect(() => {
    if (uid) void registerPushToken(uid).catch(() => {});
  }, [uid]);

  const loadMerchant = useCallback(async () => {
    if (!uid) return;
    // attemptLoad ne lève jamais : en cas d'échec on montre un message et
    // « Réessayer » — surtout pas une redirection vers la création du commerce,
    // qui laisserait croire à un commerçant qu'il n'a pas de commerce.
    const res = await attemptLoad(
      () => fetchMyMerchant(uid),
      "Impossible de charger votre commerce. Vérifiez votre connexion puis réessayez.",
    );
    if (res.ok) {
      setMerchant(res.data);
      setMerchantError(null);
    } else {
      setMerchantError(res.error);
    }
    setMerchantLoaded(true);
    setRetrying(false);
  }, [uid]);

  useEffect(() => {
    if (profile?.role !== "merchant" || !uid) return;
    setMerchantLoaded(false);
    void loadMerchant();
  }, [profile?.role, uid, loadMerchant]);

  if (status === "loading") {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  if (!session) return <Redirect href="/sign-in" />;
  // Rôle pas encore choisi : l'écran « Vous êtes plutôt… » prend le relais.
  if (!profile?.role) return <Redirect href="/role" />;

  // ---------------------------------------------------------------- commerçant
  if (profile.role === "merchant") {
    if (!merchantLoaded) {
      return (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      );
    }
    if (merchantError) {
      return (
        <View style={styles.loading}>
          <LoadError
            message={merchantError}
            retrying={retrying}
            onRetry={() => {
              setRetrying(true);
              void loadMerchant();
            }}
          />
        </View>
      );
    }
    if (!merchant) return <Redirect href="/merchant-signup" />;

    return (
      <Tabs screenOptions={tabOptions}>
        <Tabs.Screen
          name="offers"
          options={{
            title: "Mes offres",
            tabBarIcon: ({ color }) => <TabIcon glyph="🏪" active={color === colors.brand} />,
          }}
        />
        <Tabs.Screen
          name="merchant-orders"
          options={{
            title: "Commandes",
            tabBarIcon: ({ color }) => <TabIcon glyph="📦" active={color === colors.brand} />,
          }}
        />
        <Tabs.Screen
          name="stats"
          options={{
            title: "Statistiques",
            tabBarIcon: ({ color }) => <TabIcon glyph="📈" active={color === colors.brand} />,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: "Profil",
            tabBarIcon: ({ color }) => <TabIcon glyph="👤" active={color === colors.brand} />,
          }}
        />
        {/* Onglets acheteur hors barre pour un compte commerçant. */}
        <Tabs.Screen name="index" options={HIDDEN} />
        <Tabs.Screen name="orders" options={HIDDEN} />
        <Tabs.Screen name="notifications" options={HIDDEN} />
      </Tabs>
    );
  }

  // ------------------------------------------------------------------- voisin
  if (!profile.lat) return <Redirect href="/onboarding" />;

  return (
    <Tabs screenOptions={tabOptions}>
      <Tabs.Screen
        name="index"
        options={{
          title: "Découvrir",
          tabBarIcon: ({ color }) => <TabIcon glyph="🧺" active={color === colors.brand} />,
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: "Mes commandes",
          tabBarIcon: ({ color }) => <TabIcon glyph="📦" active={color === colors.brand} />,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: "Notifications",
          tabBarIcon: ({ color }) => <TabIcon glyph="🔔" active={color === colors.brand} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profil",
          tabBarIcon: ({ color }) => <TabIcon glyph="👤" active={color === colors.brand} />,
        }}
      />
      {/* Onglets commerçant hors barre pour un compte voisin. */}
      <Tabs.Screen name="offers" options={HIDDEN} />
      <Tabs.Screen name="merchant-orders" options={HIDDEN} />
      <Tabs.Screen name="stats" options={HIDDEN} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", padding: 24 },
  iconWrap: { opacity: 0.45 },
  iconWrapActive: { opacity: 1 },
  iconText: { fontSize: 19 },
});
