import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Role } from "../../generated/prisma/client.js";

/** Contenu du JWT d'accès, attaché à `req.user` par JwtAuthGuard. */
export interface AuthUser {
  sub: string;
  role: Role;
  premium: boolean;
  /** Session (famille de jetons de renouvellement) : sert à la double authentification de l'administration */
  sid?: string;
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser | undefined => {
  return ctx.switchToHttp().getRequest().user;
});
