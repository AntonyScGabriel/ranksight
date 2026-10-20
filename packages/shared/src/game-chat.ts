/**
 * Tchat d'un salon (salle d'attente et partie, avec un canal d'équipe en duel par équipes) et d'un tournoi (tous les
 * inscrits, jusqu'à la fin du tournoi). Les messages restent lisibles après la fin, l'envoi est alors fermé.
 */
import { z } from "zod";
import { FlairDto } from "./rewards.js";
import { UserRole } from "./schemas.js";

export const GAME_CHAT_MAX = 300;

export const GameChatScope = z.enum(["room", "tournament"]);
export type GameChatScope = z.infer<typeof GameChatScope>;

export const SendGameChatInput = z
  .object({
    body: z.string().trim().min(1, "Message vide").max(GAME_CHAT_MAX, `${GAME_CHAT_MAX} caractères maximum`),
    /** Duel par équipes : message réservé à son équipe */
    team: z.boolean().default(false),
  })
  .strict();
export type SendGameChatInput = z.input<typeof SendGameChatInput>;

export const GameChatMessageDto = z.object({
  id: z.string().uuid(),
  body: z.string(),
  createdAt: z.string(),
  /** Canal d'équipe (1 ou 2), null = tout le salon ou tout le tournoi */
  team: z.number().int().nullable(),
  author: z.object({
    id: z.string().uuid(),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
    role: UserRole,
    vip: z.boolean(),
    flair: FlairDto,
  }),
});
export type GameChatMessageDto = z.infer<typeof GameChatMessageDto>;

export const GameChatDto = z.object({
  messages: z.array(GameChatMessageDto),
  /** Envoi possible (salon en attente ou en partie, tournoi pas terminé, joueur toujours présent) */
  open: z.boolean(),
  /** Équipe du joueur (duel par équipes) : il voit et peut écrire sur le canal de son équipe */
  myTeam: z.number().int().nullable(),
  /** Organisateur du tournoi ou équipe de modération : supprimer des messages, réduire un joueur au silence */
  canModerate: z.boolean().default(false),
  /** Le joueur a été réduit au silence dans ce tchat */
  muted: z.boolean().default(false),
});
export type GameChatDto = z.infer<typeof GameChatDto>;

/** Événement temps réel (connexion du chat) : nouveau message (`message`) ou message supprimé (`deletedId`) d'un salon ou d'un tournoi du joueur */
export const GAME_CHAT_EVENT = "gamechat:message";
export type GameChatEvent = { scope: GameChatScope; id: string; message?: GameChatMessageDto; deletedId?: string };

export const MuteGameChatInput = z.object({ muted: z.boolean() }).strict();
