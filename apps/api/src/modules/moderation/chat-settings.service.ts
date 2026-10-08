import { Injectable } from "@nestjs/common";
import { DEFAULT_CHAT_SETTINGS, GLOBAL_CHAT_EVENTS, type ChatSettingsDto, type ChatSettingsInput } from "@ranksight/shared";
import { AuditService } from "../../common/audit/audit.module.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { ChatGateway } from "../chat/chat.gateway.js";

const KEY = "chat";
/** Les réglages sont relus au plus toutes les 10 secondes (plusieurs instances de l'API peuvent tourner) */
const CACHE_MS = 10_000;

/** Réglages de modération du chat, modifiables par l'équipe sans redémarrer : mots interdits, mode lent, masquage automatique. */
@Injectable()
export class ChatSettingsService {
  private cache: { value: ChatSettingsDto; at: number } | null = null;

  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly gateway: ChatGateway) {}

  async get(): Promise<ChatSettingsDto> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    const row = await this.prisma.appSetting.findUnique({ where: { key: KEY } });
    const value = { ...DEFAULT_CHAT_SETTINGS, ...((row?.value as Partial<ChatSettingsDto> | undefined) ?? {}) };
    this.cache = { value, at: Date.now() };
    return value;
  }

  async update(actorId: string, input: ChatSettingsInput): Promise<ChatSettingsDto> {
    const current = await this.get();
    const next: ChatSettingsDto = {
      bannedWords: input.bannedWords
        ? [...new Set(input.bannedWords.map((w) => w.trim().toLowerCase()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"))
        : current.bannedWords,
      slowModeSec: input.slowModeSec ?? current.slowModeSec,
      autoHideReports: input.autoHideReports ?? current.autoHideReports,
    };
    await this.prisma.appSetting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: next, updatedById: actorId },
      update: { value: next, updatedById: actorId },
    });
    this.cache = { value: next, at: Date.now() };
    await this.audit.log(actorId, "chat.settings", "app_setting", KEY, {
      slowModeSec: next.slowModeSec, autoHideReports: next.autoHideReports, bannedWords: next.bannedWords.length,
    });
    // Les joueurs connectés voient tout de suite le mode lent
    if (next.slowModeSec !== current.slowModeSec) this.gateway.emitGlobal(GLOBAL_CHAT_EVENTS.settings, { slowModeSec: next.slowModeSec });
    return next;
  }
}
