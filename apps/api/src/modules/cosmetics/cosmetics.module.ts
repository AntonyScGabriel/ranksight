import { BadRequestException, Body, Controller, Delete, Get, Global, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Put } from "@nestjs/common";
import { CosmeticInput, EquipFlairInput, GrantCosmeticInput } from "@ranksight/shared";
import type { z } from "zod";
import { CurrentUser, type AuthUser } from "../../common/decorators/current-user.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { ZodPipe } from "../../common/pipes/zod.pipe.js";
import { CosmeticsService } from "./cosmetics.service.js";

@Controller("users/me")
export class MyRewardsController {
  constructor(private readonly cosmetics: CosmeticsService) {}

  /** GET /v1/users/me/rewards — titres, badges et cadres obtenus, équipés et à gagner */
  @Get("rewards")
  rewards(@CurrentUser() u: AuthUser) {
    return this.cosmetics.myRewards(u.sub);
  }

  /** PUT /v1/users/me/flair — { titleId?, badgeId?, frameId? } (null = retirer) */
  @Put("flair")
  equip(@CurrentUser() u: AuthUser, @Body(new ZodPipe(EquipFlairInput)) body: EquipFlairInput) {
    return this.cosmetics.equip(u.sub, body);
  }
}

/** Récompenses : consultation pour l'équipe, création et attribution réservées aux administrateurs (journalisées) */
@Controller("admin")
@Roles("MODERATOR")
export class CosmeticsAdminController {
  constructor(private readonly cosmetics: CosmeticsService) {}

  @Get("cosmetics")
  list() {
    return this.cosmetics.list();
  }

  /** Succès proposés comme condition de déblocage */
  @Get("cosmetics/achievements")
  achievements() {
    return this.cosmetics.achievementOptions();
  }

  @Get("cosmetics/:id/holders")
  holders(@Param("id", ParseUUIDPipe) id: string) {
    return this.cosmetics.holders(id);
  }

  @Roles("ADMIN")
  @Post("cosmetics")
  create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(CosmeticInput)) body: z.output<typeof CosmeticInput>) {
    return this.cosmetics.create(u.sub, body);
  }

  @Roles("ADMIN")
  @Patch("cosmetics/:id")
  update(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(CosmeticInput)) body: z.output<typeof CosmeticInput>) {
    return this.cosmetics.update(u.sub, id, body);
  }

  /** POST /v1/admin/cosmetics/:id/grant — { pseudo, note? } */
  @Roles("ADMIN")
  @Post("cosmetics/:id/grant")
  grantByPseudo(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(GrantCosmeticInput)) body: z.output<typeof GrantCosmeticInput>) {
    if (!body.pseudo) throw new BadRequestException("Indique le pseudo du joueur.");
    return this.cosmetics.grant(u.sub, { pseudo: body.pseudo }, id, body.note);
  }

  @Get("users/:userId/cosmetics")
  ofUser(@Param("userId", ParseUUIDPipe) userId: string) {
    return this.cosmetics.ofUser(userId);
  }

  /** POST /v1/admin/users/:userId/cosmetics — { cosmeticId, note? } */
  @Roles("ADMIN")
  @Post("users/:userId/cosmetics")
  grant(@CurrentUser() u: AuthUser, @Param("userId", ParseUUIDPipe) userId: string, @Body(new ZodPipe(GrantCosmeticInput)) body: z.output<typeof GrantCosmeticInput>) {
    if (!body.cosmeticId) throw new BadRequestException("Choisis une récompense.");
    return this.cosmetics.grant(u.sub, { userId }, body.cosmeticId, body.note);
  }

  @Roles("ADMIN")
  @Delete("users/:userId/cosmetics/:cosmeticId")
  @HttpCode(204)
  async revoke(@CurrentUser() u: AuthUser, @Param("userId", ParseUUIDPipe) userId: string, @Param("cosmeticId", ParseUUIDPipe) cosmeticId: string) {
    await this.cosmetics.revoke(u.sub, userId, cosmeticId);
  }
}

@Global()
@Module({ controllers: [MyRewardsController, CosmeticsAdminController], providers: [CosmeticsService], exports: [CosmeticsService] })
export class CosmeticsModule {}
