import React, { useEffect } from "react";
import { Redirect, Tabs } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { colors, fontSizes, fonts } from "../../theme";
import { useAuth } from "../../lib/auth";
import { registerPushToken } from "../../lib/push";

function TabIcon({ glyph, active }: { glyph: string; active: boolean }) {
  return (
    <View style={[styles.iconWrap, active && styles.iconWrapActive]}>
      <Text style={styles.iconText}>{glyph}</Text>
    </View>
  );
}

export default function TabsLayout() {
  const { status, session, profile } = useAuth();

  useEffect(() => {
    if (session?.user.id) registerPushToken(session.user.id);
  }, [session?.user.id]);

  if (status === "loading") {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  if (!session) return <Redirect href="/sign-in" />;
  if (profile && !profile.lat) return <Redirect href="/onboarding" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarLabelStyle: { fontSize: fontSizes.caption, fontFamily: fonts.semiBold },
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
      }}
    >
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
    </Tabs>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  iconWrap: { opacity: 0.45 },
  iconWrapActive: { opacity: 1 },
  iconText: { fontSize: 19 },
});