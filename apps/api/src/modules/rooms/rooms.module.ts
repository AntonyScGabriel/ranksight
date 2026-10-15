import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CreateRoomInput, InviteToRoomInput, JoinRoomInput, normalizeRoomCode } from "@ranksight/shared";
import type { z } from "zod";
import { CurrentUser, type AuthUser } from "../../common/decorators/current-user.decorator.js";
import { ZodPipe } from "../../common/pipes/zod.pipe.js";
import { ChatModule } from "../chat/chat.module.js";
import { ClipsModule } from "../clips/clips.module.js";
import { RoomsService } from "./rooms.service.js";

@Controller("rooms")
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  /** GET /v1/rooms — droit de créer, salon en cours, invitations reçues, dernières parties */
  @Get()
  overview(@CurrentUser() u: AuthUser) {
    return this.rooms.overview(u.sub);
  }

  /** POST /v1/rooms — { game, rounds, roundSec } : réservé aux joueurs VIP (vérifié en base) */
  @Post()
  @Throttle({ default: { ttl: 3_600_000, limit: 20 } })
  create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(CreateRoomInput)) body: z.output<typeof CreateRoomInput>) {
    return this.rooms.create(u.sub, body);
  }

  /** GET /v1/rooms/code/:code — aperçu avant de rejoindre */
  @Get("code/:code")
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  preview(@CurrentUser() u: AuthUser, @Param("code") raw: string) {
    const code = normalizeRoomCode(raw);
    if (!code) throw new BadRequestException({ code: "INVALID_ROOM_CODE", message: "Code de salon invalide : 8 caractères, lettres et chiffres." });
    return this.rooms.preview(u.sub, code);
  }

  /**
   * POST /v1/rooms/join — { code } : gratuit pour tous les joueurs.
   * Limite par adresse IP assez large pour un groupe d'amis derrière la même box ; les codes faux sont en plus limités par joueur.
   */
  @Post("join")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  join(@CurrentUser() u: AuthUser, @Body(new ZodPipe(JoinRoomInput)) body: z.output<typeof JoinRoomInput>) {
    return this.rooms.join(u.sub, body.code);
  }

  @Get(":id")
  detail(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.rooms.detail(u.sub, id);
  }

  /** GET /v1/rooms/:id/next — clip de la manche en cours (sans le rang) et jeton de partie, pendant le chrono */
  @Get(":id/next")
  next(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.rooms.next(u.sub, id);
  }

  @Post(":id/start")
  @HttpCode(200)
  start(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.rooms.start(u.sub, id);
  }

  @Post(":id/leave")
  @HttpCode(204)
  leave(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.rooms.leave(u.sub, id);
  }

  /** POST /v1/rooms/:id/invite — { userId } : inviter un ami */
  @Post(":id/invite")
  @HttpCode(200)
  @Throttle({ default: { ttl: 3_600_000, limit: 60 } })
  invite(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(InviteToRoomInput)) body: z.output<typeof InviteToRoomInput>) {
    return this.rooms.invite(u.sub, id, body.userId);
  }

  /** DELETE /v1/rooms/:id/invite — ignorer une invitation reçue */
  @Delete(":id/invite")
  @HttpCode(204)
  declineInvite(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.rooms.declineInvite(u.sub, id);
  }

  /** POST /v1/rooms/:id/kick/:userId — l'hôte retire un joueur de la salle d'attente */
  @Post(":id/kick/:userId")
  @HttpCode(200)
  kick(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Param("userId", ParseUUIDPipe) target: string) {
    return this.rooms.kick(u.sub, id, target);
  }
}

@Module({
  imports: [ClipsModule, ChatModule],
  controllers: [RoomsController],
  providers: [RoomsService],
  exports: [RoomsService],
})
export class RoomsModule {}
