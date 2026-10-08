import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Redis } from "ioredis";
import { env } from "../../config/env.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { REDIS } from "../../redis/redis.module.js";
import { StorageService } from "../storage/storage.service.js";

const run = promisify(execFile);

/** Hauteur maximale des vidéos stockées : 720p suffit largement pour deviner un rang et divise la taille par 3 à 6. */
const MAX_HEIGHT = 720;
/** Durée maximale conservée (les clips font 15 à 30 s) */
const MAX_DURATION_SEC = 35;
/** Un clip refusé garde sa vidéo 14 jours (le joueur peut la revoir dans « Mes clips »), puis le fichier est supprimé. */
const REJECTED_KEEP_DAYS = 14;
/** Un fichier envoyé mais jamais rattaché à un clip (envoi abandonné) est supprimé après 6 heures. */
const ORPHAN_AFTER_HOURS = 6;
const LAST_CLEANUP_KEY = "storage:last-cleanup";

export interface CleanupReport {
  at: string;
  rejectedExpired: number;
  deletedFiles: number;
  freedBytes: number;
  processed: number;
  errors: number;
}

/**
 * Traitement des vidéos :
 * - compression à l'envoi (720p, H.264 + AAC, démarrage rapide) avec ffmpeg, et image d'aperçu ;
 *   un fichier qui n'est pas une vidéo lisible est refusé automatiquement ;
 * - nettoyage chaque nuit : vidéos des clips supprimés, des clips refusés depuis 14 jours, envois abandonnés.
 * Sans ffmpeg installé (développement), les vidéos sont gardées telles quelles.
 */
@Injectable()
export class ClipProcessingService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ClipProcessingService.name);
  private ffmpegReady: boolean | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  onApplicationBootstrap() {
    // Clips envoyés pendant un arrêt du serveur : traités au démarrage, sans bloquer celui-ci
    setTimeout(() => void this.processPending().catch((e) => this.logger.error("Traitement en attente impossible", e as Error)), 5000);
  }

  private get ffmpeg() {
    return env().FFMPEG_PATH || "ffmpeg";
  }

  private get ffprobe() {
    return env().FFPROBE_PATH || "ffprobe";
  }

  async ffmpegAvailable(): Promise<boolean> {
    if (this.ffmpegReady === null) {
      this.ffmpegReady = await run(this.ffmpeg, ["-version"]).then(() => run(this.ffprobe, ["-version"])).then(() => true, () => false);
      if (!this.ffmpegReady) this.logger.warn("ffmpeg introuvable : les vidéos sont stockées sans compression (installer ffmpeg ou renseigner FFMPEG_PATH).");
    }
    return this.ffmpegReady;
  }

  /** Met un clip dans la file de compression (un à la fois pour ne pas saturer le serveur). */
  enqueue(clipId: string) {
    this.queue = this.queue.then(() => this.process(clipId)).catch((e) => this.logger.error(`Compression du clip ${clipId} impossible`, e as Error));
    return this.queue;
  }

  /** Compresse un clip : vidéo 720p + image d'aperçu. Retourne false si rien n'a été fait. */
  async process(clipId: string): Promise<boolean> {
    if (!(await this.ffmpegAvailable())) return false;
    const lock = await this.redis.set(`clip:processing:${clipId}`, "1", "EX", 600, "NX");
    if (!lock) return false;
    const dir = await mkdtemp(path.join(tmpdir(), "rankguess-"));
    try {
      const clip = await this.prisma.clip.findUnique({ where: { id: clipId } });
      if (!clip || clip.processedAt || clip.deletedAt || clip.fileDeletedAt) return false;

      const input = path.join(dir, "input");
      await this.storage.download(clip.storageKey, input);
      const originalSize = (await stat(input)).size;

      // Fichier illisible ou qui n'est pas une vidéo : refusé (aucun fichier non vidéo n'est jamais servi aux joueurs)
      const probe = await run(this.ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=height:format=duration", "-of", "json", input])
        .then((r) => JSON.parse(r.stdout) as { streams?: { height?: number }[]; format?: { duration?: string } })
        .catch(() => null);
      const height = probe?.streams?.[0]?.height;
      const duration = Number(probe?.format?.duration);
      if (!height || !Number.isFinite(duration) || duration <= 0) {
        await this.prisma.clip.update({
          where: { id: clip.id },
          data: { status: "REJECTED", rejectionReason: "Le fichier envoyé n'est pas une vidéo lisible.", processedAt: new Date(), originalSizeBytes: originalSize },
        });
        this.logger.warn(`Clip ${clip.id} refusé : vidéo illisible`);
        return true;
      }

      const output = path.join(dir, "clip.mp4");
      const poster = path.join(dir, "poster.jpg");
      await run(this.ffmpeg, [
        "-y", "-v", "error", "-i", input, "-t", String(MAX_DURATION_SEC),
        "-vf", `scale=-2:'min(${MAX_HEIGHT},ih)'`,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "27", "-pix_fmt", "yuv420p", "-profile:v", "high",
        "-c:a", "aac", "-b:a", "96k", "-ac", "2",
        "-map_metadata", "-1", "-movflags", "+faststart",
        output,
      ], { timeout: 300_000 });
      await run(this.ffmpeg, ["-y", "-v", "error", "-ss", String(Math.min(1, duration / 2)), "-i", output, "-frames:v", "1", "-vf", "scale=-2:360", "-q:v", "4", poster], { timeout: 60_000 });

      const compressedSize = (await stat(output)).size;
      // Si la compression ne gagne rien (vidéo déjà légère), le fichier d'origine est gardé
      const keepOriginal = compressedSize >= originalSize && clip.storageKey.endsWith(".mp4");
      const videoKey = keepOriginal ? clip.storageKey : `clips/${randomUUID()}.mp4`;
      if (!keepOriginal) await this.storage.upload(videoKey, output, "video/mp4");
      const posterKey = `posters/${randomUUID()}.jpg`;
      await this.storage.upload(posterKey, poster, "image/jpeg");

      // L'ancien fichier n'est plus référencé : le nettoyage le supprime plus tard (un modérateur peut être en train de le regarder)
      await this.prisma.clip.update({
        where: { id: clip.id },
        data: {
          storageKey: videoKey,
          posterKey,
          durationSec: Math.min(duration, MAX_DURATION_SEC),
          processedAt: new Date(),
          originalSizeBytes: originalSize,
          sizeBytes: keepOriginal ? originalSize : compressedSize,
        },
      });
      this.logger.log(`Clip ${clip.id} compressé : ${(originalSize / 1e6).toFixed(1)} Mo → ${((keepOriginal ? originalSize : compressedSize) / 1e6).toFixed(1)} Mo`);
      return true;
    } finally {
      await rm(dir, { recursive: true, force: true });
      await this.redis.del(`clip:processing:${clipId}`);
    }
  }

  /** Clips pas encore compressés (envoyés pendant un arrêt, ou avant l'installation de ffmpeg). */
  async processPending(limit = 25) {
    if (!(await this.ffmpegAvailable())) return 0;
    const pending = await this.prisma.clip.findMany({
      where: { processedAt: null, deletedAt: null, fileDeletedAt: null, status: { in: ["PENDING_REVIEW", "APPROVED", "PROCESSING"] } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
    let done = 0;
    for (const c of pending) if (await this.process(c.id).catch(() => false)) done++;
    return done;
  }

  /** Chaque nuit à 3 h 30 UTC (une seule instance de l'API grâce au verrou Redis). */
  @Cron("30 3 * * *", { timeZone: "UTC" })
  async nightly() {
    const lock = await this.redis.set("storage:cleanup-lock", "1", "EX", 3600, "NX");
    if (!lock) return;
    try {
      await this.cleanup();
    } finally {
      await this.redis.del("storage:cleanup-lock");
    }
  }

  async cleanup(): Promise<CleanupReport> {
    const report: CleanupReport = { at: new Date().toISOString(), rejectedExpired: 0, deletedFiles: 0, freedBytes: 0, processed: 0, errors: 0 };
    report.processed = await this.processPending().catch(() => 0);

    // 1. Clips refusés depuis plus de 14 jours et clips supprimés : leurs fichiers ne servent plus
    const rejectedBefore = new Date(Date.now() - REJECTED_KEEP_DAYS * 86_400_000);
    const expired = await this.prisma.clip.updateMany({
      where: { fileDeletedAt: null, status: "REJECTED", OR: [{ reviewedAt: { lt: rejectedBefore } }, { reviewedAt: null, updatedAt: { lt: rejectedBefore } }] },
      data: { fileDeletedAt: new Date() },
    });
    report.rejectedExpired = expired.count;
    await this.prisma.clip.updateMany({ where: { fileDeletedAt: null, deletedAt: { not: null } }, data: { fileDeletedAt: new Date() } });

    // 2. Tout fichier qui n'est plus référencé (clip encore en service, photo de profil) est supprimé
    const used = new Set<string>();
    const live = await this.prisma.clip.findMany({ where: { fileDeletedAt: null }, select: { storageKey: true, posterKey: true, hlsKey: true } });
    for (const c of live) [c.storageKey, c.posterKey, c.hlsKey].forEach((k) => k && used.add(k));
    // Photos de profil en service (une photo remplacée ou retirée est supprimée tout de suite ; ceci rattrape un échec)
    for (const u of await this.prisma.user.findMany({ where: { avatarKey: { not: null } }, select: { avatarKey: true } })) used.add(u.avatarKey!);
    const orphanBefore = Date.now() - ORPHAN_AFTER_HOURS * 3_600_000;
    for (const obj of await this.storage.list()) {
      if (used.has(obj.key) || obj.lastModified.getTime() > orphanBefore) continue;
      try {
        if (/\.part$/.test(obj.key)) await this.storage.deleteLocalLeftover(obj.key);
        else await this.storage.delete(obj.key);
        report.deletedFiles++;
        report.freedBytes += obj.size;
      } catch (e) {
        report.errors++;
        this.logger.error(`Suppression de ${obj.key} impossible`, e as Error);
      }
    }
    await this.redis.set(LAST_CLEANUP_KEY, JSON.stringify(report));
    this.logger.log(`Nettoyage du stockage : ${report.deletedFiles} fichier(s), ${(report.freedBytes / 1e6).toFixed(1)} Mo libérés`);
    return report;
  }

  /** Tableau de bord du stockage (administration). */
  async overview() {
    const [objects, clips, last] = await Promise.all([
      this.storage.list(),
      this.prisma.clip.aggregate({
        where: { fileDeletedAt: null, processedAt: { not: null } },
        _count: true,
        _sum: { sizeBytes: true, originalSizeBytes: true },
      }),
      this.redis.get(LAST_CLEANUP_KEY),
    ]);
    const byFolder: Record<string, { files: number; bytes: number }> = {};
    for (const o of objects) {
      const folder = o.key.split("/")[0];
      byFolder[folder] ??= { files: 0, bytes: 0 };
      byFolder[folder].files++;
      byFolder[folder].bytes += o.size;
    }
    const [pending, live, rejected] = await Promise.all([
      this.prisma.clip.count({ where: { processedAt: null, deletedAt: null, fileDeletedAt: null, status: { not: "REJECTED" } } }),
      this.prisma.clip.count({ where: { fileDeletedAt: null } }),
      this.prisma.clip.count({ where: { fileDeletedAt: null, status: "REJECTED" } }),
    ]);
    return {
      driver: this.storage.driverName,
      ffmpeg: await this.ffmpegAvailable(),
      files: objects.length,
      totalBytes: objects.reduce((s, o) => s + o.size, 0),
      byFolder,
      clips: {
        withFiles: live,
        rejectedWithFiles: rejected,
        waitingCompression: pending,
        compressed: clips._count,
        savedBytes: (clips._sum.originalSizeBytes ?? 0) - (clips._sum.sizeBytes ?? 0),
      },
      rules: { maxHeight: MAX_HEIGHT, rejectedKeepDays: REJECTED_KEEP_DAYS, orphanAfterHours: ORPHAN_AFTER_HOURS },
      lastCleanup: last ? (JSON.parse(last) as CleanupReport) : null,
    };
  }
}
