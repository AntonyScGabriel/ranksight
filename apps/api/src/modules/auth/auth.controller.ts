import { AllowUnverified } from "../../common/decorators/allow-unverified.decorator.js";
import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseEnumPipe, ParseUUIDPipe, Post, Query, Req, Res, UnauthorizedException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { CookieOptions, Request, Response } from "express";
import { z } from "zod";
import { ChangePasswordInput, Email, ForgotPasswordInput, LoginInput, ResetPasswordInput, SignupInput, TotpCodeInput } from "@ranksight/shared";
import { Public } from "../../common/decorators/public.decorator.js";
import { CurrentUser, type AuthUser } from "../../common/decorators/current-user.decorator.js";
import { ZodPipe } from "../../common/pipes/zod.pipe.js";
import { env } from "../../config/env.js";
import { AuthService, EmailInUseError } from "./auth.service.js";
import { MfaService } from "./mfa.service.js";
import { OAuthService, type ClientKind } from "./oauth.service.js";
import { TokenService } from "./token.service.js";

const Client = z.enum(["web", "mobile"]).default("web");
const ExchangeBody = z.object({ code: z.string().min(20) });
const RefreshBody = z.object({ refreshToken: z.string().optional(), client: Client });
const LogoutBody = z.object({ refreshToken: z.string().optional() }).default({});
const VerifyEmailBody = z.object({ token: z.string().min(20).max(200) });
const ChangeEmailBody = z.object({ email: Email, password: z.string().min(1).max(200) });

enum ProviderParam {
  google = "google",
  discord = "discord",
}

const ACCESS_COOKIE = "rs_access";
const REFRESH_COOKIE = "rs_refresh";

function cookieBase(): CookieOptions {
  return { httpOnly: true, secure: env().NODE_ENV === "production", sameSite: "lax", path: "/" };
}
function refreshCookie(): CookieOptions {
  return { ...cookieBase(), sameSite: "strict", path: "/v1/auth" };
}

/** Connexion, session, confirmation de l'adresse email et double authentification : accessibles avant la confirmation */
@AllowUnverified()
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly oauth: OAuthService,
    private readonly tokens: TokenService,
    private readonly mfa: MfaService,
  ) {}

  /** GET /v1/auth/providers — fournisseurs configurés sur ce serveur (email + mot de passe est toujours disponible) */
  @Public()
  @Get("providers")
  providers() {
    return { google: this.oauth.isConfigured("google"), discord: this.oauth.isConfigured("discord"), password: true };
  }

  /** GET /v1/auth/oauth/:provider/start?client=web|mobile&returnTo=… → redirection vers Google ou Discord */
  @Public()
  @Get("oauth/:provider/start")
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async start(
    @Param("provider", new ParseEnumPipe(ProviderParam)) provider: ProviderParam,
    @Query("client") clientParam: string | undefined,
    @Query("returnTo") returnToParam: string | undefined,
    @Res() res: Response,
  ) {
    const client: ClientKind = clientParam === "mobile" ? "mobile" : "web";
    const returnTo = this.oauth.safeReturnTo(client, returnToParam);
    if (!this.oauth.isConfigured(provider)) return res.redirect(withParam(returnTo, "auth_error", "unavailable"));
    res.redirect(await this.oauth.authorizationUrl(provider, client, returnTo));
  }

  /** GET /v1/auth/oauth/:provider/callback — retour du fournisseur */
  @Public()
  @Get("oauth/:provider/callback")
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async callback(
    @Param("provider", new ParseEnumPipe(ProviderParam)) provider: ProviderParam,
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") providerError: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const pending = await this.oauth.consumeState(state);
    if (!pending || pending.provider !== provider) return res.redirect(withParam(`${env().WEB_URL}/login`, "auth_error", "expired"));
    if (providerError || !code) return res.redirect(withParam(pending.returnTo, "auth_error", "cancelled"));

    try {
      const profile = await this.oauth.exchange(provider, code, pending.verifier);
      const userId = await this.auth.findOrCreateUser(profile);
      if (pending.client === "mobile") {
        return res.redirect(withParam(pending.returnTo, "code", await this.oauth.createLoginCode(userId)));
      }
      const t = await this.tokens.issue(userId, this.meta(req));
      this.setCookies(res, t);
      return res.redirect(pending.returnTo);
    } catch (e) {
      const reason =
        e instanceof EmailInUseError ? "email_in_use"
        : (e as { response?: { code?: string } }).response?.code === "ACCOUNT_DISABLED" ? "disabled"
        : "failed";
      return res.redirect(withParam(pending.returnTo, "auth_error", reason));
    }
  }

  /** POST /v1/auth/exchange — l'application mobile échange son code à usage unique contre ses jetons */
  @Public()
  @Post("exchange")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async exchange(@Body(new ZodPipe(ExchangeBody)) body: z.infer<typeof ExchangeBody>, @Req() req: Request) {
    const userId = await this.oauth.consumeLoginCode(body.code);
    if (!userId) throw new UnauthorizedException({ code: "INVALID_CODE", message: "Lien de connexion expiré, réessaie." });
    return this.tokens.issue(userId, this.meta(req));
  }

  /** POST /v1/auth/signup — { pseudo, email, password, passwordConfirm, client } → compte créé et session ouverte */
  @Public()
  @Post("signup")
  @HttpCode(201)
  @Throttle({ default: { ttl: 3_600_000, limit: 20 } })
  async signup(
    @Body(new ZodPipe(SignupInput)) body: z.output<typeof SignupInput>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = await this.auth.signup(body);
    return this.openSession(userId, body.client, req, res);
  }

  /** POST /v1/auth/login — { email, password, client } */
  @Public()
  @Post("login")
  @HttpCode(200)
  @Throttle({ default: { ttl: 15 * 60_000, limit: 30 } })
  async login(
    @Body(new ZodPipe(LoginInput)) body: z.output<typeof LoginInput>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = await this.auth.login(body.email, body.password);
    return this.openSession(userId, body.client, req, res);
  }

  /** POST /v1/auth/password/forgot — { email } → email avec un lien valable 1 heure (réponse identique si l'adresse est inconnue) */
  @Public()
  @Post("password/forgot")
  @HttpCode(204)
  @Throttle({ default: { ttl: 3_600_000, limit: 5 } })
  async forgot(@Body(new ZodPipe(ForgotPasswordInput)) body: ForgotPasswordInput) {
    await this.auth.forgotPassword(body.email);
  }

  /** POST /v1/auth/password/reset — { token, password, passwordConfirm } */
  @Public()
  @Post("password/reset")
  @HttpCode(204)
  @Throttle({ default: { ttl: 3_600_000, limit: 10 } })
  async reset(@Body(new ZodPipe(ResetPasswordInput)) body: ResetPasswordInput, @Res({ passthrough: true }) res: Response) {
    await this.auth.resetPassword(body.token, body.password);
    this.clearCookies(res);
  }

  /** POST /v1/auth/password/change — { currentPassword, password, passwordConfirm } : depuis le profil ; toutes les sessions sont fermées */
  @Post("password/change")
  @HttpCode(204)
  @Throttle({ default: { ttl: 3_600_000, limit: 10 } })
  async changePassword(@CurrentUser() user: AuthUser, @Body(new ZodPipe(ChangePasswordInput)) body: ChangePasswordInput, @Res({ passthrough: true }) res: Response) {
    await this.auth.changePassword(user.sub, body.currentPassword, body.password);
    this.clearCookies(res);
  }

  @Public()
  @Post("refresh")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async refresh(
    @Body(new ZodPipe(RefreshBody)) body: z.infer<typeof RefreshBody>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = body.refreshToken ?? req.cookies?.[REFRESH_COOKIE];
    if (!token) throw new UnauthorizedException();
    try {
      const t = await this.tokens.rotate(token, this.meta(req));
      if (body.client === "mobile") return t;
      this.setCookies(res, t);
      return { expiresIn: t.expiresIn };
    } catch (e) {
      if (body.client === "web") this.clearCookies(res);
      throw e;
    }
  }

  /** POST /v1/auth/logout — fonctionne même avec un jeton d'accès expiré */
  @Public()
  @Post("logout")
  @HttpCode(204)
  async logout(
    @Req() req: Request,
    @Body(new ZodPipe(LogoutBody)) body: z.infer<typeof LogoutBody>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = body.refreshToken ?? req.cookies?.[REFRESH_COOKIE];
    if (token) await this.tokens.revoke(token);
    this.clearCookies(res);
  }

  /** POST /v1/auth/logout-all — ferme toutes les sessions du compte (tous les appareils) */
  @Post("logout-all")
  @HttpCode(204)
  async logoutAll(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    await this.tokens.revokeAll(user.sub);
    this.clearCookies(res);
  }

  /** GET /v1/auth/sessions — appareils connectés au compte (celui-ci en premier) */
  @Get("sessions")
  sessions(@CurrentUser() user: AuthUser) {
    return this.tokens.sessions(user.sub, user.sid);
  }

  /** DELETE /v1/auth/sessions/:id — déconnecte un autre appareil (celui-ci : « Se déconnecter ») */
  @Delete("sessions/:id")
  @HttpCode(204)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async revokeSession(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    if (id === user.sid) throw new BadRequestException({ code: "CURRENT_SESSION", message: "C'est l'appareil que tu utilises : utilise « Se déconnecter »." });
    if (!(await this.tokens.revokeSession(user.sub, id))) throw new NotFoundException("Appareil introuvable ou déjà déconnecté.");
  }

  // ---------- Confirmation de l'adresse email ----------

  /** POST /v1/auth/email/verify — { token } reçu par email */
  @Public()
  @Post("email/verify")
  @HttpCode(204)
  @Throttle({ default: { ttl: 3_600_000, limit: 20 } })
  async verifyEmail(@Body(new ZodPipe(VerifyEmailBody)) body: z.infer<typeof VerifyEmailBody>) {
    await this.auth.verifyEmail(body.token);
  }

  /** POST /v1/auth/email/resend — renvoie le lien de confirmation au joueur connecté */
  @Post("email/resend")
  @HttpCode(200)
  @Throttle({ default: { ttl: 3_600_000, limit: 5 } })
  resendVerification(@CurrentUser() user: AuthUser) {
    return this.auth.sendVerification(user.sub);
  }

  /**
   * POST /v1/auth/email/change — { email, password } : adresse pas encore confirmée, corrigée tout de suite et nouveau
   * lien ; adresse confirmée, remplacée une fois la nouvelle confirmée par le lien qui lui est envoyé ({ pending: true })
   */
  @Post("email/change")
  @HttpCode(200)
  @Throttle({ default: { ttl: 3_600_000, limit: 5 } })
  changeEmail(@CurrentUser() user: AuthUser, @Body(new ZodPipe(ChangeEmailBody)) body: z.infer<typeof ChangeEmailBody>) {
    return this.auth.changeUnverifiedEmail(user.sub, body.email, body.password);
  }

  // ---------- Double authentification ----------

  @Get("mfa")
  mfaStatus(@CurrentUser() user: AuthUser) {
    return this.mfa.status(user.sub, user.sid);
  }

  @Post("mfa/setup")
  @HttpCode(200)
  @Throttle({ default: { ttl: 3_600_000, limit: 10 } })
  mfaSetup(@CurrentUser() user: AuthUser) {
    return this.mfa.setup(user.sub);
  }

  @Post("mfa/enable")
  @HttpCode(200)
  @Throttle({ default: { ttl: 15 * 60_000, limit: 10 } })
  mfaEnable(@CurrentUser() user: AuthUser, @Body(new ZodPipe(TotpCodeInput)) body: TotpCodeInput) {
    return this.mfa.enable(user.sub, body.code, user.sid);
  }

  /** Déverrouille l'administration pour cette session (12 heures) */
  @Post("mfa/verify")
  @HttpCode(200)
  @Throttle({ default: { ttl: 15 * 60_000, limit: 10 } })
  mfaVerify(@CurrentUser() user: AuthUser, @Body(new ZodPipe(TotpCodeInput)) body: TotpCodeInput) {
    return this.mfa.verify(user.sub, user.sid, body.code);
  }

  @Post("mfa/disable")
  @HttpCode(204)
  @Throttle({ default: { ttl: 15 * 60_000, limit: 10 } })
  async mfaDisable(@CurrentUser() user: AuthUser, @Body(new ZodPipe(TotpCodeInput)) body: TotpCodeInput) {
    await this.mfa.disable(user.sub, body.code);
  }

  /** Web : cookies httpOnly. Mobile : jetons renvoyés dans la réponse (stockés dans le trousseau sécurisé). */
  private async openSession(userId: string, client: "web" | "mobile", req: Request, res: Response) {
    const t = await this.tokens.issue(userId, this.meta(req));
    if (client === "mobile") return t;
    this.setCookies(res, t);
    return { expiresIn: t.expiresIn };
  }

  private setCookies(res: Response, t: { accessToken: string; refreshToken: string; expiresIn: number }) {
    res.cookie(ACCESS_COOKIE, t.accessToken, { ...cookieBase(), maxAge: t.expiresIn * 1000 });
    res.cookie(REFRESH_COOKIE, t.refreshToken, { ...refreshCookie(), maxAge: env().JWT_REFRESH_TTL_DAYS * 86_400_000 });
  }

  private clearCookies(res: Response) {
    res.clearCookie(ACCESS_COOKIE, cookieBase());
    res.clearCookie(REFRESH_COOKIE, refreshCookie());
  }

  private meta(req: Request) {
    return { userAgent: sessionUserAgent(req.headers["user-agent"], req.headers["x-app-version"]), ip: req.ip };
  }
}

function withParam(url: string, key: string, value: string) {
  const u = new URL(url);
  u.searchParams.set(key, value);
  return u.toString();
}

/**
 * Appareil d'une session : navigateur ou application, suivi de la version de l'application mobile (en-tête
 * `X-App-Version`, ex. « RankGuess/0.2.0 ») quand elle est envoyée et valide. Sert seulement à repérer les versions
 * encore utilisées (liste des sessions) : aucune version n'est refusée.
 */
export function sessionUserAgent(userAgent: string | undefined, appVersion: string | string[] | undefined): string | undefined {
  const v = typeof appVersion === "string" && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(appVersion) ? appVersion : null;
  if (!v) return userAgent;
  // En tête : l'appareil est tronqué à 255 caractères à l'enregistrement
  return `RankGuess/${v}${userAgent ? ` ${userAgent}` : ""}`;
}
