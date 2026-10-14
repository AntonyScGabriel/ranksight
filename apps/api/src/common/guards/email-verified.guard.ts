import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Redis } from "ioredis";
import type { Request } from "express";
import { env } from "../../config/env.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { REDIS } from "../../redis/redis.module.js";
import { ALLOW_UNVERIFIED } from "../decorators/allow-unverified.decorator.js";
import { IS_PUBLIC } from "../decorators/public.decorator.js";
import type { AuthUser } from "../decorators/current-user.decorator.js";

/** Cache des comptes confirmés (une confirmation est définitive tant que l'adresse ne change pas) */
export const verifiedKey = (userId: string) => `email:verified:${userId}`;

export const EMAIL_NOT_VERIFIED = {
  code: "EMAIL_NOT_VERIFIED",
  message: "Confirme ton adresse email pour jouer : ouvre le lien reçu par email (pense aux courriers indésirables).",
};

/**
 * Inscription par email : le compte reste bloqué tant que l'adresse n'est pas confirmée (lien reçu par email).
 * Les comptes Google ou Discord sont confirmés d'office, l'équipe n'est jamais bloquée.
 * Désactivable avec EMAIL_VERIFICATION_REQUIRED=false (développement sans serveur d'emails).
 */
@Injectable()
export class EmailVerifiedGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== "http" || env().EMAIL_VERIFICATION_REQUIRED !== "true") return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_UNVERIFIED, targets)) return true;
    const user = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>().user;
    if (!user) return true;
    if (await this.redis.get(verifiedKey(user.sub))) return true;

    const row = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { emailVerifiedAt: true, role: true, _count: { select: { oauthAccounts: true } } },
    });
    if (!row) return true; // compte introuvable : les autres contrôles répondent
    if (row.emailVerifiedAt || row._count.oauthAccounts > 0 || row.role !== "USER") {
      await this.redis.set(verifiedKey(user.sub), "1", "EX", 86_400);
      return true;
    }
    throw new ForbiddenException(EMAIL_NOT_VERIFIED);
  }
}
