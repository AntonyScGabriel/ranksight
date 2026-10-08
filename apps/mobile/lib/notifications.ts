import * as Device from "expo-device";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";
import { api } from "./api";

/**
 * Notifications push (défis du jour, messages d'amis).
 * Elles exigent une version installable de l'application (build EAS) : Expo Go ne les prend plus en charge
 * et le simple chargement du module y provoque une erreur sur Android. Le module n'est donc chargé
 * qu'en dehors d'Expo Go, au moment où il sert.
 */
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
export const pushAvailable = !isExpoGo && Device.isDevice && !!projectId;

let configured = false;
async function notifications() {
  const Notifications = await import("expo-notifications");
  if (!configured) {
    configured = true;
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
    });
  }
  return Notifications;
}

/** Enregistre le téléphone auprès de l'API pour recevoir les notifications. Sans effet dans Expo Go et sur simulateur. */
export async function registerForPush(): Promise<void> {
  if (!pushAvailable || !projectId) return;
  const Notifications = await notifications();
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", { name: "Notifications", importance: Notifications.AndroidImportance.DEFAULT });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") return;

  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  await api.registerPush(data, Platform.OS === "ios" ? "IOS" : "ANDROID");
}

/** Appelle `onUrl` quand le joueur touche une notification. Renvoie la fonction de désabonnement. */
export function onNotificationTap(onUrl: (url: string | null) => void): () => void {
  if (!pushAvailable) return () => {};
  let remove: (() => void) | undefined;
  let cancelled = false;
  void notifications().then((Notifications) => {
    if (cancelled) return;
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const url = response.notification.request.content.data?.url;
      onUrl(typeof url === "string" ? url : null);
    });
    remove = () => sub.remove();
  });
  return () => {
    cancelled = true;
    remove?.();
  };
}
