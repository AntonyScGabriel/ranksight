import { Controller, Get, Inject, ServiceUnavailableException, VERSION_NEUTRAL } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { Redis } from "ioredis";
import { Public } from "./common/decorators/public.decorator.js";
import { PrismaService } from "./prisma/prisma.service.js";
import { REDIS } from "./redis/redis.module.js";

/** GET /health — état de l'API, de PostgreSQL et de Redis (surveillance, Docker, hébergeur) */
@Controller({ path: "health", version: VERSION_NEUTRAL })
@SkipThrottle()
export class HealthController {
  constructor(private readonly prisma: PrismaService, @Inject(REDIS) private readonly redis: Redis) {}

  @Public()
  @Get()
  async check() {
    const [db, cache] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => "ok", () => "down"),
      this.redis.ping().then(() => "ok", () => "down"),
    ]);
    const body = { status: db === "ok" && cache === "ok" ? "ok" : "degraded", database: db, redis: cache, time: new Date().toISOString() };
    if (body.status !== "ok") throw new ServiceUnavailableException(body);
    return body;
  }
}
