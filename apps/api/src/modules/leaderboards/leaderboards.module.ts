import { BadRequestException, ConflictException, Body, Controller, DefaultValuePipe, Delete, Get, HttpCode, Module, Param, ParseIntPipe, Patch, Post, Query } from "@nestjs/common";
import { ContributorsPeriod, LeaderboardGame, LeaderboardPeriod, LeaderboardScope, SeasonInput, SeasonKey } from "@ranksight/shared";
import type { z } from "zod";
import { AuditService } from "../../common/audit/audit.module.js";
import { CurrentUser, type AuthUser } from "../../common/decorators/current-user.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { AchievementsModule } from "../achievements/achievements.module.js";
import { ZodPipe } from "../../common/pipes/zod.pipe.js";
import { FriendsModule } from "../friends/friends.module.js";
import { LeaderboardsGateway } from "./leaderboards.gateway.js";
import { LeaderboardsService } from "./leaderboards.service.js";
import { SeasonsService } from "./seasons.service.js";

@Controller("leaderboards")
export class LeaderboardsController {
  constructor(private readonly lb: LeaderboardsService, private readonly seasonsService: SeasonsService) {}

  /**
   * GET /v1/leaderboards?period=daily|weekly|season|all_time|infinite&scope=global|friends
   *   &game=all|lol|valorant|rocket-league|cs2&season=saison-1&limit=50&offset=0
   * `season` (facultatif) : saison passée à afficher ; par défaut, la saison en cours.
   */
  @Get()
  get(
    @CurrentUser() user: AuthUser,
    @Query("period", new ZodPipe(LeaderboardPeriod.default("daily"))) period: LeaderboardPeriod,
    @Query("scope", new ZodPipe(LeaderboardScope.default("global"))) scope: LeaderboardScope,
    @Query("game", new ZodPipe(LeaderboardGame.default("all"))) game: LeaderboardGame,
    @Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query("offset", new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query("season", new ZodPipe(SeasonKey.optional())) season?: string,
  ) {
    return this.lb.get({ period, scope, game, season, userId: user.sub, limit: Math.min(Math.max(limit, 1), 100), offset: Math.max(offset, 0) });
  }

  /**
   * GET /v1/leaderboards/contributors?season=<clé>|all&scope=global|friends — joueurs qui ont fait accepter
   * le plus de clips (par défaut : saison en cours). Le premier de chaque saison reçoit un titre à la clôture.
   */
  @Get("contributors")
  contributors(
    @CurrentUser() user: AuthUser,
    @Query("season", new ZodPipe(ContributorsPeriod.optional())) season: string | undefined,
    @Query("scope", new ZodPipe(LeaderboardScope.default("global"))) scope: LeaderboardScope,
    @Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query("offset", new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    return this.lb.contributors({
      // Par défaut la saison en cours ; entre deux saisons, depuis le lancement
      period: season ?? this.seasonsService.keyAt() ?? "all",
      scope,
      userId: user.sub,
      limit: Math.min(Math.max(limit, 1), 100),
      offset: Math.max(offset, 0),
    });
  }

  /** GET /v1/leaderboards/seasons — saisons de la plus récente à la plus ancienne (saisons à venir comprises) */
  @Get("seasons")
  seasons() {
    return this.lb.seasons();
  }

  /** GET /v1/leaderboards/keys?game=all — clés à suivre en temps réel (WebSocket /ws/leaderboards) */
  @Get("keys")
  keys(@Query("game", new ZodPipe(LeaderboardGame.default("all"))) game: LeaderboardGame) {
    const now = new Date();
    return {
      daily: this.lb.key("daily", now, game),
      weekly: this.lb.key("weekly", now, game),
      season: this.lb.key("season", now, game),
      all_time: this.lb.key("all_time", now, game),
      infinite: this.lb.key("infinite", now, game),
    };
  }
}

/** Administration des saisons (consultation : modérateur ; clôture : administrateur) */
@Controller("admin/seasons")
@Roles("MODERATOR")
export class SeasonsAdminController {
  constructor(private readonly lb: LeaderboardsService, private readonly seasons: SeasonsService, private readonly audit: AuditService) {}

  /** GET /v1/admin/seasons — saisons, statut, nombre de joueurs et top 10 */
  @Get()
  list() {
    return this.lb.adminSeasons();
  }

  /** POST /v1/admin/seasons — { name, number, startsAt, endsAt, rewardsEnabled, rewards } : nouvelle saison */
  @Roles("ADMIN")
  @Post()
  create(@CurrentUser() actor: AuthUser, @Body(new ZodPipe(SeasonInput)) body: z.output<typeof SeasonInput>) {
    return this.seasons.create(actor.sub, body);
  }

  /** PATCH /v1/admin/seasons/:season — modification (dates figées selon l'avancement de la saison) */
  @Roles("ADMIN")
  @Patch(":season")
  update(
    @CurrentUser() actor: AuthUser,
    @Param("season", new ZodPipe(SeasonKey)) season: string,
    @Body(new ZodPipe(SeasonInput)) body: z.output<typeof SeasonInput>,
  ) {
    return this.seasons.update(actor.sub, season, body);
  }

  /** DELETE /v1/admin/seasons/:season — suppression d'une saison qui n'a pas commencé */
  @Roles("ADMIN")
  @Delete(":season")
  @HttpCode(204)
  remove(@CurrentUser() actor: AuthUser, @Param("season", new ZodPipe(SeasonKey)) season: string) {
    return this.seasons.remove(actor.sub, season);
  }

  /** POST /v1/admin/seasons/:season/close — clôture manuelle (normalement automatique, chaque heure, après la fin) */
  @Roles("ADMIN")
  @Post(":season/close")
  @HttpCode(200)
  async close(@CurrentUser() actor: AuthUser, @Param("season", new ZodPipe(SeasonKey)) season: string) {
    try {
      const result = await this.lb.closeSeason(season);
      await this.audit.log(actor.sub, "season.close", "season", season, result);
      return result;
    } catch (e) {
      if (e instanceof ConflictException) throw e;
      throw new BadRequestException((e as Error).message);
    }
  }
}

@Module({
  imports: [FriendsModule, AchievementsModule],
  controllers: [LeaderboardsController, SeasonsAdminController],
  providers: [LeaderboardsService, LeaderboardsGateway, SeasonsService],
  exports: [LeaderboardsService, SeasonsService],
})
export class LeaderboardsModule {}
