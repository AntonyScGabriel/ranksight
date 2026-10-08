import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { createSign } from "node:crypto";
import { env } from "../../config/env.js";

/** Achat d'un produit ponctuel tel que renvoyé par l'API Google Play Developer (purchases.products.get) */
export interface GoogleProductPurchase {
  /** 0 = acheté, 1 = annulé, 2 = en attente (paiement en espèces, virement…) */
  purchaseState: 0 | 1 | 2;
  /** 0 = pas encore consommé, 1 = consommé */
  consumptionState: 0 | 1;
  orderId?: string;
  /** Présent uniquement pour un achat de test (0) ou promotionnel (1) */
  purchaseType?: number;
  obfuscatedExternalAccountId?: string;
  quantity?: number;
  purchaseTimeMillis?: string;
}

export interface GoogleVoidedPurchase {
  purchaseToken: string;
  orderId?: string;
  voidedTimeMillis: string;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri: string;
}

const SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url");

/** Erreur renvoyée par Google : 404/410 = jeton d'achat inconnu, autre = problème de configuration ou de réseau */
export class GooglePlayError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/**
 * Accès à l'API Google Play Developer par HTTP, authentifié par un compte de service (JWT signé RS256, sans bibliothèque).
 * Sert à vérifier un achat fait dans l'application, à le consommer (il peut alors être racheté) et à lister les remboursements.
 */
@Injectable()
export class GooglePlayService {
  private readonly logger = new Logger(GooglePlayService.name);
  private token: { value: string; expiresAt: number } | null = null;
  private account: ServiceAccount | null = null;

  get enabled() {
    return !!env().GOOGLE_PLAY_SERVICE_ACCOUNT && !!env().GOOGLE_PLAY_PACKAGE_NAME;
  }

  getProductPurchase(productId: string, purchaseToken: string) {
    return this.call<GoogleProductPurchase>("GET", `/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`);
  }

  /** Consomme l'achat : Google le considère comme livré (sinon il est remboursé au bout de 3 jours) et le pass peut être racheté. */
  async consume(productId: string, purchaseToken: string) {
    await this.call("POST", `/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:consume`);
  }

  /** Achats remboursés, annulés ou contestés depuis `since` (Google conserve 30 jours d'historique). */
  async voidedSince(since: Date): Promise<GoogleVoidedPurchase[]> {
    const all: GoogleVoidedPurchase[] = [];
    let page: string | undefined;
    do {
      const q = new URLSearchParams({ startTime: String(since.getTime()), type: "0", maxResults: "1000" });
      if (page) q.set("token", page);
      const r = await this.call<{ voidedPurchases?: GoogleVoidedPurchase[]; tokenPagination?: { nextPageToken?: string } }>(
        "GET",
        `/purchases/voidedpurchases?${q}`,
      );
      all.push(...(r.voidedPurchases ?? []));
      page = r.tokenPagination?.nextPageToken;
    } while (page);
    return all;
  }

  private async call<T = unknown>(method: "GET" | "POST", path: string): Promise<T> {
    if (!this.enabled) throw new ServiceUnavailableException("Les achats Google Play ne sont pas configurés.");
    const url = `${env().GOOGLE_PLAY_API_URL}/androidpublisher/v3/applications/${encodeURIComponent(env().GOOGLE_PLAY_PACKAGE_NAME)}${path}`;
    const res = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${await this.accessToken()}` },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) {
      if (res.status === 401) this.token = null;
      let message = text.slice(0, 300);
      try {
        message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? message;
      } catch {
        // réponse non JSON : on garde le texte brut
      }
      if (res.status !== 404 && res.status !== 410) this.logger.error(`Google Play ${method} ${path.split("/tokens/")[0]} : ${res.status} ${message}`);
      throw new GooglePlayError(res.status, message);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  /** Jeton d'accès OAuth du compte de service, gardé en mémoire jusqu'à une minute avant son expiration. */
  private async accessToken() {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const sa = this.serviceAccount();
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
      JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: sa.token_uri, iat: now, exp: now + 3600 }),
    )}`;
    const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key);
    const res = await fetch(sa.token_uri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(signature)}` }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
    if (!res.ok || !body.access_token) {
      this.logger.error(`Authentification Google refusée : ${body.error_description ?? res.status}`);
      throw new ServiceUnavailableException("Vérification de l'achat momentanément indisponible, réessaie plus tard.");
    }
    this.token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  private serviceAccount(): ServiceAccount {
    if (this.account) return this.account;
    const raw = env().GOOGLE_PLAY_SERVICE_ACCOUNT.trim();
    try {
      const json = JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8")) as Partial<ServiceAccount>;
      if (!json.client_email || !json.private_key) throw new Error("champs client_email ou private_key absents");
      this.account = { client_email: json.client_email, private_key: json.private_key, token_uri: json.token_uri ?? "https://oauth2.googleapis.com/token" };
      return this.account;
    } catch (e) {
      this.logger.error(`GOOGLE_PLAY_SERVICE_ACCOUNT illisible : ${(e as Error).message}`);
      throw new ServiceUnavailableException("Vérification de l'achat momentanément indisponible, réessaie plus tard.");
    }
  }
}
