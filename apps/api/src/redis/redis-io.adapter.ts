import type { INestApplicationContext } from "@nestjs/common";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { Redis } from "ioredis";
import type { ServerOptions } from "socket.io";
import { env } from "../config/env.js";

/**
 * Socket.IO partagé entre plusieurs instances de l'API via Redis (pub/sub) :
 * un message émis sur une instance atteint les clients connectés aux autres.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly pub = new Redis(env().REDIS_URL, { lazyConnect: true });
  private readonly sub = new Redis(env().REDIS_URL, { lazyConnect: true });
  private adapter?: ReturnType<typeof createAdapter>;

  constructor(app: INestApplicationContext) {
    super(app);
  }

  async connect() {
    await Promise.all([this.pub.connect(), this.sub.connect()]);
    this.adapter = createAdapter(this.pub, this.sub);
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    if (this.adapter) server.adapter(this.adapter);
    return server;
  }

  async close() {
    await Promise.allSettled([this.pub.quit(), this.sub.quit()]);
  }
}
