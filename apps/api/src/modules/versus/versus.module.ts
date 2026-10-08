import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CreateVersusInput } from "@ranksight/shared";
import type { z } from "zod";
import { CurrentUser, type AuthUser } from "../../common/decorators/current-user.decorator.js";
import { ZodPipe } from "../../common/pipes/zod.pipe.js";
import { AchievementsModule } from "../achievements/achievements.module.js";
import { ChatModule } from "../chat/chat.module.js";
import { ClipsModule } from "../clips/clips.module.js";
import { VersusService } from "./versus.service.js";

@Controller("versus")
export class VersusController {
  constructor(private readonly versus: VersusService) {}

  /** GET /v1/versus — mes duels (invitations, en cours, terminés) et mon bilan */
  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.versus.list(u.sub);
  }

  /** POST /v1/versus — { opponent: "random" | idAmi, game: "all" | slug } */
  @Post()
  @Throttle({ default: { ttl: 3_600_000, limit: 40 } })
  create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(CreateVersusInput)) body: z.output<typeof CreateVersusInput>) {
    return this.versus.create(u.sub, body.opponent, body.game);
  }

  @Get(":id")
  detail(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.versus.detail(u.sub, id);
  }

  /** GET /v1/versus/:id/next — clip de la manche en cours (sans le rang) + jeton de partie, pendant le chrono */
  @Get(":id/next")
  next(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.versus.next(u.sub, id);
  }

  /** POST /v1/versus/:id/wait — l'auteur d'une recherche ou d'une invitation est toujours là (toutes les 15 s) */
  @Post(":id/wait")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  wait(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.versus.wait(u.sub, id);
  }

  /** POST /v1/versus/:id/forfeit — abandon en cours de duel (victoire de l'adversaire) */
  @Post(":id/forfeit")
  @HttpCode(204)
  forfeit(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.versus.forfeit(u.sub, id);
  }

  @Post(":id/accept")
  @HttpCode(200)
  accept(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.versus.accept(u.sub, id);
  }

  @Post(":id/decline")
  @HttpCode(204)
  decline(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.versus.decline(u.sub, id);
  }

  @Delete(":id")
  @HttpCode(204)
  cancel(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.versus.cancel(u.sub, id);
  }
}

@Module({
  imports: [ClipsModule, ChatModule, AchievementsModule],
  controllers: [VersusController],
  providers: [VersusService],
  exports: [VersusService],
})
export class VersusModule {}
