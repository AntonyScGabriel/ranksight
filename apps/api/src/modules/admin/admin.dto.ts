import { z } from "zod";
import { CLIP_MAX_BYTES, CLIP_MAX_SEC, CLIP_MIN_SEC, DAILY_PER_GAME, InGamePseudo, Platform, Region } from "@ranksight/shared";

export const UploadUrlBody = z.object({
  contentType: z.enum(["video/mp4", "video/webm"]),
  sizeBytes: z.number().int().positive().max(CLIP_MAX_BYTES),
});

export const CreateClipBody = z.object({
  gameId: z.string().uuid(),
  rankId: z.string().uuid(),
  storageKey: z.string().startsWith("raw/"),
  posterKey: z.string().optional(),
  durationSec: z.number().min(CLIP_MIN_SEC - 0.3).max(CLIP_MAX_SEC + 0.5),
  difficulty: z.number().int().min(1).max(5).default(3),
  proofUrl: z.string().url().optional(),
  /** Pseudo en jeu du joueur filmé (facultatif pour un clip ajouté par l'équipe) */
  inGamePseudo: InGamePseudo.optional(),
  platform: Platform.optional(),
  region: Region.optional(),
  creatorConsent: z.literal(true, { message: "Le consentement du créateur est obligatoire" }),
});

export const ReviewClipBody = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("APPROVE"), rankId: z.string().uuid().optional(), difficulty: z.number().int().min(1).max(5).optional() }),
  z.object({ decision: z.literal("REJECT"), reason: z.string().trim().min(3, "Indique la raison du refus").max(300) }),
]);

export const ConfirmTriageBody = z.object({ ids: z.array(z.string().uuid()).min(1).max(50) });

/** Planification du défi d'un jour pour un jeu : le jeu est celui du clip choisi. */
export const ScheduleDailyBody = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  clipId: z.string().uuid(),
  /** Numéro du défi (1 à DAILY_PER_GAME) ; absent = première place libre de la journée */
  slot: z.number().int().min(1).max(DAILY_PER_GAME).optional(),
});

export const UpdateUserBody = z
  .object({
    role: z.enum(["USER", "REVIEWER", "MODERATOR", "ADMIN", "OWNER"]),
    status: z.enum(["ACTIVE", "SUSPENDED", "BANNED"]),
  })
  .partial()
  .strict();

export const ResolveReportBody = z.object({
  status: z.enum(["RESOLVED", "DISMISSED"]),
  resolution: z.string().max(500),
  archiveClip: z.boolean().default(false),
});

export const AchievementBody = z.object({
  code: z.string().regex(/^[A-Z0-9_]{3,40}$/),
  name: z.string().min(2).max(60),
  description: z.string().max(200),
  iconUrl: z.string().url().optional(),
  category: z.enum(["PROGRESSION", "STREAK", "ACCURACY", "GAME_EXPERT", "SOCIAL", "SEASON", "VERSUS", "SECRET"]),
  gameId: z.string().uuid().optional(),
  criteria: z.record(z.string(), z.unknown()),
  xpReward: z.number().int().min(0).max(5000).default(0),
  isHidden: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
