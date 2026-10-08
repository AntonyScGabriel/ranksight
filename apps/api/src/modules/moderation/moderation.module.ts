import {
  Body, Controller, DefaultValuePipe, Delete, Get, Global, HttpCode, Module, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import { ChatSettingsInput, ReportPlayerInput } from "@ranksight/shared";
import { CurrentUser, type AuthUser } from "../../common/decorators/current-user.decorator.js";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { ZodPipe } from "../../common/pipes/zod.pipe.js";
import { AuthModule } from "../auth/auth.module.js";
import { ChatModule } from "../chat/chat.module.js";
import { MAX_MUTE_HOURS, ModerationService } from "./moderation.service.js";
import { ChatSettingsService } from "./chat-settings.service.js";

const ResolveBody = z.object({
  status: z.enum(["RESOLVED", "DISMISSED"]),
  resolution: z.string().trim().max(300).optional(),
  /** Supprimer le message signalé */
  deleteMessage: z.boolean().default(false),
  /** Couper le chat du joueur signalé pendant N heures (0 = non) */
  muteHours: z.number().int().min(0).max(MAX_MUTE_HOURS).default(0),
  /** Bannir le joueur signalé */
  ban: z.boolean().default(false),
});
const MuteBody = z.object({ hours: z.number().int().min(0).max(MAX_MUTE_HOURS) });

@Controller("users")
export class BlocksController {
  constructor(private readonly moderation: ModerationService) {}

  /** GET /v1/users/me/blocks — joueurs bloqués */
  @Get("me/blocks")
  blocks(@CurrentUser() u: AuthUser) {
    return this.moderation.listBlocked(u.sub);
  }

  @Post(":id/block")
  @HttpCode(204)
  @Throttle({ default: { ttl: 3_600_000, limit: 60 } })
  async block(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.moderation.block(u.sub, id);
  }

  @Delete(":id/block")
  @HttpCode(204)
  async unblock(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.moderation.unblock(u.sub, id);
  }
}

@Controller("reports/players")
export class PlayerReportsController {
  constructor(private readonly moderation: ModerationService) {}

  /** POST /v1/reports/players — { targetUserId, reason, details?, globalMessageId?, directMessageId? } */
  @Post()
  @HttpCode(204)
  @Throttle({ default: { ttl: 3_600_000, limit: 20 } })
  async report(@CurrentUser() u: AuthUser, @Body(new ZodPipe(ReportPlayerInput)) body: z.output<typeof ReportPlayerInput>) {
    await this.moderation.report(u.sub, body);
  }
}

@Controller("admin")
@Roles("MODERATOR")
export class ModerationAdminController {
  constructor(private readonly moderation: ModerationService, private readonly settings: ChatSettingsService) {}

  @Get("player-reports")
  list(@Query("status") status = "OPEN", @Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number) {
    return this.moderation.list(status, page);
  }

  @Post("player-reports/:id/resolve")
  @HttpCode(204)
  async resolve(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(ResolveBody)) b: z.output<typeof ResolveBody>) {
    await this.moderation.resolve(u.sub, id, b);
  }

  /** GET /v1/admin/chat/settings — mots interdits, mode lent, masquage automatique */
  @Get("chat/settings")
  chatSettings() {
    return this.settings.get();
  }

  /** PATCH /v1/admin/chat/settings — modifiable depuis l'administration ou directement depuis le chat (mode lent) */
  @Patch("chat/settings")
  updateChatSettings(@CurrentUser() u: AuthUser, @Body(new ZodPipe(ChatSettingsInput)) b: ChatSettingsInput) {
    return this.settings.update(u.sub, b);
  }

  /** POST /v1/admin/users/:id/mute — { hours } (0 = rétablir le chat) */
  @Post("users/:id/mute")
  @HttpCode(200)
  mute(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(MuteBody)) b: z.output<typeof MuteBody>) {
    return this.moderation.mute(u.sub, id, b.hours);
  }
}

@Global()
@Module({
  imports: [AuthModule, ChatModule],
  controllers: [BlocksController, PlayerReportsController, ModerationAdminController],
  providers: [ModerationService, ChatSettingsService],
  exports: [ModerationService, ChatSettingsService],
})
export class ModerationModule {}
