import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { Redis } from "ioredis";
import { createHash } from "node:crypto";
import { decrypt, encrypt } from "../../common/crypto.js";
import { AuditService } from "../../common/audit/audit.module.js";
import { env } from "../../config/env.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { REDIS } from "../../redis/redis.module.js";
import { MailService } from "../mail/mail.service.js";
import { newTotpSecret, otpauthUri, recoveryCodes, TOTP_PERIOD, verifyTotp } from "./totp.js";
import { assertCanManage } from "../../common/staff-policy.js";

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
/** Une fois le code saisi, l'administration reste déverrouillée 12 heures pour cette session */
const STEP_UP_TTL_SEC = 12 * 3600;
const SETUP_TTL_SEC = 15 * 60;
const MAX_ATTEMPTS = 5;

export const mfaOkKey = (sid: string) => `mfa:ok:${sid}`;

/**
 * Double authentification (application d'authentification, codes à 6 chiffres) des comptes de l'équipe.
 * Exigée pour l'administration en production (ADMIN_REQUIRE_2FA) : un code est demandé une fois par session et par 12 heures.
 */
@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Double authentification exigée pour les routes de l'administration ? */
  static required() {
    const v = env().ADMIN_REQUIRE_2FA;
    return v === "true" || (v === "auto" && env().NODE_ENV === "production");
  }

  async status(userId: string, sid?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { totpEnabledAt: true, totpRecovery: true } });
    return {
      enabled: !!user.totpEnabledAt,
      enabledAt: user.totpEnabledAt?.toISOString() ?? null,
      recoveryCodesLeft: user.totpRecovery.length,
      required: MfaService.required(),
      unlocked: !!sid && !!(await this.redis.get(mfaOkKey(sid))),
    };
  }

  /** Étape 1 : nouveau secret (en attente de confirmation par un premier code) */
  async setup(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { totpEnabledAt: true, email: true, username: true } });
    if (user.totpEnabledAt) throw new BadRequestException("La double authentification est déjà activée.");
    const secret = newTotpSecret();
    await this.redis.set(`mfa:setup:${userId}`, encrypt(secret), "EX", SETUP_TTL_SEC);
    return { secret, uri: otpauthUri(secret, user.email ?? user.username) };
  }

  /** Étape 2 : le premier code valide active la double authentification ; les codes de secours sont montrés une seule fois */
  async enable(userId: string, code: string, sid?: string) {
    const pending = await this.redis.get(`mfa:setup:${userId}`);
    if (!pending) throw new BadRequestException("Configuration expirée : recommence.");
    const secret = decrypt(pending);
    await this.checkAttempts(userId);
    if (verifyTotp(secret, code) === null) {
      await this.failed(userId);
      throw new BadRequestException({ code: "INVALID_CODE", message: "Code incorrect. Vérifie l'heure de ton téléphone et réessaie." });
    }
    const codes = recoveryCodes();
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: encrypt(secret), totpEnabledAt: new Date(), totpRecovery: codes.map((c) => sha256(c.toUpperCase())) },
      select: { email: true, displayName: true },
    });
    await this.redis.del(`mfa:setup:${userId}`);
    if (sid) await this.redis.set(mfaOkKey(sid), "1", "EX", STEP_UP_TTL_SEC);
    await this.audit.log(userId, "mfa.enable", "user", userId);
    await this.notify(user, "La double authentification a été activée sur ton compte RankGuess.");
    return { recoveryCodes: codes };
  }

  /** Code demandé pour déverrouiller l'administration (code à 6 chiffres ou code de secours) */
  async verify(userId: string, sid: string | undefined, code: string) {
    if (!sid) throw new ForbiddenException("Session invalide : reconnecte-toi.");
    await this.assertCode(userId, code);
    await this.redis.set(mfaOkKey(sid), "1", "EX", STEP_UP_TTL_SEC);
    return { unlocked: true };
  }

  async disable(userId: string, code: string) {
    await this.assertCode(userId, code);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: null, totpEnabledAt: null, totpRecovery: [] },
      select: { email: true, displayName: true },
    });
    await this.audit.log(userId, "mfa.disable", "user", userId);
    await this.notify(user, "La double authentification a été désactivée sur ton compte RankGuess.");
  }

  /** Téléphone perdu : un administrateur retire la double authentification d'un membre de l'équipe */
  async reset(actorId: string, userId: string) {
    await assertCanManage(this.prisma, actorId, userId);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: null, totpEnabledAt: null, totpRecovery: [] },
      select: { email: true, displayName: true },
    });
    await this.audit.log(actorId, "mfa.reset", "user", userId);
    await this.notify(user, "La double authentification de ton compte RankGuess a été réinitialisée par un administrateur.");
  }

  private async assertCode(userId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { totpSecret: true, totpRecovery: true } });
    if (!user.totpSecret) throw new BadRequestException({ code: "MFA_NOT_ENABLED", message: "La double authentification n'est pas activée." });
    await this.checkAttempts(userId);

    if (/^\d{6}$/.test(code)) {
      const counter = verifyTotp(decrypt(user.totpSecret), code);
      // Un code déjà utilisé ne peut pas resservir (vol par-dessus l'épaule, interception)
      if (counter !== null && (await this.redis.set(`mfa:used:${userId}:${counter}`, "1", "EX", TOTP_PERIOD * 3, "NX"))) {
        await this.redis.del(`mfa:fail:${userId}`);
        return;
      }
    } else {
      const hash = sha256(code.toUpperCase().replace(/^([A-Z0-9]{4})([A-Z0-9]{4})$/, "$1-$2"));
      if (user.totpRecovery.includes(hash)) {
        await this.prisma.user.update({ where: { id: userId }, data: { totpRecovery: user.totpRecovery.filter((h) => h !== hash) } });
        await this.redis.del(`mfa:fail:${userId}`);
        await this.audit.log(userId, "mfa.recovery_code", "user", userId);
        return;
      }
    }
    await this.failed(userId);
    throw new BadRequestException({ code: "INVALID_CODE", message: "Code incorrect." });
  }

  private async checkAttempts(userId: string) {
    const fails = Number(await this.redis.get(`mfa:fail:${userId}`));
    if (fails >= MAX_ATTEMPTS) {
      throw new HttpException({ code: "TOO_MANY_ATTEMPTS", message: "Trop de codes incorrects. Réessaie dans 15 minutes." }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async failed(userId: string) {
    await this.redis.multi().incr(`mfa:fail:${userId}`).expire(`mfa:fail:${userId}`, 900).exec();
  }

  private async notify(user: { email: string | null; displayName: string }, text: string) {
    if (!user.email) return;
    await this.mail.send({
      to: user.email,
      subject: "Sécurité de ton compte RankGuess",
      text: `Bonjour ${user.displayName},\n\n${text}\n\nSi ce n'est pas toi, change ton mot de passe et contacte l'équipe.`,
      html: `<p>Bonjour ${escapeHtml(user.displayName)},</p><p>${text}</p><p>Si ce n'est pas toi, change ton mot de passe et contacte l'équipe.</p>`,
    });
  }
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
