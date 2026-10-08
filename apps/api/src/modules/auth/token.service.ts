import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Redis } from "ioredis";
import { REDIS } from "../../redis/redis.module.js";
import { JwtService } from "@nestjs/jwt";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service.js";
import { env } from "../../config/env.js";
import type { AuthUser } from "../../common/decorators/current-user.decorator.js";

/** Repère « sessions fermées à telle date » : tout jeton d'accès émis avant est refusé. */
export const revokedKey = (userId: string) => `auth:revoked:${userId}`;

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/**
 * Access token : JWT HS256 court (15 min), sans état.
 * Refresh token : chaîne opaque aléatoire (256 bits), stockée hachée, rotation à chaque usage.
 * Réutilisation d'un refresh déjà consommé ⇒ vol présumé ⇒ révocation de toute la famille.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async issue(userId: string, meta: { userAgent?: string; ip?: string }, familyId: string = randomUUID()) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, role: true, status: true, subscription: { select: { status: true, currentPeriodEnd: true } } },
    });
    if (user.status !== "ACTIVE") throw new UnauthorizedException("Compte indisponible");

    const sub = user.subscription;
    const premium = !!sub && ["ACTIVE", "TRIALING"].includes(sub.status) && sub.currentPeriodEnd > new Date();
    const payload: AuthUser = { sub: user.id, role: user.role, premium, sid: familyId };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: env().JWT_ACCESS_SECRET,
      expiresIn: env().JWT_ACCESS_TTL as `${number}m`,
      algorithm: "HS256",
    });

    const refreshToken = randomBytes(32).toString("base64url");
    await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: sha256(refreshToken),
        userAgent: meta.userAgent?.slice(0, 255),
        ip: meta.ip,
        expiresAt: new Date(Date.now() + env().JWT_REFRESH_TTL_DAYS * 86_400_000),
      },
    });

    return { accessToken, refreshToken, expiresIn: 15 * 60 };
  }

  async rotate(refreshToken: string, meta: { userAgent?: string; ip?: string }) {
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (!stored || stored.expiresAt < new Date()) throw new UnauthorizedException("Session expirée");

    if (stored.revokedAt) {
      // Détection de réutilisation : on coupe toute la chaîne
      await this.prisma.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException("Session compromise, reconnexion requise");
    }

    await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
    return this.issue(stored.userId, meta, stored.familyId);
  }

  async revoke(refreshToken: string) {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Ferme toutes les sessions d'un compte : refresh tokens révoqués et jetons d'accès déjà émis refusés
   * immédiatement (repère en Redis lu par JwtAuthGuard), sans attendre leur expiration.
   */
  async revokeAll(userId: string) {
    await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.redis.set(revokedKey(userId), String(Date.now()), "EX", 86_400);
  }
}
