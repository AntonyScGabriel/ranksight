import { Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser, type AuthUser } from "../../common/decorators/current-user.decorator.js";
import { AchievementEngine } from "../achievements/achievement-engine.service.js";
import { AchievementsModule } from "../achievements/achievements.module.js";
import { FriendsService } from "./friends.service.js";

@Controller("friends")
export class FriendsController {
  constructor(private readonly friends: FriendsService, private readonly achievements: AchievementEngine) {}

  /** Succès « amis » : réévalués pour les deux joueurs dès qu'une amitié est confirmée */
  private async friendshipConfirmed(a: string, b: string) {
    await Promise.all([this.achievements.evaluate(a), this.achievements.evaluate(b)]);
  }

  /** GET /v1/friends — liste d'amis */
  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.friends.list(u.sub);
  }

  /** GET /v1/friends/search?q=pseudo — recherche de joueurs (2 caractères minimum) */
  @Get("search")
  @Throttle({ default: { ttl: 60_000, limit: 40 } })
  search(@CurrentUser() u: AuthUser, @Query("q") q = "") {
    return this.friends.search(u.sub, q);
  }

  /** GET /v1/friends/requests — demandes reçues et envoyées */
  @Get("requests")
  requests(@CurrentUser() u: AuthUser) {
    return this.friends.requests(u.sub);
  }

  /** POST /v1/friends/requests/:userId — envoyer une demande */
  @Post("requests/:userId")
  @Throttle({ default: { ttl: 3_600_000, limit: 60 } })
  async send(@CurrentUser() u: AuthUser, @Param("userId", ParseUUIDPipe) userId: string) {
    const result = await this.friends.sendRequest(u.sub, userId);
    if (result.status === "accepted") await this.friendshipConfirmed(u.sub, userId);
    return result;
  }

  /** POST /v1/friends/requests/:userId/accept — accepter une demande reçue */
  @Post("requests/:userId/accept")
  @HttpCode(204)
  async accept(@CurrentUser() u: AuthUser, @Param("userId", ParseUUIDPipe) userId: string) {
    await this.friends.accept(u.sub, userId);
    await this.friendshipConfirmed(u.sub, userId);
  }

  /** DELETE /v1/friends/requests/:userId — refuser une demande reçue ou annuler une demande envoyée */
  @Delete("requests/:userId")
  @HttpCode(204)
  decline(@CurrentUser() u: AuthUser, @Param("userId", ParseUUIDPipe) userId: string) {
    return this.friends.declineOrCancel(u.sub, userId);
  }

  /** DELETE /v1/friends/:userId — retirer un ami */
  @Delete(":userId")
  @HttpCode(204)
  remove(@CurrentUser() u: AuthUser, @Param("userId", ParseUUIDPipe) userId: string) {
    return this.friends.remove(u.sub, userId);
  }
}

@Module({ imports: [AchievementsModule], controllers: [FriendsController], providers: [FriendsService], exports: [FriendsService] })
export class FriendsModule {}
