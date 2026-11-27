import { createHash, randomBytes } from "node:crypto";
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, createParamDecorator } from "@nestjs/common";
import type { Request } from "express";
import { PrismaService } from "../../prisma/prisma.service.js";

/** Seule permission accordée aujourd'hui : lecture des clips autorisés à la promotion et déclaration de leurs utilisations */
export const PROMO_SCOPE = "promo:read";
const PREFIX = "rsk_";
const LAST_USED_EVERY_MS = 60_000;

export interface ServiceTokenContext {
  id: string;
  name: string;
}

export function newServiceToken(): { token: string; hash: string; prefix: string } {
  const token = PREFIX + randomBytes(32).toString("base64url");
  return { token, hash: hashServiceToken(token), prefix: token.slice(0, 10) };
}

export function hashServiceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Accès machine aux routes /v1/promo : jeton de service (rsk_…) non révoqué, avec la permission promo:read.
 * Indépendant des comptes : un jeton de joueur ou d'administrateur est refusé ici, et un jeton de service n'ouvre aucune
 * autre route (il n'est pas un JWT).
 */
@Injectable()
export class ServiceTokenGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { serviceToken?: ServiceTokenContext }>();
    const [type, value] = req.headers.authorization?.split(" ") ?? [];
    if (type !== "Bearer" || !value?.startsWith(PREFIX) || value.length > 100) {
      throw new UnauthorizedException("Jeton de service manquant ou invalide");
    }
    const token = await this.prisma.serviceToken.findUnique({ where: { tokenHash: hashServiceToken(value) } });
    if (!token || token.revokedAt || !token.scopes.includes(PROMO_SCOPE)) {
      throw new UnauthorizedException("Jeton de service invalide ou révoqué");
    }
    if (!token.lastUsedAt || Date.now() - token.lastUsedAt.getTime() > LAST_USED_EVERY_MS) {
      await this.prisma.serviceToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } });
    }
    req.serviceToken = { id: token.id, name: token.name };
    return true;
  }
}

export const CurrentServiceToken = createParamDecorator((_: unknown, ctx: ExecutionContext): ServiceTokenContext => {
  return ctx.switchToHttp().getRequest().serviceToken;
});
