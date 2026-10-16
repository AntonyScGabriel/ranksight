import { BadRequestException, Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CreateTournamentInput, JoinTournamentInput, normalizeRoomCode } from "@ranksight/shared";
import type { z } from "zod";
import { CurrentUser, type AuthUser } from "../../common/decorators/current-user.decorator.js";
import { ZodPipe } from "../../common/pipes/zod.pipe.js";
import { ChatModule } from "../chat/chat.module.js";
import { RoomsModule } from "../rooms/rooms.module.js";
import { TournamentsService } from "./tournaments.service.js";

@Controller("tournaments")
export class TournamentsController {
  constructor(private readonly tournaments: TournamentsService) {}

  /** GET /v1/tournaments — droit de créer, tournois en cours, derniers tournois */
  @Get()
  overview(@CurrentUser() u: AuthUser) {
    return this.tournaments.overview(u.sub);
  }

  /** POST /v1/tournaments — { game, capacity, rounds, roundSec } : réservé aux joueurs VIP (vérifié en base) */
  @Post()
  @Throttle({ default: { ttl: 3_600_000, limit: 10 } })
  create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(CreateTournamentInput)) body: z.output<typeof CreateTournamentInput>) {
    return this.tournaments.create(u.sub, body);
  }

  /** GET /v1/tournaments/code/:code — aperçu avant de s'inscrire */
  @Get("code/:code")
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  preview(@CurrentUser() u: AuthUser, @Param("code") raw: string) {
    const code = normalizeRoomCode(raw);
    if (!code) throw new BadRequestException({ code: "INVALID_CODE", message: "Code de tournoi invalide : 8 caractères, lettres et chiffres." });
    return this.tournaments.preview(u.sub, code);
  }

  /** POST /v1/tournaments/join — { code } : inscription gratuite */
  @Post("join")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  join(@CurrentUser() u: AuthUser, @Body(new ZodPipe(JoinTournamentInput)) body: z.output<typeof JoinTournamentInput>) {
    return this.tournaments.join(u.sub, body.code);
  }

  @Get(":id")
  detail(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.tournaments.detail(u.sub, id);
  }

  @Post(":id/start")
  @HttpCode(200)
  start(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.tournaments.start(u.sub, id);
  }

  /** POST /v1/tournaments/:id/ready — « Je suis prêt » pour son match */
  @Post(":id/ready")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  ready(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.tournaments.ready(u.sub, id);
  }

  @Post(":id/leave")
  @HttpCode(204)
  leave(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.tournaments.leave(u.sub, id);
  }
}

@Module({
  imports: [RoomsModule, ChatModule],
  controllers: [TournamentsController],
  providers: [TournamentsService],
})
export class TournamentsModule {}
