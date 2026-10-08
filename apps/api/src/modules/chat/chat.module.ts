import {
  Body, Controller, DefaultValuePipe, Delete, Get, HttpCode, Module, Param, ParseIntPipe, ParseUUIDPipe, Post, Query,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { SendGlobalMessageInput, SendMessageInput } from "@ranksight/shared";
import { z } from "zod";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { CurrentUser, type AuthUser } from "../../common/decorators/current-user.decorator.js";
import { ZodPipe } from "../../common/pipes/zod.pipe.js";
import { FriendsModule } from "../friends/friends.module.js";
import { ChatGateway } from "./chat.gateway.js";
import { ChatService } from "./chat.service.js";
import { GlobalChatService } from "./global-chat.service.js";

const PurgeBody = z.object({ hours: z.number().int().min(1).max(24 * 7).default(24) });

/** Chat global : salon public commun à tous les joueurs connectés */
@Controller("chat/global")
export class GlobalChatController {
  constructor(private readonly chat: GlobalChatService) {}

  /** GET /v1/chat/global?before=ISO&limit=50 — messages récents, du plus ancien au plus récent */
  @Get()
  recent(
    @CurrentUser() u: AuthUser | undefined,
    @Query("before") before?: string,
    @Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit?: number,
  ) {
    return this.chat.recent(before, limit, u?.sub);
  }

  /** POST /v1/chat/global — { body } */
  @Post()
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  send(@CurrentUser() u: AuthUser, @Body(new ZodPipe(SendGlobalMessageInput)) body: SendGlobalMessageInput) {
    return this.chat.send(u.sub, body.body);
  }

  /** GET /v1/chat/global/settings — mode lent en cours */
  @Get("settings")
  settings() {
    return this.chat.publicSettings();
  }

  /** DELETE /v1/chat/global/:id — son propre message, ou n'importe lequel pour un modérateur ou un administrateur */
  @Delete(":id")
  @HttpCode(204)
  remove(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.chat.remove(u.sub, id);
  }
}

/** Modération du chat global (administration) */
@Controller("admin/chat")
@Roles("MODERATOR")
export class GlobalChatAdminController {
  constructor(private readonly chat: GlobalChatService) {}

  /** GET /v1/admin/chat/messages?page=1 — messages récents, supprimés compris */
  @Get("messages")
  list(@Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number) {
    return this.chat.moderationList(page);
  }

  /** POST /v1/admin/chat/purge/:userId — { hours } : efface les messages du joueur des N dernières heures */
  @Post("purge/:userId")
  @HttpCode(200)
  purge(@CurrentUser() u: AuthUser, @Param("userId", ParseUUIDPipe) userId: string, @Body(new ZodPipe(PurgeBody)) b: z.output<typeof PurgeBody>) {
    return this.chat.purge(u.sub, userId, b.hours);
  }
}

@Controller("chat")
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  /** GET /v1/chat/conversations — amis, dernier message et nombre de non-lus */
  @Get("conversations")
  conversations(@CurrentUser() u: AuthUser) {
    return this.chat.conversations(u.sub);
  }

  /** GET /v1/chat/unread — total des messages non lus (badge) */
  @Get("unread")
  unread(@CurrentUser() u: AuthUser) {
    return this.chat.unreadTotal(u.sub);
  }

  /** GET /v1/chat/:friendId/messages?before=ISO&limit=50 — historique, du plus ancien au plus récent */
  @Get(":friendId/messages")
  history(
    @CurrentUser() u: AuthUser,
    @Param("friendId", ParseUUIDPipe) friendId: string,
    @Query("before") before?: string,
    @Query("limit") limit?: string,
  ) {
    return this.chat.history(u.sub, friendId, before, limit ? Number(limit) : 50);
  }

  /** POST /v1/chat/:friendId/messages — { body } */
  @Post(":friendId/messages")
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  send(@CurrentUser() u: AuthUser, @Param("friendId", ParseUUIDPipe) friendId: string, @Body(new ZodPipe(SendMessageInput)) body: SendMessageInput) {
    return this.chat.send(u.sub, friendId, body.body);
  }

  /** POST /v1/chat/:friendId/read — marque la conversation comme lue */
  @Post(":friendId/read")
  read(@CurrentUser() u: AuthUser, @Param("friendId", ParseUUIDPipe) friendId: string) {
    return this.chat.markRead(u.sub, friendId);
  }
}

@Module({
  imports: [FriendsModule],
  // GlobalChatController avant ChatController : /chat/global ne doit pas être lu comme /chat/:friendId
  controllers: [GlobalChatController, GlobalChatAdminController, ChatController],
  providers: [ChatService, GlobalChatService, ChatGateway],
  exports: [ChatGateway],
})
export class ChatModule {}
