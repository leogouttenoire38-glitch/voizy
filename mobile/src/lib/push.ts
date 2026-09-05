import { Platform } from "react-native";
import * as Device from "expo-device";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { supabase } from "./supabase";

// En-tête des notifications in-app iOS.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/** Enregistre l'appareil pour les notifications push (silencieux si impossible). */
export async function registerPushToken(userId: string): Promise<void> {
  try {
    if (!Device.isDevice) return; // simulateur : pas de push
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== "granted") {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== "granted") return;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const token = await Notifications.getExpoPushTokenAsync({
      ...(projectId ? { projectId } : {}),
    });
    const expoToken = token.data;
    if (!expoToken) return;

    const { error } = await supabase.from("push_tokens").upsert(
      { user_id: userId, expo_token: expoToken, platform: Platform.OS },
      { onConflict: "expo_token" },
    );
    if (error) console.warn("push_tokens upsert", error.message);
  } catch (err) {
    // Expo Go iOS / émulateur : push distant indisponible → on ignore.
    console.warn("registerPushToken ignoré", err);
  }
}