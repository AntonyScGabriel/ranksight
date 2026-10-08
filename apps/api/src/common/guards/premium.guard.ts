import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PREMIUM } from "../decorators/roles.decorator.js";
import type { AuthUser } from "../decorators/current-user.decorator.js";

@Injectable()
export class PremiumGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const needsPremium = this.reflector.getAllAndOverride<boolean>(PREMIUM, [ctx.getHandler(), ctx.getClass()]);
    if (!needsPremium || ctx.getType() !== "http") return true;
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    if (user?.premium || user?.role === "ADMIN" || user?.role === "OWNER") return true;
    // 402 : le client affiche l'écran d'upgrade
    throw new HttpException({ code: "PREMIUM_REQUIRED", message: "Fonctionnalité Premium" }, HttpStatus.PAYMENT_REQUIRED);
  }
}
