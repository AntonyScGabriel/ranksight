import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { SeasonInput, SeasonRewards, defaultSeasonRewards, type SeasonDto, type SeasonStatus } from "@ranksight/shared";
import type { z } from "zod";
import { AuditService } from "../../common/audit/audit.module.js";
import { env } from "../../config/env.js";
import type { Season } from "../../generated/prisma/client.js";
import { PrismaService } from "../../prisma/prisma.service.js";

type SeasonData = z.output<typeof SeasonInput>;

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const monthIndex = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return y * 12 + (m - 1);
};
const monthStart = (index: number) => new Date(Date.UTC(Math.floor(index / 12), index % 12, 1));
const monthEnd = (index: number) => new Date(monthStart(index + 1).getTime() - 1);
const monthName = (index: number) => monthStart(index).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });

const slug = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28) || "saison";

export function seasonStatus(s: Pick<Season, "startsAt" | "endsAt" | "closedAt">, now = new Date()): SeasonStatus {
  if (s.closedAt) return "closed";
  if (now < s.startsAt) return "upcoming";
  if (now <= s.endsAt) return "current";
  return "to_close";
}

export function seasonRewards(s: Pick<Season, "rewards" | "name">) {
  const parsed = SeasonRewards.safeParse(s.rewards);
  return parsed.success ? parsed.data : defaultSeasonRewards(s.name);
}

/**
 * Saisons à dates libres, gérées dans l'administration (création, modification, suppression avant le début).
 * Liste gardée en mémoire (lue à chaque instant par les classements), rechargée après chaque modification et
 * chaque minute. Deux saisons ne se chevauchent jamais (contrainte en base) ; entre deux saisons, les défis du jour
 * ne comptent que pour les classements jour, semaine et général.
 */
@Injectable()
export class SeasonsService implements OnModuleInit {
  private readonly logger = new Logger(SeasonsService.name);
  private cache: Season[] = [];

  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async onModuleInit() {
    await this.importMonthlySeasons();
    await this.reload();
  }

  @Interval(60_000)
  async reload() {
    this.cache = await this.prisma.season.findMany({ orderBy: { startsAt: "asc" } });
  }

  /**
   * Premier démarrage avec les saisons à dates libres : les mois déjà joués (depuis SEASON_ONE) deviennent des saisons
   * bêta (sans récompense, classements conservés : mêmes clés), et la « Saison 1 » est créée pour le mois suivant.
   */
  private async importMonthlySeasons() {
    if ((await this.prisma.season.count()) > 0) return;
    const now = new Date();
    const current = monthIndex(monthKey(now));
    const first = Math.min(monthIndex(env().SEASON_ONE), current);
    const data = [];
    for (let i = first; i <= current; i++) {
      const key = monthKey(monthStart(i));
      const archived = await this.prisma.leaderboardSnapshot.findFirst({ where: { period: "SEASON", periodKey: key }, orderBy: { createdAt: "asc" } });
      const name = i === current ? "Saison bêta" : `Saison bêta (${monthName(i)})`;
      data.push({ key, number: null, name, startsAt: monthStart(i), endsAt: monthEnd(i), rewardsEnabled: false, rewards: defaultSeasonRewards(name), closedAt: archived?.createdAt ?? null });
    }
    data.push({
      key: "saison-1", number: 1, name: "Saison 1", startsAt: monthStart(current + 1), endsAt: monthEnd(current + 1),
      rewardsEnabled: true, rewards: defaultSeasonRewards("Saison 1"), closedAt: null,
    });
    try {
      await this.prisma.season.createMany({ data, skipDuplicates: true });
      this.logger.log(`Saisons créées : ${data.map((d) => d.name).join(", ")}`);
    } catch (e) {
      this.logger.error(`Création des saisons impossible : ${(e as Error).message}`);
    }
  }

  // ---------- Lecture (classements) ----------

  /** Saison en cours à cet instant (null entre deux saisons) */
  at(date = new Date()): Season | null {
    return this.cache.find((s) => s.startsAt <= date && date <= s.endsAt) ?? null;
  }

  keyAt(date = new Date()): string | null {
    return this.at(date)?.key ?? null;
  }

  byKey(key: string): Season | null {
    return this.cache.find((s) => s.key === key) ?? null;
  }

  /** Saisons terminées et pas encore clôturées */
  toClose(now = new Date()): Season[] {
    return this.cache.filter((s) => !s.closedAt && s.endsAt < now);
  }

  next(now = new Date()): Season | null {
    return this.cache.find((s) => s.startsAt > now) ?? null;
  }

  all(): Season[] {
    return this.cache;
  }

  toDto(s: Season, now = new Date()): SeasonDto {
    const status = seasonStatus(s, now);
    return {
      key: s.key,
      number: s.number,
      name: s.name,
      label: s.name,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      current: status === "current",
      upcoming: status === "upcoming",
      closed: status === "closed",
      rewards: s.rewardsEnabled ? seasonRewards(s) : null,
    };
  }

  /** De la plus récente à la plus ancienne, saisons à venir comprises */
  list(now = new Date()): SeasonDto[] {
    return [...this.cache].reverse().map((s) => this.toDto(s, now));
  }

  async markClosed(key: string) {
    await this.prisma.season.update({ where: { key }, data: { closedAt: new Date() } });
    await this.reload();
  }

  // ---------- Administration ----------

  private async assertNoOverlap(startsAt: Date, endsAt: Date, exceptId?: string) {
    const other = await this.prisma.season.findFirst({
      where: { startsAt: { lte: endsAt }, endsAt: { gte: startsAt }, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { name: true },
    });
    if (other) throw new ConflictException({ code: "SEASON_OVERLAP", message: `Ces dates chevauchent « ${other.name} ».` });
  }

  private async assertNumberFree(number: number | null, exceptId?: string) {
    if (number === null) return;
    const other = await this.prisma.season.findFirst({ where: { number, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { name: true } });
    if (other) throw new ConflictException({ code: "SEASON_NUMBER_TAKEN", message: `Le numéro ${number} est déjà utilisé par « ${other.name} ».` });
  }

  /** Clé stable : « saison-3 » pour une saison numérotée, sinon d'après le nom (unique) */
  private async newKey(input: { number: number | null; name: string }, exceptId?: string) {
    const base = input.number !== null ? `saison-${input.number}` : slug(input.name);
    for (let i = 1; ; i++) {
      const key = i === 1 ? base : `${base}-${i}`;
      const taken = await this.prisma.season.findFirst({ where: { key, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
      if (!taken) return key;
    }
  }

  async create(actorId: string, input: SeasonData) {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (endsAt <= new Date()) throw new BadRequestException({ code: "SEASON_IN_PAST", message: "La saison doit se terminer dans le futur." });
    await this.assertNoOverlap(startsAt, endsAt);
    await this.assertNumberFree(input.number);
    const season = await this.prisma.season.create({
      data: {
        key: await this.newKey(input), number: input.number, name: input.name, startsAt, endsAt,
        rewardsEnabled: input.rewardsEnabled, rewards: input.rewards,
      },
    });
    await this.reload();
    await this.audit.log(actorId, "season.create", "season", season.key, undefined, { after: this.snapshot(season) });
    return this.toDto(season);
  }

  /**
   * Modification. Saison clôturée : seul le nom change. Saison commencée : la date de début est figée (les points déjà
   * marqués lui appartiennent). Saison à venir : tout est modifiable.
   */
  async update(actorId: string, key: string, input: SeasonData) {
    const season = await this.prisma.season.findUnique({ where: { key } });
    if (!season) throw new NotFoundException("Saison introuvable.");
    const status = seasonStatus(season);
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    const sameRewards = JSON.stringify(seasonRewards(season)) === JSON.stringify(input.rewards);

    if (status === "closed" || status === "to_close") {
      const unchanged =
        input.number === season.number && startsAt.getTime() === season.startsAt.getTime() && endsAt.getTime() === season.endsAt.getTime() &&
        input.rewardsEnabled === season.rewardsEnabled && sameRewards;
      if (!unchanged) {
        const code = status === "closed" ? "SEASON_CLOSED" : "SEASON_ENDED";
        const message = status === "closed"
          ? "Saison clôturée : seul le nom peut encore être modifié."
          : "Saison terminée : seul le nom peut être modifié avant sa clôture.";
        throw new BadRequestException({ code, message });
      }
    } else if (status !== "upcoming" && startsAt.getTime() !== season.startsAt.getTime()) {
      throw new BadRequestException({ code: "SEASON_STARTED", message: "La saison a commencé : sa date de début ne peut plus changer." });
    }
    await this.assertNoOverlap(startsAt, endsAt, season.id);
    await this.assertNumberFree(input.number, season.id);

    const updated = await this.prisma.season.update({
      where: { id: season.id },
      data: {
        name: input.name, number: input.number, startsAt, endsAt, rewardsEnabled: input.rewardsEnabled, rewards: input.rewards,
        // Aucun point n'est encore rattaché à une saison à venir : sa clé suit son numéro ou son nom
        ...(status === "upcoming" ? { key: await this.newKey(input, season.id) } : {}),
      },
    });
    await this.reload();
    await this.audit.log(actorId, "season.update", "season", updated.key, undefined, { before: this.snapshot(season), after: this.snapshot(updated) });
    return this.toDto(updated);
  }

  /** Suppression d'une saison qui n'a pas commencé */
  async remove(actorId: string, key: string) {
    const season = await this.prisma.season.findUnique({ where: { key } });
    if (!season) throw new NotFoundException("Saison introuvable.");
    if (seasonStatus(season) !== "upcoming") {
      throw new BadRequestException({ code: "SEASON_STARTED", message: "Seule une saison qui n'a pas commencé peut être supprimée." });
    }
    await this.prisma.season.delete({ where: { id: season.id } });
    await this.reload();
    await this.audit.log(actorId, "season.delete", "season", key, undefined, { before: this.snapshot(season) });
  }

  private snapshot(s: Season) {
    return {
      name: s.name, number: s.number, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString(),
      rewardsEnabled: s.rewardsEnabled, rewards: seasonRewards(s),
    };
  }
}
