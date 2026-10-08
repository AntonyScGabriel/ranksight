import { Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage, WebSocketGateway, WebSocketServer,
} from "@nestjs/websockets";
import type { Namespace, Socket } from "socket.io";
import { CHAT_EVENTS, GLOBAL_CHAT_EVENTS } from "@ranksight/shared";
import type { AuthUser } from "../../common/decorators/current-user.decorator.js";
import { env } from "../../config/env.js";
import { FriendsService } from "../friends/friends.service.js";

const room = (userId: string) => `user:${userId}`;
const GLOBAL_ROOM = "global";

function cookieValue(header: string | undefined, name: string): string | undefined {
  return header
    ?.split(";")
    .map((c) => c.trim().split("="))
    .find(([k]) => k === name)?.[1];
}

/**
 * Temps réel de la messagerie privée et du chat global : namespace /ws/chat.
 * - salle `user:<id>` : messages privés de l'utilisateur (rejointe automatiquement)
 * - salle `global`    : chat global, rejointe à l'ouverture de l'écran du chat (global:join / global:leave)
 * Authentification à la connexion : jeton passé dans `auth.token` (mobile) ou cookie de session (web).
 */
@WebSocketGateway({ namespace: "/ws/chat", cors: { origin: env().CORS_ORIGINS, credentials: true } })
export class ChatGateway implements OnGatewayConnection {
  private readonly logger = new Logger(ChatGateway.name);
  @WebSocketServer() server: Namespace;

  constructor(private readonly jwt: JwtService, private readonly friends: FriendsService) {}

  async handleConnection(socket: Socket) {
    // Les messages reçus pendant la vérification du jeton attendent sa fin (voir userOf)
    socket.data.ready = this.authenticate(socket);
    await socket.data.ready;
  }

  private async authenticate(socket: Socket): Promise<string | undefined> {
    const token = (socket.handshake.auth?.token as string | undefined) ?? cookieValue(socket.handshake.headers.cookie, "rs_access");
    try {
      if (!token) throw new Error("no token");
      const user = await this.jwt.verifyAsync<AuthUser>(token, { secret: env().JWT_ACCESS_SECRET, algorithms: ["HS256"] });
      socket.data.userId = user.sub;
      await socket.join(room(user.sub));
      return user.sub;
    } catch {
      socket.emit("error", { code: "UNAUTHORIZED" });
      socket.disconnect(true);
      return undefined;
    }
  }

  private async userOf(socket: Socket): Promise<string | undefined> {
    return (await (socket.data.ready as Promise<string | undefined> | undefined)) ?? (socket.data.userId as string | undefined);
  }

  /** « est en train d'écrire » : relayé uniquement entre amis, rien n'est stocké. */
  @SubscribeMessage(CHAT_EVENTS.typing)
  async typing(@ConnectedSocket() socket: Socket, @MessageBody() body: { to?: string }) {
    const from = await this.userOf(socket);
    if (!from || typeof body?.to !== "string") return;
    if (await this.friends.areFriends(from, body.to)) this.emitToUser(body.to, CHAT_EVENTS.typing, { from });
  }

  @SubscribeMessage(GLOBAL_CHAT_EVENTS.join)
  async joinGlobal(@ConnectedSocket() socket: Socket) {
    if (await this.userOf(socket)) await socket.join(GLOBAL_ROOM);
  }

  @SubscribeMessage(GLOBAL_CHAT_EVENTS.leave)
  async leaveGlobal(@ConnectedSocket() socket: Socket) {
    await socket.leave(GLOBAL_ROOM);
  }

  emitGlobal(event: string, payload: unknown) {
    this.server?.to(GLOBAL_ROOM).emit(event, payload);
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    this.server?.to(room(userId)).emit(event, payload);
  }

  async isOnline(userId: string): Promise<boolean> {
    try {
      return (await this.server.in(room(userId)).fetchSockets()).length > 0;
    } catch (e) {
      this.logger.warn(`Présence indisponible : ${(e as Error).message}`);
      return false;
    }
  }
}
