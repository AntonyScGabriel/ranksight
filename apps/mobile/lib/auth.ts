import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { API, api } from "./api";

WebBrowser.maybeCompleteAuthSession();

export type AuthResult = { status: "success" | "cancelled" } | { status: "error"; reason: string };

/**
 * Connexion Google ou Discord : la page de connexion s'ouvre dans le navigateur du téléphone,
 * l'API mène l'échange OAuth puis revient vers l'application avec un code à usage unique,
 * que l'application échange contre ses jetons. Aucun secret n'est embarqué dans l'application.
 */
export async function signIn(provider: "google" | "discord"): Promise<AuthResult> {
  const returnTo = Linking.createURL("auth/callback");
  const start = `${API}/auth/oauth/${provider}/start?client=mobile&returnTo=${encodeURIComponent(returnTo)}`;
  const result = await WebBrowser.openAuthSessionAsync(start, returnTo);
  if (result.type !== "success") return { status: "cancelled" };

  const { queryParams } = Linking.parse(result.url);
  const code = typeof queryParams?.code === "string" ? queryParams.code : null;
  if (!code) {
    const reason = typeof queryParams?.auth_error === "string" ? queryParams.auth_error : "failed";
    return reason === "cancelled" ? { status: "cancelled" } : { status: "error", reason };
  }
  await api.exchange(code);
  return { status: "success" };
}
