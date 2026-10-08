import { z } from "zod";

// ---------- Récompenses : titres, badges, cadres d'avatar ----------

export const CosmeticType = z.enum(["TITLE", "BADGE", "FRAME"]);
export type CosmeticType = z.infer<typeof CosmeticType>;
export const COSMETIC_TYPE_LABEL: Record<CosmeticType, string> = { TITLE: "Titre", BADGE: "Badge", FRAME: "Cadre" };
export const COSMETIC_TYPE_PLURAL: Record<CosmeticType, string> = { TITLE: "Titres", BADGE: "Badges", FRAME: "Cadres" };

export const CosmeticSource = z.enum(["MANUAL", "LEVEL", "ACHIEVEMENT", "SEASON"]);
export type CosmeticSource = z.infer<typeof CosmeticSource>;
export const COSMETIC_SOURCE_LABEL: Record<CosmeticSource, string> = {
  MANUAL: "Attribué par l'équipe",
  LEVEL: "Palier de niveau",
  ACHIEVEMENT: "Succès",
  SEASON: "Classement de saison",
};

/**
 * Icônes des badges (traits sur une grille 24 × 24, dessinés avec la couleur du badge).
 * Partagées par le site, l'application et l'administration.
 */
export const BADGE_ICONS = {
  star: { label: "Étoile", paths: ["M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6l-5.4 2.9 1.2-6-4.5-4.2 6.1-.7z"] },
  crown: { label: "Couronne", paths: ["M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"] },
  trophy: { label: "Trophée", paths: ["M8 4h8v5a4 4 0 0 1-8 0z", "M8 6H5a3 3 0 0 0 3 4", "M16 6h3a3 3 0 0 1-3 4", "M12 13v4", "M8 20h8"] },
  medal: { label: "Médaille", paths: ["M7 3l3 6", "M17 3l-3 6", "M7 15a5 5 0 1 0 10 0a5 5 0 1 0 -10 0", "M12 13v4"] },
  video: { label: "Vidéo", paths: ["M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z", "M10 9l5 3-5 3z"] },
  live: { label: "Direct", paths: ["M10 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0", "M7.8 7.8a6 6 0 0 0 0 8.4", "M16.2 7.8a6 6 0 0 1 0 8.4", "M5 5a10 10 0 0 0 0 14", "M19 5a10 10 0 0 1 0 14"] },
  mic: { label: "Micro", paths: ["M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0z", "M5 11a7 7 0 0 0 14 0", "M12 18v3"] },
  camera: { label: "Caméra", paths: ["M4 8h3l2-3h6l2 3h3v11H4z", "M9 13a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"] },
  shield: { label: "Bouclier", paths: ["M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z", "M9 12l2 2 4-4"] },
  flame: { label: "Flamme", paths: ["M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-5.5 1-8.5z"] },
  bolt: { label: "Éclair", paths: ["M13 3L5 14h6l-1 7 8-11h-6z"] },
  heart: { label: "Cœur", paths: ["M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"] },
  gem: { label: "Diamant", paths: ["M6 4h12l3 5-9 11L3 9z", "M3 9h18", "M9 4l3 5 3-5"] },
  target: { label: "Cible", paths: ["M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0", "M7 12a5 5 0 1 0 10 0a5 5 0 1 0 -10 0", "M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"] },
  eye: { label: "Œil", paths: ["M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z", "M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"] },
  sparkles: { label: "Étincelles", paths: ["M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8z", "M19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z"] },
  swords: { label: "Épées", paths: ["M4 4l9 9", "M4 4h4l9 9", "M20 4l-9 9", "M20 4h-4l-3 3", "M6 17l3 3", "M15 20l3-3", "M3 21l3-3", "M21 21l-3-3"] },
  code: { label: "Code", paths: ["M8 7l-5 5 5 5", "M16 7l5 5-5 5", "M14 4l-4 16"] },
} as const satisfies Record<string, { label: string; paths: readonly string[] }>;
export type BadgeIcon = keyof typeof BADGE_ICONS;
export const BADGE_ICON_KEYS = Object.keys(BADGE_ICONS) as BadgeIcon[];

/** Couleurs proposées dans l'administration (n'importe quelle couleur #RRGGBB est acceptée) */
export const COSMETIC_COLORS = [
  "#F5F3FF", "#A78BFA", "#8B5CF6", "#22D3EE", "#38BDF8", "#34D399", "#A3E635",
  "#FACC15", "#F59E0B", "#CD7F32", "#F97316", "#EF4444", "#F472B6", "#9CA3AF",
] as const;

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Couleur au format #RRGGBB");

/** Récompense telle qu'affichée à côté d'un joueur */
export const CosmeticRefDto = z.object({
  id: z.string().uuid(),
  type: CosmeticType,
  name: z.string(),
  color: z.string(),
  color2: z.string().nullable(),
  icon: z.string().nullable(),
  /** Comment l'obtenir : « Succès « Œil de lynx » », « Niveau 20 », « Champion de la saison 1 », « Attribué par l'équipe »… */
  hint: z.string(),
});
export type CosmeticRefDto = z.infer<typeof CosmeticRefDto>;

/** Récompenses équipées par un joueur : titre sous le pseudo, badge à côté, cadre autour de l'avatar */
export const FlairDto = z.object({
  title: CosmeticRefDto.nullable(),
  badge: CosmeticRefDto.nullable(),
  frame: CosmeticRefDto.nullable(),
});
export type FlairDto = z.infer<typeof FlairDto>;
export const NO_FLAIR: FlairDto = { title: null, badge: null, frame: null };

export const OwnedCosmeticDto = CosmeticRefDto.extend({
  description: z.string().nullable(),
  source: CosmeticSource,
  grantedAt: z.string(),
  /** Obtenue depuis la dernière visite de l'écran des récompenses */
  isNew: z.boolean(),
});
export type OwnedCosmeticDto = z.infer<typeof OwnedCosmeticDto>;

export const CosmeticUnlockDto = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("level"), level: z.number().int() }),
  z.object({ kind: z.literal("achievement"), achievement: z.string() }),
]);
export type CosmeticUnlockDto = z.infer<typeof CosmeticUnlockDto>;

export const LockedCosmeticDto = CosmeticRefDto.extend({ description: z.string().nullable(), unlock: CosmeticUnlockDto });
export type LockedCosmeticDto = z.infer<typeof LockedCosmeticDto>;

export const MyRewardsDto = z.object({
  level: z.number().int(),
  equipped: FlairDto,
  owned: z.array(OwnedCosmeticDto),
  /** Récompenses encore à gagner (paliers de niveau triés, puis succès) */
  locked: z.array(LockedCosmeticDto),
});
export type MyRewardsDto = z.infer<typeof MyRewardsDto>;

/** Équiper ou retirer (null) un titre, un badge ou un cadre ; un champ absent ne change pas */
export const EquipFlairInput = z.object({
  titleId: z.string().uuid().nullable().optional(),
  badgeId: z.string().uuid().nullable().optional(),
  frameId: z.string().uuid().nullable().optional(),
});
export type EquipFlairInput = z.infer<typeof EquipFlairInput>;

// ---------- Administration des récompenses ----------

export const CosmeticInput = z
  .object({
    type: CosmeticType,
    name: z.string().trim().min(2, "2 caractères minimum").max(40, "40 caractères maximum"),
    description: z.string().trim().max(200, "200 caractères maximum").nullable().optional(),
    color: HexColor,
    color2: HexColor.nullable().optional(),
    icon: z.enum(BADGE_ICON_KEYS as [BadgeIcon, ...BadgeIcon[]]).nullable().optional(),
    unlockLevel: z.number().int().min(2, "Niveau 2 minimum").max(500).nullable().optional(),
    unlockAchievementId: z.string().uuid().nullable().optional(),
    isActive: z.boolean().default(true),
  })
  .refine((c) => c.type !== "BADGE" || !!c.icon, { message: "Choisis une icône pour le badge.", path: ["icon"] })
  .refine((c) => !(c.unlockLevel && c.unlockAchievementId), { message: "Choisis un seul déblocage automatique : niveau ou succès.", path: ["unlockLevel"] });
export type CosmeticInput = z.input<typeof CosmeticInput>;

export const AdminCosmeticDto = CosmeticRefDto.extend({
  key: z.string(),
  description: z.string().nullable(),
  unlockLevel: z.number().int().nullable(),
  unlockAchievement: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  isActive: z.boolean(),
  owners: z.number().int(),
  createdAt: z.string(),
});
export type AdminCosmeticDto = z.infer<typeof AdminCosmeticDto>;

export const CosmeticHolderDto = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  source: CosmeticSource,
  note: z.string().nullable(),
  grantedAt: z.string(),
  grantedBy: z.string().nullable(),
});
export type CosmeticHolderDto = z.infer<typeof CosmeticHolderDto>;

/** Attribution manuelle : par l'identifiant du joueur (fiche joueur) ou par son pseudo (page de la récompense) */
export const GrantCosmeticInput = z
  .object({
    cosmeticId: z.string().uuid().optional(),
    pseudo: z.string().trim().min(1).max(32).optional(),
    note: z.string().trim().max(200).nullable().optional(),
  });
export type GrantCosmeticInput = z.input<typeof GrantCosmeticInput>;

// ---------- Photo de profil ----------

/** Taille maximale d'une photo de profil envoyée (elle est ensuite réduite à 256 × 256) */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

// ---------- Modération du chat global ----------

export const SLOW_MODE_CHOICES = [0, 5, 10, 30, 60, 120] as const;

export const ChatSettingsDto = z.object({
  /** Mots refusés dans le chat global et les messages privés (comparés sans accents ni majuscules) */
  bannedWords: z.array(z.string()),
  /** Délai minimum entre deux messages d'un même joueur dans le chat global (0 = désactivé) */
  slowModeSec: z.number().int(),
  /** Nombre de signalements différents qui masquent un message en attendant la modération (0 = jamais) */
  autoHideReports: z.number().int(),
});
export type ChatSettingsDto = z.infer<typeof ChatSettingsDto>;
export const DEFAULT_CHAT_SETTINGS: ChatSettingsDto = { bannedWords: [], slowModeSec: 0, autoHideReports: 3 };

export const ChatSettingsInput = z.object({
  bannedWords: z.array(z.string().trim().min(2, "2 caractères minimum par mot").max(40)).max(500).optional(),
  slowModeSec: z.number().int().min(0).max(600).optional(),
  autoHideReports: z.number().int().min(0).max(20).optional(),
});
export type ChatSettingsInput = z.infer<typeof ChatSettingsInput>;

/** Texte comparé au filtre : minuscules, sans accents, chiffres et symboles courants remplacés par des lettres */
export function normalizeForFilter(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[0134578@$€]/g, (c) => ({ "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", $: "s", "€": "e" })[c]!)
    // Lettres répétées ramenées à une seule (« nuuuul » = « nul ») ; le mot interdit est normalisé de la même façon
    .replace(/(.)\1+/g, "$1");
}

/** Premier mot interdit trouvé dans le message (mot entier, aussi s'il est écrit avec des points ou des espaces entre les lettres) */
export function findBannedWord(text: string, banned: readonly string[]): string | null {
  if (!banned.length) return null;
  const norm = normalizeForFilter(text);
  const words = ` ${norm.replace(/[^a-z0-9]+/g, " ")} `;
  const squashed = norm.replace(/[^a-z0-9]/g, "");
  for (const raw of banned) {
    const w = normalizeForFilter(raw).replace(/[^a-z0-9 ]+/g, " ").trim();
    if (!w) continue;
    if (words.includes(` ${w} `)) return raw;
    // « c.o.n », « c o n » : lettres isolées séparées par des symboles ou des espaces
    if (w.length >= 3 && !w.includes(" ") && squashed.includes(w) && new RegExp(`(^|[^a-z0-9])${w.split("").join("[^a-z0-9]+")}($|[^a-z0-9])`).test(norm)) return raw;
  }
  return null;
}

// ---------- Pseudos ----------

/** Pseudos réservés : se faire passer pour l'équipe ou le site */
const RESERVED_PSEUDOS = [
  "admin", "administrateur", "administrator", "modo", "moderateur", "moderator", "moderation", "rankguess", "staff", "support",
  "system", "systeme", "officiel", "official", "equipe", "team", "root", "bot",
];
const RESERVED_PREFIXES = ["admin", "rankguess", "moderat", "staff"];
const RESERVED_SUFFIXES = ["admin", "modo", "staff", "rankguess", "officiel", "official"];

const squash = (s: string) => normalizeForFilter(s).replace(/[^a-z0-9]/g, "");

/** Pseudo qui imite l'équipe ou le site (« Admin », « RankGuess_Officiel », « Paul_Modo »…) */
export function isReservedPseudo(pseudo: string): boolean {
  const squashed = squash(pseudo);
  // Les listes passent par la même normalisation que le pseudo (« staff » devient « staf »)
  return (
    RESERVED_PSEUDOS.some((w) => squashed === squash(w)) ||
    RESERVED_PREFIXES.some((p) => squashed.startsWith(squash(p))) ||
    RESERVED_SUFFIXES.some((p) => squashed.endsWith(squash(p)))
  );
}

/** Mot interdit du chat contenu dans un pseudo (aussi collé à d'autres lettres : « XxMotxX ») */
export function pseudoBannedWord(pseudo: string, banned: readonly string[]): string | null {
  const squashed = squash(pseudo);
  for (const raw of banned) {
    const w = squash(raw);
    // Les mots très courts ne sont cherchés qu'en entier, pour éviter de bloquer des pseudos innocents
    if (w.length >= 4 ? squashed.includes(w) : squashed === w) return raw;
  }
  return null;
}

// ---------- Annonce affichée sur le site et l'application ----------

export const AnnouncementTone = z.enum(["info", "event", "warning"]);
export type AnnouncementTone = z.infer<typeof AnnouncementTone>;
export const ANNOUNCEMENT_TONE_LABEL: Record<AnnouncementTone, string> = { info: "Information", event: "Événement", warning: "Maintenance ou incident" };

export const AnnouncementDto = z.object({
  id: z.string(),
  text: z.string(),
  tone: AnnouncementTone,
  /** Lien facultatif (page du site ou adresse externe) */
  link: z.string().nullable(),
  /** Fin d'affichage automatique (null = jusqu'au retrait) */
  until: z.string().nullable(),
});
export type AnnouncementDto = z.infer<typeof AnnouncementDto>;

export const AnnouncementInput = z.object({
  text: z.string().trim().min(3, "3 caractères minimum").max(200, "200 caractères maximum"),
  tone: AnnouncementTone.default("info"),
  link: z
    .string()
    .trim()
    .max(300)
    .refine((v) => /^\/[\w\-/?=&#.%]*$/.test(v) || /^https:\/\/[^\s]+$/.test(v), "Lien : chemin du site (/leaderboard) ou adresse https://")
    .nullable()
    .optional(),
  until: z.string().datetime({ offset: true }).nullable().optional(),
});
export type AnnouncementInput = z.input<typeof AnnouncementInput>;
