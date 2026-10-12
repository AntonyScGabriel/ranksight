import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { Redis } from "ioredis";
import { REDIS } from "../../redis/redis.module.js";
import { MfaService, mfaOkKey } from "../../modules/auth/mfa.service.js";
import { Reflector } from "@nestjs/core";
import type { Role } from "../../generated/prisma/client.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { ROLES } from "../decorators/roles.decorator.js";
import type { AuthUser } from "../decorators/current-user.decorator.js";

/** Hiérarchie : OWNER (fondateur) ⊃ ADMIN ⊃ MODERATOR ⊃ REVIEWER (trieur de clips) ⊃ USER */
const LEVEL: Record<Role, number> = { USER: 0, REVIEWER: 1, MODERATOR: 2, ADMIN: 3, OWNER: 4 };

/**
 * Pour les routes protégées par rôle, le rôle est relu en base plutôt que dans le jeton :
 * une promotion ou un retrait de droits s'applique immédiatement, sans attendre l'expiration du jeton.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly prisma: PrismaService, @Inject(REDIS) private readonly redis: Redis) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES, [ctx.getHandler(), ctx.getClass()]);
    if (!required?.length || ctx.getType() !== "http") return true;
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException();
    const current = await this.prisma.user.findUnique({ where: { id: user.sub }, select: { role: true, status: true, totpEnabledAt: true } });
    if (!current || current.status !== "ACTIVE") throw new ForbiddenException();
    const min = Math.min(...required.map((r) => LEVEL[r]));
    // Réservé au fondateur : sans fondateur nommé, les administrateurs gardent l'accès (le site n'est jamais bloqué)
    const ownerFallback = min === LEVEL.OWNER && current.role === "ADMIN" && (await this.prisma.user.count({ where: { role: "OWNER" } })) === 0;
    if (LEVEL[current.role] < min && !ownerFallback) {
      throw new ForbiddenException(min === LEVEL.OWNER ? { code: "OWNER_ONLY", message: "Réservé au fondateur du site." } : "Permissions insuffisantes");
    }

    // Administration : double authentification (obligatoire en production, ou dès qu'elle est activée sur le compte).
    // Le tri des clips (avis à confirmer par la modération) n'est pas concerné.
    if (min >= LEVEL.MODERATOR && (current.totpEnabledAt || MfaService.required())) {
      if (!current.totpEnabledAt) {
        throw new ForbiddenException({ code: "MFA_SETUP_REQUIRED", message: "Active la double authentification pour accéder à l'administration." });
      }
      if (!user.sid || !(await this.redis.get(mfaOkKey(user.sid)))) {
        throw new ForbiddenException({ code: "MFA_REQUIRED", message: "Saisis le code de ton application d'authentification." });
      }
    }
    return true;
  }
}
