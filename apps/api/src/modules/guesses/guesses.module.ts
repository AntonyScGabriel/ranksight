import { Body, Controller, DefaultValuePipe, Get, Module, ParseIntPipe, Post, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { SubmitGuessInput } from "@ranksight/shared";
import { CurrentUser, type AuthUser } from "../../common/decorators/current-user.decorator.js";
import { ZodPipe } from "../../common/pipes/zod.pipe.js";
import { ClipsModule } from "../clips/clips.module.js";
import { LeaderboardsModule } from "../leaderboards/leaderboards.module.js";
import { AchievementsModule } from "../achievements/achievements.module.js";
import { GuessesService } from "./guesses.service.js";
import { GuessStatsService } from "./guess-stats.service.js";
import { VersusModule } from "../versus/versus.module.js";
import { RoomsModule } from "../rooms/rooms.module.js";
import { TokensModule } from "../tokens/tokens.module.js";

@Controller("guesses")
export class GuessesController {
  constructor(private readonly guesses: GuessesService) {}

  /**
   * POST /v1/guesses — { playToken, rankId, watchedMs } → résultat, score, XP, succès.
   * Limite par adresse IP : un salon de 8 amis sur la même box envoie jusqu'à 8 réponses toutes les dizaines de secondes.
   * Chaque réponse exige de toute façon un jeton de partie à usage unique délivré par le serveur.
   */
  @Post()
  @Throttle({ default: { ttl: 60_000, limit: 90 } })
  submit(@CurrentUser() user: AuthUser, @Body(new ZodPipe(SubmitGuessInput)) body: SubmitGuessInput) {
    return this.guesses.submit(user.sub, body);
  }

  /** GET /v1/guesses/me?limit=20&cursor=… — historique (30 j en gratuit, complet en Premium) */
  @Get("me")
  history(
    @CurrentUser() user: AuthUser,
    @Query("limit", new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query("cursor") cursor?: string,
  ) {
    return this.guesses.history(user.sub, { limit, cursor, premium: user.premium });
  }
}

@Module({
  imports: [ClipsModule, LeaderboardsModule, AchievementsModule, VersusModule, RoomsModule, TokensModule],
  controllers: [GuessesController],
  providers: [GuessesService, GuessStatsService],
})
export class GuessesModule {}
