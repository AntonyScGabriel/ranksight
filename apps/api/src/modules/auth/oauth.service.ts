import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Redis } from "ioredis";
import { createHash, randomBytes } from "node:crypto";
import { env } from "../../config/env.js";
import { REDIS } from "../../redis/redis.module.js";

export type Provider = "google" | "discord";
export type ClientKind = "web" | "mobile";

export interface OAuthProfile {
  provider: "GOOGLE" | "DISCORD";
  providerAccountId: string;
  email: string | null;
  emailVerified: boolean;
  username: string;
  avatarUrl: string | null;
}

interface PendingAuth {
  provider: Provider;
  client: ClientKind;
  returnTo: string;
  verifier: string;
}

const STATE_TTL_SEC = 600;
const b64url = (buf: Buffer) => buf.toString("base64url");

/**
 * Flux "Authorization Code" mené entièrement par l'API, identique pour le web et le mobile :
 *   1. /auth/oauth/:provider/start  → l'API mémorise state (+ PKCE pour Google) et redirige vers le fournisseur
 *   2. le fournisseur redirige vers /auth/oauth/:provider/callback
 *   3. l'API échange le code avec son secret, puis ouvre la session (web) ou remet un code à usage unique (mobile)
 * Le client secret ne quitte jamais le serveur et une seule URL de redirection est à déclarer par fournisseur.
 */
@Injectable()
export class OAuthService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  isConfigured(provider: Provider): boolean {
    return provider === "google"
      ? !!(env().GOOGLE_CLIENT_ID && env().GOOGLE_CLIENT_SECRET)
      : !!(env().DISCORD_CLIENT_ID && env().DISCORD_CLIENT_SECRET);
  }

  callbackUrl(provider: Provider) {
    return `${env().API_PUBLIC_URL}/v1/auth/oauth/${provider}/callback`;
  }

  /**
   * Adresse de retour autorisée : une page du site ou de l'administration (web),
   * ou le lien profond de l'application (mobile). Tout le reste est refusé (anti open-redirect).
   */
  safeReturnTo(client: ClientKind, returnTo: string | undefined): string {
    if (client === "mobile") {
      if (returnTo?.startsWith(`${env().APP_SCHEME}://`)) return returnTo;
      // Expo Go en développement utilise exp://<ip>:8081/--/…
      if (env().NODE_ENV !== "production" && returnTo && /^exps?:\/\//.test(returnTo)) return returnTo;
      return `${env().APP_SCHEME}://auth/callback`;
    }
    const allowed = [env().WEB_URL, env().ADMIN_URL, ...env().CORS_ORIGINS].map((u) => new URL(u).origin);
    try {
      if (returnTo && allowed.includes(new URL(returnTo).origin)) return returnTo;
    } catch {
      // URL invalide : on retombe sur l'accueil
    }
    return `${env().WEB_URL}/`;
  }

  async authorizationUrl(provider: Provider, client: ClientKind, returnTo: string): Promise<string> {
    const state = b64url(randomBytes(24));
    const verifier = b64url(randomBytes(32));
    const pending: PendingAuth = { provider, client, returnTo, verifier };
    await this.redis.set(`oauth:state:${state}`, JSON.stringify(pending), "EX", STATE_TTL_SEC);

    if (provider === "google") {
      const params = new URLSearchParams({
        client_id: env().GOOGLE_CLIENT_ID,
        redirect_uri: this.callbackUrl("google"),
        response_type: "code",
        scope: "openid email profile",
        state,
        code_challenge: b64url(createHash("sha256").update(verifier).digest()),
        code_challenge_method: "S256",
        prompt: "select_account",
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    }
    const params = new URLSearchParams({
      client_id: env().DISCORD_CLIENT_ID,
      redirect_uri: this.callbackUrl("discord"),
      response_type: "code",
      scope: "identify email",
      state,
      prompt: "none",
    });
    return `https://discord.com/oauth2/authorize?${params}`;
  }

  /** Consomme le state (usage unique) et renvoie la demande d'origine, ou null si inconnu/expiré. */
  async consumeState(state: string | undefined): Promise<PendingAuth | null> {
    if (!state) return null;
    const raw = await this.redis.getdel(`oauth:state:${state}`);
    return raw ? (JSON.parse(raw) as PendingAuth) : null;
  }

  async exchange(provider: Provider, code: string, verifier: string): Promise<OAuthProfile> {
    return provider === "google" ? this.google(code, verifier) : this.discord(code);
  }

  /** Code court remis à l'application mobile, échangé ensuite contre les jetons (POST /auth/exchange). */
  async createLoginCode(userId: string): Promise<string> {
    const code = b64url(randomBytes(32));
    await this.redis.set(`oauth:login:${code}`, userId, "EX", 120);
    return code;
  }

  async consumeLoginCode(code: string): Promise<string | null> {
    return this.redis.getdel(`oauth:login:${code}`);
  }

  private async token(url: string, params: Record<string, string>) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(params),
    });
    if (!res.ok) throw new UnauthorizedException("Échec de l'échange OAuth");
    return (await res.json()) as { access_token: string };
  }

  private async google(code: string, verifier: string): Promise<OAuthProfile> {
    const { access_token } = await this.token("https://oauth2.googleapis.com/token", {
      grant_type: "authorization_code",
      code,
      redirect_uri: this.callbackUrl("google"),
      client_id: env().GOOGLE_CLIENT_ID,
      client_secret: env().GOOGLE_CLIENT_SECRET,
      code_verifier: verifier,
    });
    const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!res.ok) throw new UnauthorizedException("Profil Google indisponible");
    const p = (await res.json()) as { sub: string; email?: string; email_verified?: boolean; name?: string; given_name?: string; picture?: string };
    return {
      provider: "GOOGLE",
      providerAccountId: p.sub,
      email: p.email ?? null,
      emailVerified: !!p.email_verified,
      username: p.given_name ?? p.name ?? "joueur",
      avatarUrl: p.picture ?? null,
    };
  }

  private async discord(code: string): Promise<OAuthProfile> {
    const { access_token } = await this.token("https://discord.com/api/oauth2/token", {
      grant_type: "authorization_code",
      code,
      redirect_uri: this.callbackUrl("discord"),
      client_id: env().DISCORD_CLIENT_ID,
      client_secret: env().DISCORD_CLIENT_SECRET,
    });
    const res = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!res.ok) throw new UnauthorizedException("Profil Discord indisponible");
    const p = (await res.json()) as { id: string; username: string; global_name?: string | null; email?: string | null; verified?: boolean; avatar?: string | null };
    return {
      provider: "DISCORD",
      providerAccountId: p.id,
      email: p.email ?? null,
      emailVerified: !!p.verified,
      username: p.global_name ?? p.username,
      avatarUrl: p.avatar ? `https://cdn.discordapp.com/avatars/${p.id}/${p.avatar}.png?size=256` : null,
    };
  }
}
