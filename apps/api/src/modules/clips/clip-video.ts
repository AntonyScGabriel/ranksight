import { clipEmbedUrl, clipLinkPageUrl, type ClipVideoKind } from "@ranksight/shared";
import { Prisma, type ClipLinkProvider } from "../../generated/prisma/client.js";
import { env } from "../../config/env.js";
import type { StorageService } from "../storage/storage.service.js";

type VideoFields = {
  storageKey: string; hlsKey?: string | null; posterKey?: string | null; durationSec: number;
  linkProvider: ClipLinkProvider | null; linkVideoId: string | null; linkStartSec: number | null;
};

/**
 * Vidéo d'un clip pour les lecteurs : fichier stocké (adresse signée, version compressée si elle existe) ou, pour un
 * clip proposé par un lien, adresse du lecteur intégré YouTube / Medal limitée au passage choisi (pas d'aperçu : la
 * miniature YouTube peut montrer le rang).
 */
export async function clipVideo(storage: StorageService, clip: VideoFields, ttlSec?: number): Promise<{ videoUrl: string; videoKind: ClipVideoKind; posterUrl: string | null }> {
  if (clip.linkProvider && clip.linkVideoId) {
    return { videoUrl: clipEmbedUrl(clip.linkProvider, clip.linkVideoId, clip.linkStartSec ?? 0, clip.durationSec), videoKind: clip.linkProvider, posterUrl: null };
  }
  return {
    videoUrl: await storage.signedReadUrl(clip.hlsKey ?? clip.storageKey, ttlSec),
    videoKind: "FILE",
    posterUrl: clip.posterKey ? await storage.signedReadUrl(clip.posterKey, ttlSec) : null,
  };
}

/** Page d'origine d'un clip proposé par un lien (modération), null pour un fichier */
export function clipLinkUrl(clip: Pick<VideoFields, "linkProvider" | "linkVideoId">): string | null {
  return clip.linkProvider && clip.linkVideoId ? clipLinkPageUrl(clip.linkProvider, clip.linkVideoId) : null;
}

/**
 * Les clips à lien n'entrent dans les parties qu'avec LINK_CLIPS_IN_GAMES=true : les versions de l'application
 * antérieures à la 0.3.0 ne savent pas lire un lecteur YouTube / Medal. Ils s'envoient et se valident dans tous les cas.
 */
export const linkClipsPlayable = () => env().LINK_CLIPS_IN_GAMES;
/** Filtre Prisma à ajouter au tirage des clips jouables */
export const playableLinkWhere = (): { linkProvider?: null } => (linkClipsPlayable() ? {} : { linkProvider: null });
/** Même filtre pour les requêtes SQL (alias « c » de la table clips) */
export const playableLinkSql = () => (linkClipsPlayable() ? Prisma.empty : Prisma.sql`AND c.link_provider IS NULL`);
