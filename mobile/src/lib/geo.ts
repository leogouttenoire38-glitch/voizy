import * as Location from "expo-location";

export async function requestPermission(): Promise<Location.LocationObject | null> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") return null;
  try {
    return await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  } catch {
    return null;
  }
}

export async function getLastKnown(): Promise<Location.LocationObject | null> {
  try {
    return await Location.getLastKnownPositionAsync();
  } catch {
    return null;
  }
}