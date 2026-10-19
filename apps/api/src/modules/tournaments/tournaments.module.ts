import { BadRequestException, Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CreateEventTournamentInput, CreateTournamentInput, JoinTournamentInput, normalizeRoomCode } from "@ranksight/shared";
import type { z } from "zod";
import { AuditService } from "../../common/audit/audit.module.js";
import { CurrentUser, type AuthUser } from "../../common/decorators/current-user.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
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

  /** POST /v1/tournaments/:id/claim-host — un inscrit VIP reprend l'organisation d'un tournoi resté sans organisateur */
  @Post(":id/claim-host")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  claimHost(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.tournaments.claimHost(u.sub, id);
  }

  @Post(":id/leave")
  @HttpCode(204)
  leave(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.tournaments.leave(u.sub, id);
  }
}

/** Événements (administration) : tournois visibles par tous, jusqu'à 64 places, récompense du vainqueur */
@Controller("admin/tournaments")
@Roles("ADMIN")
export class TournamentsAdminController {
  constructor(private readonly tournaments: TournamentsService, private readonly audit: AuditService) {}

  /** GET /v1/admin/tournaments — événements, les plus récents d'abord */
  @Get()
  list() {
    return this.tournaments.listEvents();
  }

  /** POST /v1/admin/tournaments — { title, game, capacity, rounds, roundSec, rewardCosmeticId?, rewardVipDays? } */
  @Post()
  async create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(CreateEventTournamentInput)) body: z.output<typeof CreateEventTournamentInput>) {
    const t = await this.tournaments.createEvent(u.sub, body);
    await this.audit.log(u.sub, "tournament.event.create", "tournament", t.id, { title: body.title, capacity: body.capacity, rewardCosmeticId: body.rewardCosmeticId ?? null, rewardVipDays: body.rewardVipDays ?? null });
    return t;
  }

  /** POST /v1/admin/tournaments/:id/start — lance l'événement (3 inscrits au moins) */
  @Post(":id/start")
  @HttpCode(200)
  async start(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    const t = await this.tournaments.start(u.sub, id, true);
    await this.audit.log(u.sub, "tournament.event.start", "tournament", id, { players: t.players.length });
    return t;
  }
}

@Module({
  imports: [RoomsModule, ChatModule],
  controllers: [TournamentsController, TournamentsAdminController],
  providers: [TournamentsService],
})
export class TournamentsModule {}
