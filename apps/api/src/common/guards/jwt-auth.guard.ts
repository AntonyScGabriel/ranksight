import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Redis } from "ioredis";
import { REDIS } from "../../redis/redis.module.js";
import { revokedKey } from "../../modules/auth/token.service.js";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import { IS_PUBLIC } from "../decorators/public.decorator.js";
import type { AuthUser } from "../decorators/current-user.decorator.js";

/** Guard global : toute route est protégée sauf @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly jwt: JwtService, @Inject(REDIS) private readonly redis: Redis) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // WebSocket : l'authentification est faite à la connexion par chaque gateway
    if (ctx.getType() !== "http") return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = this.extract(req);

    if (!token) {
      if (isPublic) return true;
      throw new UnauthorizedException("Jeton manquant");
    }
    try {
      const user = await this.jwt.verifyAsync<AuthUser & { iat: number }>(token, { algorithms: ["HS256"] });
      // Compte supprimé, banni ou mot de passe réinitialisé : les jetons émis avant sont refusés
      const revokedAt = await this.redis.get(revokedKey(user.sub));
      if (revokedAt && user.iat < Math.floor(Number(revokedAt) / 1000)) throw new Error("revoked");
      req.user = user;
      return true;
    } catch {
      if (isPublic) return true;
      throw new UnauthorizedException("Jeton invalide ou expiré");
    }
  }

  private extract(req: Request): string | undefined {
    const [type, value] = req.headers.authorization?.split(" ") ?? [];
    if (type === "Bearer" && value) return value;
    return req.cookies?.["rs_access"]; // web : cookie httpOnly
  }
}
