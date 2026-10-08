import { BadRequestException, Controller, DefaultValuePipe, Get, HttpCode, Module, Param, ParseIntPipe, Post, Query } from "@nestjs/common";
import { LeaderboardGame, LeaderboardPeriod, LeaderboardScope, SeasonKey } from "@ranksight/shared";
import { AuditService } from "../../common/audit/audit.module.js";
import { CurrentUser, type AuthUser } from "../../common/decorators/current-user.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { AchievementsModule } from "../achievements/achievements.module.js";
import { ZodPipe } from "../../common/pipes/zod.pipe.js";
import { FriendsModule } from "../friends/friends.module.js";
import { LeaderboardsGateway } from "./leaderboards.gateway.js";
import { LeaderboardsService } from "./leaderboards.service.js";

@Controller("leaderboards")
export class LeaderboardsController {
  constructor(private readonly lb: LeaderboardsService) {}

  /**
   * GET /v1/leaderboards?period=daily|weekly|season|all_time|infinite&scope=global|friends
   *   &game=all|lol|valorant|rocket-league|cs2&season=AAAA-MM&limit=50&offset=0
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

  /** GET /v1/leaderboards/seasons — saisons de la plus récente (en cours) à la saison 1 */
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
  constructor(private readonly lb: LeaderboardsService, private readonly audit: AuditService) {}

  /** GET /v1/admin/seasons — saisons, statut, nombre de joueurs et top 10 */
  @Get()
  list() {
    return this.lb.adminSeasons();
  }

  /** POST /v1/admin/seasons/:season/close — clôture manuelle (normalement automatique chaque début de mois) */
  @Roles("ADMIN")
  @Post(":season/close")
  @HttpCode(200)
  async close(@CurrentUser() actor: AuthUser, @Param("season", new ZodPipe(SeasonKey)) season: string) {
    try {
      const result = await this.lb.closeSeason(season);
      await this.audit.log(actor.sub, "season.close", "season", season, result);
      return result;
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }
}

@Module({
  imports: [FriendsModule, AchievementsModule],
  controllers: [LeaderboardsController, SeasonsAdminController],
  providers: [LeaderboardsService, LeaderboardsGateway],
  exports: [LeaderboardsService],
})
export class LeaderboardsModule {}
