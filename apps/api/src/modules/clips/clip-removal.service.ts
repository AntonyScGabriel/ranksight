import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";

/**
 * Suppression d'un clip, quel que soit son statut (en attente, accepté, refusé) :
 * - jamais joué : supprimé de la base et du stockage ;
 * - déjà joué : retiré partout (deletedAt), les réponses restent pour ne pas fausser les scores des joueurs.
 * Les défis du jour qui l'utilisaient sans réponse sont libérés ; le défi du jour en cours est remplacé
 * par un autre clip du jeu dès la requête suivante, même si des joueurs y ont déjà répondu (ils gardent leur résultat).
 */
@Injectable()
export class ClipRemovalService {
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService) {}

  private async deleteFiles(clip: { storageKey: string; posterKey: string | null; hlsKey: string | null }) {
    for (const key of [clip.storageKey, clip.posterKey, clip.hlsKey]) {
      // Un échec (service de stockage indisponible) est rattrapé par le nettoyage de la nuit
      if (key) await this.storage.delete(key).catch(() => undefined);
    }
  }

  async remove(clipId: string): Promise<"deleted" | "archived" | "missing"> {
    const clip = await this.prisma.clip.findUnique({ where: { id: clipId }, include: { _count: { select: { guesses: true } } } });
    if (!clip || clip.deletedAt) return "missing";

    await this.prisma.dailyChallenge.deleteMany({ where: { clipId, guesses: { none: {} } } });
    if (clip._count.guesses === 0 && (await this.prisma.dailyChallenge.count({ where: { clipId } })) === 0) {
      await this.prisma.clip.delete({ where: { id: clipId } });
      await this.deleteFiles(clip);
      return "deleted";
    }
    // Déjà joué : la fiche reste (statistiques), la vidéo est supprimée du stockage
    await this.prisma.clip.update({ where: { id: clipId }, data: { status: "ARCHIVED", deletedAt: new Date(), fileDeletedAt: new Date() } });
    await this.deleteFiles(clip);
    return "archived";
  }
}
