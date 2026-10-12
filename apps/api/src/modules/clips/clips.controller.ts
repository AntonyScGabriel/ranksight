import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { DAILY_PER_GAME, SubmitClipInput, UploadUrlInput } from "@ranksight/shared";
import { CurrentUser, type AuthUser } from "../../common/decorators/current-user.decorator.js";
import { Premium } from "../../common/decorators/roles.decorator.js";
import { ZodPipe } from "../../common/pipes/zod.pipe.js";
import { ClipsService, noClipAvailable } from "./clips.service.js";
import { SubmissionsService } from "./submissions.service.js";

@Controller("play")
export class PlayController {
  constructor(private readonly clips: ClipsService) {}

  /** GET /v1/play/daily — « Défis du jour » : les jeux, leurs 3 défis et l'état de chacun pour le joueur */
  @Get("daily")
  daily(@CurrentUser() user: AuthUser) {
    return this.clips.dailyOverview(user.sub);
  }

  /**
   * GET /v1/play/daily/:game?slot=2 — clip d'un défi du jour (sans le rang) + jeton de partie ; sans `slot`, le premier
   * défi pas encore joué ; 409 si déjà joué
   */
  @Get("daily/:game")
  dailyGame(@CurrentUser() user: AuthUser, @Param("game") game: string, @Query("slot") slot?: string) {
    const n = slot === undefined ? undefined : Number(slot);
    if (n !== undefined && !(Number.isInteger(n) && n >= 1 && n <= DAILY_PER_GAME)) {
      throw new BadRequestException(`Numéro de défi invalide (1 à ${DAILY_PER_GAME}).`);
    }
    return this.clips.dailyForGame(user.sub, game, n);
  }

  /** POST /v1/play/infinite/runs — démarre une partie infinie */
  @Post("infinite/runs")
  startRun(@CurrentUser() user: AuthUser) {
    return this.clips.startRun(user.sub);
  }

  /** GET /v1/play/infinite/runs/:runId/next?game=valorant */
  @Get("infinite/runs/:runId/next")
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  next(@CurrentUser() user: AuthUser, @Param("runId", ParseUUIDPipe) runId: string, @Query("game") game?: string) {
    return this.clips.nextInfinite(user.sub, runId, game);
  }

  /** Modes exclusifs Premium (V1.0) : aucun contenu publié pour l'instant */
  @Premium()
  @Get("exclusive/:mode/next")
  exclusive() {
    throw noClipAvailable();
  }
}

/** Clips proposés par les joueurs */
@Controller("clips")
export class SubmissionsController {
  constructor(private readonly submissions: SubmissionsService) {}

  /** POST /v1/clips/upload-url — { contentType, sizeBytes } → URL d'envoi signée (10 min) */
  @Post("upload-url")
  @Throttle({ default: { ttl: 3_600_000, limit: 20 } })
  uploadUrl(@CurrentUser() user: AuthUser, @Body(new ZodPipe(UploadUrlInput)) body: UploadUrlInput) {
    return this.submissions.uploadUrl(user.sub, body);
  }

  /** POST /v1/clips — propose un clip ; il part en file de validation */
  @Post()
  @Throttle({ default: { ttl: 3_600_000, limit: 10 } })
  submit(@CurrentUser() user: AuthUser, @Body(new ZodPipe(SubmitClipInput)) body: SubmitClipInput) {
    return this.submissions.submit(user.sub, body);
  }

  /** GET /v1/clips/mine — "Mes clips" avec statut En attente / Accepté / Refusé */
  @Get("mine")
  mine(@CurrentUser() user: AuthUser) {
    return this.submissions.mine(user.sub);
  }

  /** DELETE /v1/clips/mine/:id — supprime un de ses clips (en attente, accepté ou refusé) */
  @Delete("mine/:id")
  @HttpCode(204)
  withdraw(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.submissions.withdraw(user.sub, id);
  }
}
