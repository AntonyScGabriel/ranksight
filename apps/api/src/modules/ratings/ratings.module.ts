import { BadRequestException, Controller, Get, Module, Query } from "@nestjs/common";
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
}

@Module({
  controllers: [RatingsController],
  providers: [RatingsService],
  exports: [RatingsService],
})
export class RatingsModule {}
