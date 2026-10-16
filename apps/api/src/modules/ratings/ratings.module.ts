import { BadRequestException, Controller, Get, Module, Param, Query } from "@nestjs/common";
import { RatingScope } from "@ranksight/shared";
import { CurrentUser, type AuthUser } from "../../common/decorators/current-user.decorator.js";
import { RatingsService } from "./ratings.service.js";

@Controller("ratings")
export class RatingsController {
  constructor(private readonly ratings: RatingsService) {}

  /** GET /v1/ratings/leaderboard?scope=global|lol|valorant|rocket-league|cs2 — classement compétitif (100 premiers) */
  @Get("leaderboard")
  board(@CurrentUser() u: AuthUser, @Query("scope") raw?: string) {
    const scope = RatingScope.safeParse(raw ?? "global");
    if (!scope.success) throw new BadRequestException({ code: "INVALID_SCOPE", message: "Classement inconnu." });
    return this.ratings.board(u.sub, scope.data);
  }

  /** GET /v1/ratings/me — mes cotes (global et par jeu) et l'historique de mes 30 derniers duels classés */
  @Get("me")
  mine(@CurrentUser() u: AuthUser) {
    return this.ratings.mine(u.sub);
  }

  /** GET /v1/ratings/seasons — saison en cours, saisons archivées et mes résultats de fin de saison */
  @Get("seasons")
  seasons(@CurrentUser() u: AuthUser) {
    return this.ratings.seasons(u.sub);
  }

  /** GET /v1/ratings/seasons/:key?scope=… — classement final archivé d'une saison terminée */
  @Get("seasons/:key")
  archive(@CurrentUser() u: AuthUser, @Param("key") key: string, @Query("scope") raw?: string) {
    const scope = RatingScope.safeParse(raw ?? "global");
    if (!scope.success) throw new BadRequestException({ code: "INVALID_SCOPE", message: "Classement inconnu." });
    if (!/^[a-z0-9-]{1,32}$/.test(key)) throw new BadRequestException({ code: "INVALID_SEASON", message: "Saison inconnue." });
    return this.ratings.archive(u.sub, key, scope.data);
  }
}

@Module({
  controllers: [RatingsController],
  providers: [RatingsService],
  exports: [RatingsService],
})
export class RatingsModule {}
