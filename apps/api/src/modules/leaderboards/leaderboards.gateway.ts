import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";

/**
 * Classements en temps réel (web + mobile) via Socket.IO.
 * Les clients s'abonnent à une clé ("lb:daily:2026-10-05" ou "lb:daily:2026-10-05:valorant") et reçoivent
 * un signal "lb:changed" au plus toutes les 2 s — ils re-téléchargent alors la page affichée.
 * En multi-instance, l'adaptateur Redis (redis-io.adapter.ts) relaie les signaux entre instances.
 */
@WebSocketGateway({ namespace: "/ws/leaderboards", cors: { origin: true, credentials: true } })
export class LeaderboardsGateway {
  @WebSocketServer() server: Server;
  private readonly pending = new Set<string>();
  private timer?: NodeJS.Timeout;

  @SubscribeMessage("subscribe")
  subscribe(@ConnectedSocket() socket: Socket, @MessageBody() key: string) {
    if (typeof key === "string" && /^lb:[a-z_]+(:[\w-]+){0,2}$/.test(key)) void socket.join(key);
  }

  @SubscribeMessage("unsubscribe")
  unsubscribe(@ConnectedSocket() socket: Socket, @MessageBody() key: string) {
    void socket.leave(key);
  }

  notify(key: string) {
    this.pending.add(key);
    this.timer ??= setTimeout(() => {
      for (const k of this.pending) this.server?.to(k).emit("lb:changed", { key: k });
      this.pending.clear();
      this.timer = undefined;
    }, 2000);
  }
}
