import { Global, Injectable, Logger, Module } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { env } from "../../config/env.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { todayUtc } from "../clips/clips.service.js";

interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/**
 * Notifications push via le service Expo Push (relaie vers APNs et FCM).
 * Les jetons rejetés par Expo (appareil désinscrit) sont supprimés automatiquement.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  constructor(private readonly prisma: PrismaService) {}

  async toUsers(userIds: string[], message: PushMessage) {
    if (!userIds.length) return;
    const tokens = await this.prisma.pushToken.findMany({
      where: { userId: { in: userIds }, platform: { in: ["IOS", "ANDROID"] } },
      select: { token: true },
    });
    await this.send(tokens.map((t) => t.token), message);
  }

  async send(tokens: string[], message: PushMessage) {
    for (let i = 0; i < tokens.length; i += 100) {
      const batch = tokens.slice(i, i + 100);
      try {
        const res = await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(batch.map((to) => ({ to, sound: "default", ...message }))),
        });
        if (!res.ok) {
          this.logger.warn(`Expo Push a répondu ${res.status}`);
          continue;
        }
        const { data } = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
        const dead = (data ?? [])
          .map((ticket, idx) => (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered" ? batch[idx] : null))
          .filter((t): t is string => !!t);
        if (dead.length) await this.prisma.pushToken.deleteMany({ where: { token: { in: dead } } });
      } catch (e) {
        this.logger.warn(`Envoi push impossible : ${(e as Error).message}`);
      }
    }
  }
}

/**
 * Rappels quotidiens :
 * - 10:00 UTC : les 4 défis du jour sont disponibles
 * - 19:00 UTC : rappel aux joueurs dont la série est en jeu et qui n'ont pas encore joué
 */
@Injectable()
export class DailyReminders {
  constructor(private readonly prisma: PrismaService, private readonly push: PushService) {}

  @Cron("0 10 * * *", { timeZone: "UTC" })
  async dailyAvailable() {
    const tokens = await this.prisma.pushToken.findMany({
      where: { platform: { in: ["IOS", "ANDROID"] }, user: { notifyDaily: true, status: "ACTIVE" } },
      select: { token: true },
    });
    await this.push.send(tokens.map((t) => t.token), {
      title: "Les défis du jour sont en ligne",
      body: "League of Legends, Valorant, Rocket League et Counter-Strike 2 : devine les 4 rangs avant tes amis.",
      data: { url: `${env().APP_SCHEME}://` },
    });
  }

  @Cron("0 19 * * *", { timeZone: "UTC" })
  async streakReminder() {
    const tokens = await this.prisma.pushToken.findMany({
      where: {
        platform: { in: ["IOS", "ANDROID"] },
        user: { notifyDaily: true, status: "ACTIVE", dailyStreak: { gt: 0 }, NOT: { lastDailyDate: todayUtc() } },
      },
      select: { token: true },
    });
    await this.push.send(tokens.map((t) => t.token), {
      title: "Ta série est en jeu",
      body: "Il te reste quelques heures pour la garder.",
      data: { url: `${env().APP_SCHEME}://` },
    });
  }
}

@Global()
@Module({ providers: [PushService, DailyReminders], exports: [PushService] })
export class NotificationsModule {}
