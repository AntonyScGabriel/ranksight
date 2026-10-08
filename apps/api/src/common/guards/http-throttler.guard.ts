import { ExecutionContext, Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

/**
 * Limitation de débit HTTP. Les messages WebSocket ne passent pas par ce guard :
 * leurs limites sont appliquées par les services (ex. chat global : délai et rafale par joueur dans Redis).
 */
@Injectable()
export class HttpThrottlerGuard extends ThrottlerGuard {
  override async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== "http") return true;
    return super.canActivate(ctx);
  }
}
