import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { GAME_PLATFORMS, clipLinkKey, parseClipLink, type GameSlug, type MyClipDto, type SubmissionStatus, type SubmitClipInput, type UploadUrlInput } from "@ranksight/shared";
import type { ClipLinkProvider, ClipStatus } from "../../generated/prisma/client.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import { ModerationService } from "../moderation/moderation.service.js";
import { ClipProcessingService } from "./clip-processing.service.js";
import { ClipRemovalService } from "./clip-removal.service.js";
import { clipLinkUrl, clipVideo } from "./clip-video.js";
import { canHostVipGames } from "../shop/vip.js";

/** Nombre maximum de clips en attente de validation par joueur (plus pour les VIP et l'administration). */
const MAX_PENDING_PER_USER = 25;
const MAX_PENDING_PER_VIP = 50;

export function submissionStatus(status: ClipStatus): SubmissionStatus {
  if (status === "APPROVED") return "ACCEPTED";
  if (status === "REJECTED" || status === "ARCHIVED") return "REJECTED";
  return "PENDING";
}

/** Clips proposés par les joueurs : envoi, suivi ("Mes clips") et retrait d'un clip en attente. */
@Injectable()
export class SubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly removal: ClipRemovalService,
    private readonly processing: ClipProcessingService,
    private readonly moderation: ModerationService,
  ) {}

  async uploadUrl(userId: string, input: UploadUrlInput) {
    await this.moderation.assertVerified(userId);
    await this.assertQuota(userId);
    return this.storage.createUploadUrl(input.contentType, input.sizeBytes);
  }

  async submit(userId: string, input: SubmitClipInput): Promise<MyClipDto> {
    await this.moderation.assertVerified(userId);
    await this.assertQuota(userId);
    const rank = await this.prisma.rank.findUnique({ where: { id: input.rankId }, include: { game: true } });
    if (!rank || rank.gameId !== input.gameId || !rank.game.isActive) throw new BadRequestException("Ce rang n'appartient pas à ce jeu.");
    if (input.platform && !(GAME_PLATFORMS[rank.game.slug as GameSlug] ?? []).includes(input.platform)) {
      throw new BadRequestException(`Cette plateforme n'existe pas pour ${rank.game.name}.`);
    }
    // Lien YouTube / Medal : rien à recevoir ni à compresser, la vidéo reste chez le fournisseur
    const link = input.link ? parseClipLink(input.link) : null;
    if (input.link && !link) throw new BadRequestException("Seuls les liens YouTube et Medal sont acceptés.");
    const startSec = link?.provider === "YOUTUBE" ? (input.startSec ?? link.startSec ?? 0) : 0;
    const storageKey = link ? clipLinkKey(link.provider, link.videoId, startSec) : input.storageKey!;
    if (!link && !(await this.storage.exists(storageKey))) {
      throw new BadRequestException("La vidéo n'a pas été reçue. Réessaie l'envoi.");
    }
    if (await this.prisma.clip.findUnique({ where: { storageKey } })) {
      throw new ConflictException(link ? "Ce passage de cette vidéo a déjà été proposé." : "Cette vidéo a déjà été proposée.");
    }

    const clip = await this.prisma.clip.create({
      data: {
        gameId: input.gameId,
        rankId: input.rankId,
        uploaderId: userId,
        source: "COMMUNITY",
        status: "PENDING_REVIEW",
        storageKey,
        ...(link ? { linkProvider: link.provider, linkVideoId: link.videoId, linkStartSec: link.provider === "YOUTUBE" ? startSec : null, processedAt: new Date() } : {}),
        durationSec: input.durationSec,
        inGamePseudo: input.inGamePseudo,
        platform: input.platform ?? null,
        region: input.region ?? null,
        proofUrl: input.proofUrl,
        submitterNote: input.note,
        creatorConsent: true,
      },
      include: { game: true, rank: true },
    });
    // Compression en arrière-plan (720p) ; le joueur n'attend pas
    if (!link) void this.processing.enqueue(clip.id);
    return this.toDto(clip);
  }

  async mine(userId: string): Promise<MyClipDto[]> {
    const clips = await this.prisma.clip.findMany({
      where: { uploaderId: userId, deletedAt: null },
      include: { game: true, rank: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return Promise.all(clips.map((c) => this.toDto(c)));
  }

  /** Le joueur peut supprimer n'importe lequel de ses clips : en attente, accepté ou refusé. */
  async withdraw(userId: string, clipId: string) {
    const clip = await this.prisma.clip.findUnique({ where: { id: clipId }, select: { uploaderId: true, deletedAt: true } });
    if (!clip || clip.uploaderId !== userId || clip.deletedAt) throw new NotFoundException("Clip introuvable.");
    await this.removal.remove(clipId);
  }

  private async assertQuota(userId: string) {
    const [pending, vip] = await Promise.all([
      this.prisma.clip.count({ where: { uploaderId: userId, status: { in: ["PENDING_REVIEW", "PROCESSING"] }, deletedAt: null } }),
      canHostVipGames(this.prisma, userId),
    ]);
    const max = vip ? MAX_PENDING_PER_VIP : MAX_PENDING_PER_USER;
    if (pending >= max) {
      const more = vip ? "" : ` Les VIP peuvent en avoir ${MAX_PENDING_PER_VIP}.`;
      throw new ConflictException({ code: "TOO_MANY_PENDING", message: `Tu as déjà ${max} clips en attente de validation.${more}` });
    }
  }

  /** Aperçu dans « Mes clips » : la vidéo d'origine (sans compression) ou le lecteur intégré du lien */
  private async preview(c: Parameters<typeof clipVideo>[1]) {
    const { videoUrl, videoKind } = await clipVideo(this.storage, { ...c, hlsKey: null, posterKey: null });
    return { previewUrl: videoUrl, videoKind };
  }

  private async toDto(c: {
    id: string; status: ClipStatus; rejectionReason: string | null;
    inGamePseudo: string | null; platform: string | null; region: string | null; timesPlayed: number; createdAt: Date; reviewedAt: Date | null; storageKey: string; fileDeletedAt: Date | null;
    durationSec: number; linkProvider: ClipLinkProvider | null; linkVideoId: string | null; linkStartSec: number | null;
    game: { slug: string; name: string }; rank: { name: string; color: string };
  }): Promise<MyClipDto> {
    const status = submissionStatus(c.status);
    return {
      id: c.id,
      game: { slug: c.game.slug, name: c.game.name },
      rank: { name: c.rank.name, color: c.rank.color },
      inGamePseudo: c.inGamePseudo,
      platform: c.platform,
      region: c.region,
      status,
      rejectionReason: status === "REJECTED" ? c.rejectionReason ?? "Ce clip ne respecte pas les règles de publication." : null,
      timesPlayed: c.timesPlayed,
      createdAt: c.createdAt.toISOString(),
      reviewedAt: c.reviewedAt?.toISOString() ?? null,
      // Vidéo d'un clip refusé depuis plus de 14 jours : supprimée du stockage (un clip à lien reste lisible)
      ...(c.fileDeletedAt && !c.linkProvider ? { previewUrl: null, videoKind: "FILE" as const } : await this.preview(c)),
      linkUrl: clipLinkUrl(c),
    };
  }
}
