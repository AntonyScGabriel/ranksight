import { ForbiddenException, Injectable } from "@nestjs/common";
import { CHAT_EVENTS, type ChatMessageDto, type ConversationDto } from "@ranksight/shared";
import { env } from "../../config/env.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { FriendsService } from "../friends/friends.service.js";
import { PushService } from "../notifications/notifications.module.js";
import { ModerationService } from "../moderation/moderation.service.js";
import { ChatGateway } from "./chat.gateway.js";

export const conversationKey = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);

type MessageRow = { id: string; senderId: string; recipientId: string; body: string; createdAt: Date; readAt: Date | null };

const toDto = (m: MessageRow): ChatMessageDto => ({
  id: m.id,
  senderId: m.senderId,
  recipientId: m.recipientId,
  body: m.body,
  createdAt: m.createdAt.toISOString(),
  readAt: m.readAt?.toISOString() ?? null,
});

/**
 * Messagerie privée entre amis.
 * L'envoi passe par l'API REST (validation, limites, persistance), la diffusion par Socket.IO :
 * chaque utilisateur rejoint la salle `user:<id>` sur toutes ses connexions (web, mobile, plusieurs onglets).
 * Avec l'adaptateur Redis, la diffusion fonctionne sur plusieurs instances de l'API.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly friends: FriendsService,
    private readonly gateway: ChatGateway,
    private readonly push: PushService,
    private readonly moderation: ModerationService,
  ) {}

  async conversations(userId: string): Promise<ConversationDto[]> {
    const friendList = await this.friends.list(userId);
    if (!friendList.length) return [];
    const keys = friendList.map((f) => conversationKey(userId, f.id));

    const [lastMessages, unread] = await Promise.all([
      this.prisma.$queryRaw<(MessageRow & { conversationKey: string })[]>`
        SELECT DISTINCT ON (conversation_key)
          id, conversation_key AS "conversationKey", sender_id AS "senderId", recipient_id AS "recipientId",
          body, created_at AS "createdAt", read_at AS "readAt"
        FROM direct_messages
        WHERE conversation_key = ANY(${keys})
        ORDER BY conversation_key, created_at DESC`,
      this.prisma.directMessage.groupBy({ by: ["senderId"], where: { recipientId: userId, readAt: null }, _count: true }),
    ]);
    const lastByKey = new Map(lastMessages.map((m) => [m.conversationKey, m]));
    const unreadBySender = new Map(unread.map((u) => [u.senderId, u._count]));

    return friendList
      .map((friend) => {
        const last = lastByKey.get(conversationKey(userId, friend.id));
        return { friend, lastMessage: last ? toDto(last) : null, unread: unreadBySender.get(friend.id) ?? 0 };
      })
      .sort((a, b) => (b.lastMessage?.createdAt ?? "").localeCompare(a.lastMessage?.createdAt ?? "") || a.friend.displayName.localeCompare(b.friend.displayName));
  }

  async history(userId: string, friendId: string, before?: string, limit = 50): Promise<ChatMessageDto[]> {
    await this.assertFriends(userId, friendId);
    const rows = await this.prisma.directMessage.findMany({
      where: { conversationKey: conversationKey(userId, friendId), ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return rows.reverse().map(toDto);
  }

  async send(userId: string, friendId: string, body: string): Promise<ChatMessageDto> {
    await this.assertFriends(userId, friendId);
    await this.moderation.assertCanChat(userId);
    if (await this.moderation.isBlocked(userId, friendId)) throw new ForbiddenException("Impossible d'écrire à ce joueur.");
    await this.moderation.assertCleanText(body);
    const message = toDto(
      await this.prisma.directMessage.create({
        data: { conversationKey: conversationKey(userId, friendId), senderId: userId, recipientId: friendId, body },
      }),
    );
    this.gateway.emitToUser(friendId, CHAT_EVENTS.message, message);
    this.gateway.emitToUser(userId, CHAT_EVENTS.message, message);

    // Destinataire hors ligne : notification push sur son téléphone
    if (!(await this.gateway.isOnline(friendId))) {
      const sender = await this.prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } });
      await this.push.toUsers([friendId], {
        title: sender?.displayName ?? "Nouveau message",
        body: body.length > 120 ? `${body.slice(0, 117)}…` : body,
        data: { url: `${env().APP_SCHEME}://chat/${userId}` },
      });
    }
    return message;
  }

  async markRead(userId: string, friendId: string) {
    const { count } = await this.prisma.directMessage.updateMany({
      where: { conversationKey: conversationKey(userId, friendId), recipientId: userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (count > 0) this.gateway.emitToUser(friendId, CHAT_EVENTS.read, { readerId: userId, at: new Date().toISOString() });
    return { updated: count };
  }

  async unreadTotal(userId: string) {
    return { unread: await this.prisma.directMessage.count({ where: { recipientId: userId, readAt: null } }) };
  }

  private async assertFriends(userId: string, friendId: string) {
    if (!(await this.friends.areFriends(userId, friendId))) throw new ForbiddenException("Vous devez être amis pour discuter.");
  }
}
