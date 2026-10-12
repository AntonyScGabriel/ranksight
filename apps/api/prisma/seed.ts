import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

config({ path: "../../.env", quiet: true });
config({ quiet: true });

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

/**
 * Catalogue : League of Legends, Valorant, Rocket League et Counter-Strike 2 (classement Premier).
 * Échelles au niveau "tier" (sans divisions) : 1 cran = 1 rang d'écart dans le barème.
 * Les divisions (Gold 2, Diamond 4…) rendraient le jeu frustrant et la preuve plus difficile.
 */
const GAMES: { slug: string; name: string; accent: string; ranks: [string, string][] }[] = [
  { slug: "lol", name: "League of Legends", accent: "#C8AA6E", ranks: [
    ["Iron", "#5E5550"], ["Bronze", "#8C5A3C"], ["Silver", "#9FA9B4"], ["Gold", "#D4A94E"], ["Platinum", "#4BA3A0"],
    ["Emerald", "#2BA36B"], ["Diamond", "#6F8FE8"], ["Master", "#B05BE0"], ["Grandmaster", "#E04848"], ["Challenger", "#F2D27A"],
  ] },
  { slug: "valorant", name: "Valorant", accent: "#FF4655", ranks: [
    ["Iron", "#5E5E5E"], ["Bronze", "#A4703D"], ["Silver", "#C0C6CC"], ["Gold", "#E6B84B"], ["Platinum", "#3EB4C6"],
    ["Diamond", "#C17BF0"], ["Ascendant", "#2FBF71"], ["Immortal", "#D8455D"], ["Radiant", "#FFF2A8"],
  ] },
  { slug: "rocket-league", name: "Rocket League", accent: "#1E90FF", ranks: [
    ["Bronze", "#A0673A"], ["Silver", "#B9C1C8"], ["Gold", "#E2B646"], ["Platinum", "#5CC7E0"], ["Diamond", "#3C6FE0"],
    ["Champion", "#A35BE8"], ["Grand Champion", "#E0484F"], ["Supersonic Legend", "#F5F5F5"],
  ] },
  { slug: "cs2", name: "Counter-Strike 2", accent: "#F2A93B", ranks: [
    ["0–4 999", "#B0B7C0"], ["5 000–9 999", "#8CC6EF"], ["10 000–14 999", "#4A7BE0"], ["15 000–19 999", "#9B5DE5"],
    ["20 000–24 999", "#E05BC4"], ["25 000–29 999", "#E5484D"], ["30 000+", "#F2C94C"],
  ] },
];

const ACHIEVEMENTS = [
  // Progression
  { code: "FIRST_GUESS", name: "Premier pas", description: "Donner sa première réponse", category: "PROGRESSION", criteria: { type: "total_guesses", threshold: 1 }, xpReward: 50 },
  { code: "GUESSES_100", name: "Habitué", description: "Donner 100 réponses", category: "PROGRESSION", criteria: { type: "total_guesses", threshold: 100 }, xpReward: 300 },
  { code: "GUESSES_1000", name: "Analyste", description: "Donner 1 000 réponses", category: "PROGRESSION", criteria: { type: "total_guesses", threshold: 1000 }, xpReward: 1500 },
  { code: "LEVEL_10", name: "Niveau 10", description: "Atteindre le niveau 10", category: "PROGRESSION", criteria: { type: "level", threshold: 10 }, xpReward: 300 },
  { code: "LEVEL_25", name: "Niveau 25", description: "Atteindre le niveau 25", category: "PROGRESSION", criteria: { type: "level", threshold: 25 }, xpReward: 1000 },
  { code: "INFINITE_2000", name: "Marathonien", description: "2 000 points en une partie Infinie", category: "PROGRESSION", criteria: { type: "infinite_score", threshold: 2000 }, xpReward: 500 },
  { code: "INFINITE_5000", name: "Increvable", description: "5 000 points en une partie Infinie", category: "PROGRESSION", criteria: { type: "infinite_score", threshold: 5000 }, xpReward: 1200 },
  // Précision
  { code: "FIRST_EXACT", name: "Première victoire", description: "Trouver le rang exact", category: "ACCURACY", criteria: { type: "exact_guesses", threshold: 1 }, xpReward: 100 },
  { code: "EXACT_100", name: "Œil de lynx", description: "100 réponses exactes", category: "ACCURACY", criteria: { type: "exact_guesses", threshold: 100 }, xpReward: 1000 },
  { code: "WIN_STREAK_5", name: "En forme", description: "Série de 5 victoires (rangs exacts d'affilée)", category: "ACCURACY", criteria: { type: "win_streak", threshold: 5 }, xpReward: 250 },
  { code: "WIN_STREAK_10", name: "Intouchable", description: "Série de 10 victoires (rangs exacts d'affilée)", category: "ACCURACY", criteria: { type: "win_streak", threshold: 10 }, xpReward: 600 },
  { code: "WIN_STREAK_25", name: "Machine", description: "Série de 25 victoires (rangs exacts d'affilée)", category: "ACCURACY", criteria: { type: "win_streak", threshold: 25 }, xpReward: 1500 },
  { code: "WIN_STREAK_50", name: "Radar humain", description: "Série de 50 victoires (rangs exacts d'affilée)", category: "ACCURACY", criteria: { type: "win_streak", threshold: 50 }, xpReward: 3000 },
  { code: "WIN_STREAK_100", name: "Légende", description: "Série de 100 victoires (rangs exacts d'affilée)", category: "ACCURACY", criteria: { type: "win_streak", threshold: 100 }, xpReward: 7500 },
  // Régularité (défis du jour)
  { code: "STREAK_7", name: "Semaine parfaite", description: "Série de 7 jours", category: "STREAK", criteria: { type: "daily_streak", threshold: 7 }, xpReward: 300 },
  { code: "STREAK_30", name: "Mois d'acier", description: "Série de 30 jours", category: "STREAK", criteria: { type: "daily_streak", threshold: 30 }, xpReward: 1500 },
  { code: "STREAK_100", name: "Centenaire", description: "Série de 100 jours", category: "STREAK", criteria: { type: "daily_streak", threshold: 100 }, xpReward: 5000 },
  { code: "DAILY_FULL_1", name: "Grand chelem", description: "Jouer tous les défis du jour (tous les jeux) le même jour", category: "STREAK", criteria: { type: "daily_full_days", threshold: 1 }, xpReward: 150 },
  { code: "DAILY_FULL_30", name: "Fidèle", description: "Jouer tous les défis du jour pendant 30 jours", category: "STREAK", criteria: { type: "daily_full_days", threshold: 30 }, xpReward: 2000 },
  { code: "DAILY_PERFECT", name: "Sans faute", description: "Trouver le rang exact à tous les défis d'une même journée", category: "STREAK", criteria: { type: "daily_perfect_days", threshold: 1 }, xpReward: 1000 },
  // Experts par jeu
  { code: "EXPERT_LOL", name: "Expert LoL", description: "50 rangs exacts sur League of Legends", category: "GAME_EXPERT", criteria: { type: "game_exact", game: "lol", threshold: 50 }, xpReward: 800 },
  { code: "EXPERT_VALORANT", name: "Expert Valorant", description: "50 rangs exacts sur Valorant", category: "GAME_EXPERT", criteria: { type: "game_exact", game: "valorant", threshold: 50 }, xpReward: 800 },
  { code: "EXPERT_ROCKET_LEAGUE", name: "Expert Rocket League", description: "50 rangs exacts sur Rocket League", category: "GAME_EXPERT", criteria: { type: "game_exact", game: "rocket-league", threshold: 50 }, xpReward: 800 },
  { code: "EXPERT_CS2", name: "Expert Counter-Strike 2", description: "50 rangs exacts sur Counter-Strike 2", category: "GAME_EXPERT", criteria: { type: "game_exact", game: "cs2", threshold: 50 }, xpReward: 800 },
  // Duels
  { code: "VERSUS_WIN_1", name: "Premier duel", description: "Gagner un duel", category: "VERSUS", criteria: { type: "versus_wins", threshold: 1 }, xpReward: 150 },
  { code: "VERSUS_WIN_10", name: "Duelliste", description: "Gagner 10 duels", category: "VERSUS", criteria: { type: "versus_wins", threshold: 10 }, xpReward: 800 },
  { code: "VERSUS_WIN_50", name: "Gladiateur", description: "Gagner 50 duels", category: "VERSUS", criteria: { type: "versus_wins", threshold: 50 }, xpReward: 3000 },
  // Communauté
  { code: "FIRST_FRIEND", name: "En équipe", description: "Avoir un premier ami", category: "SOCIAL", criteria: { type: "friends", threshold: 1 }, xpReward: 100 },
  { code: "FRIENDS_10", name: "Populaire", description: "Avoir 10 amis", category: "SOCIAL", criteria: { type: "friends", threshold: 10 }, xpReward: 500 },
  { code: "CLIP_ACCEPTED", name: "Réalisateur", description: "Voir un de ses clips accepté", category: "SOCIAL", criteria: { type: "accepted_clips", threshold: 1 }, xpReward: 300 },
  { code: "CLIPS_ACCEPTED_10", name: "Producteur", description: "10 clips acceptés", category: "SOCIAL", criteria: { type: "accepted_clips", threshold: 10 }, xpReward: 1500 },
  // Saisons (attribués à la clôture de chaque saison mensuelle, d'après le classement général)
  { code: "SEASON_1_CHAMPION", name: "Champion de la saison 1", description: "Terminer 1er du classement de la saison 1", category: "SEASON", criteria: { type: "season_rank", season: 1, maxRank: 1 }, xpReward: 5000 },
  { code: "SEASON_CHAMPION", name: "Champion de saison", description: "Terminer 1er du classement d'une saison", category: "SEASON", criteria: { type: "season_rank", maxRank: 1 }, xpReward: 3000 },
  { code: "SEASON_PODIUM", name: "Podium", description: "Terminer dans le top 3 d'une saison", category: "SEASON", criteria: { type: "season_rank", maxRank: 3 }, xpReward: 1500 },
  { code: "SEASON_TOP_10", name: "Top 10", description: "Terminer dans le top 10 d'une saison", category: "SEASON", criteria: { type: "season_rank", maxRank: 10 }, xpReward: 800 },
  // Secret
  { code: "SECRET_LEVEL_50", name: "Vétéran", description: "Atteindre le niveau 50", category: "SECRET", criteria: { type: "level", threshold: 50 }, xpReward: 2000, isHidden: true },
] as const;

type SeedCosmetic = {
  key: string; type: "TITLE" | "BADGE" | "FRAME"; name: string; description: string; color: string; color2?: string; icon?: string;
  unlockLevel?: number; achievement?: string;
};

/**
 * Récompenses de départ (créées une seule fois : l'équipe peut ensuite les modifier, les désactiver ou en ajouter).
 * Sans déblocage automatique = attribuées à la main depuis l'administration.
 */
const COSMETICS: SeedCosmetic[] = [
  // Attribuées par l'équipe
  { key: "title-youtubeur", type: "TITLE", name: "Youtubeur", description: "Créateur de vidéos sur RankGuess", color: "#EF4444" },
  { key: "title-streamer", type: "TITLE", name: "Streamer", description: "Joue à RankGuess en direct", color: "#A78BFA" },
  { key: "title-createur", type: "TITLE", name: "Créateur de contenu", description: "Fait connaître RankGuess", color: "#F472B6" },
  { key: "title-partenaire", type: "TITLE", name: "Partenaire", description: "Partenaire officiel de RankGuess", color: "#22D3EE" },
  { key: "title-equipe", type: "TITLE", name: "Équipe RankGuess", description: "Membre de l'équipe", color: "#34D399" },
  { key: "title-beta", type: "TITLE", name: "Bêta-testeur", description: "A testé RankGuess avant son ouverture", color: "#38BDF8" },
  { key: "title-trieur", type: "TITLE", name: "Trieur de clips", description: "Aide l'équipe à trier les clips proposés", color: "#A3E635" },
  { key: "badge-video", type: "BADGE", name: "Youtubeur", description: "Créateur de vidéos", color: "#EF4444", icon: "video" },
  { key: "badge-live", type: "BADGE", name: "Streamer", description: "Joue en direct", color: "#A78BFA", icon: "live" },
  { key: "badge-partenaire", type: "BADGE", name: "Partenaire", description: "Partenaire officiel", color: "#22D3EE", icon: "star" },
  { key: "badge-equipe", type: "BADGE", name: "Équipe", description: "Membre de l'équipe RankGuess", color: "#34D399", icon: "shield" },
  { key: "badge-beta", type: "BADGE", name: "Bêta-testeur", description: "Présent avant l'ouverture", color: "#38BDF8", icon: "sparkles" },
  { key: "badge-trieur", type: "BADGE", name: "Trieur de clips", description: "Aide l'équipe à trier les clips", color: "#A3E635", icon: "eye" },
  { key: "frame-createur", type: "FRAME", name: "Créateur", description: "Cadre des créateurs de contenu", color: "#EF4444", color2: "#F472B6" },
  // Paliers de niveau
  { key: "level-5-title", type: "TITLE", name: "Recrue", description: "Atteindre le niveau 5", color: "#9CA3AF", unlockLevel: 5 },
  { key: "level-10-frame", type: "FRAME", name: "Bronze", description: "Atteindre le niveau 10", color: "#CD7F32", color2: "#8C5A2B", unlockLevel: 10 },
  { key: "level-15-badge", type: "BADGE", name: "Étoile montante", description: "Atteindre le niveau 15", color: "#FACC15", icon: "star", unlockLevel: 15 },
  { key: "level-20-frame", type: "FRAME", name: "Argent", description: "Atteindre le niveau 20", color: "#F5F3FF", color2: "#9CA3AF", unlockLevel: 20 },
  { key: "level-25-title", type: "TITLE", name: "Tacticien", description: "Atteindre le niveau 25", color: "#38BDF8", unlockLevel: 25 },
  { key: "level-30-frame", type: "FRAME", name: "Or", description: "Atteindre le niveau 30", color: "#FACC15", color2: "#F59E0B", unlockLevel: 30 },
  { key: "level-35-badge", type: "BADGE", name: "Éclair", description: "Atteindre le niveau 35", color: "#22D3EE", icon: "bolt", unlockLevel: 35 },
  { key: "level-40-title", type: "TITLE", name: "Maître du rang", description: "Atteindre le niveau 40", color: "#A78BFA", unlockLevel: 40 },
  { key: "level-50-frame", type: "FRAME", name: "Néon", description: "Atteindre le niveau 50", color: "#8B5CF6", color2: "#22D3EE", unlockLevel: 50 },
  { key: "level-50-title", type: "TITLE", name: "Légende vivante", description: "Atteindre le niveau 50", color: "#F59E0B", unlockLevel: 50 },
  // Succès
  { key: "ach-exact-100", type: "TITLE", name: "Œil de lynx", description: "Succès « Œil de lynx »", color: "#34D399", achievement: "EXACT_100" },
  { key: "ach-win-streak-25", type: "TITLE", name: "Machine", description: "Succès « Machine »", color: "#38BDF8", achievement: "WIN_STREAK_25" },
  { key: "ach-win-streak-50", type: "TITLE", name: "Radar humain", description: "Succès « Radar humain »", color: "#22D3EE", achievement: "WIN_STREAK_50" },
  { key: "ach-win-streak-100", type: "FRAME", name: "Légende", description: "Succès « Légende »", color: "#FACC15", color2: "#EF4444", achievement: "WIN_STREAK_100" },
  { key: "ach-streak-30", type: "TITLE", name: "Assidu", description: "Succès « Mois d'acier »", color: "#F97316", achievement: "STREAK_30" },
  { key: "ach-streak-100", type: "BADGE", name: "Centenaire", description: "Succès « Centenaire »", color: "#F97316", icon: "flame", achievement: "STREAK_100" },
  { key: "ach-daily-perfect", type: "BADGE", name: "Sans faute", description: "Succès « Sans faute »", color: "#34D399", icon: "target", achievement: "DAILY_PERFECT" },
  { key: "ach-expert-lol", type: "TITLE", name: "Expert LoL", description: "Succès « Expert LoL »", color: "#C89B3C", achievement: "EXPERT_LOL" },
  { key: "ach-expert-valorant", type: "TITLE", name: "Expert Valorant", description: "Succès « Expert Valorant »", color: "#FF4655", achievement: "EXPERT_VALORANT" },
  { key: "ach-expert-rl", type: "TITLE", name: "Expert Rocket League", description: "Succès « Expert Rocket League »", color: "#38BDF8", achievement: "EXPERT_ROCKET_LEAGUE" },
  { key: "ach-expert-cs2", type: "TITLE", name: "Expert CS2", description: "Succès « Expert Counter-Strike 2 »", color: "#F59E0B", achievement: "EXPERT_CS2" },
  { key: "ach-versus-10", type: "TITLE", name: "Duelliste", description: "Succès « Duelliste »", color: "#EF4444", achievement: "VERSUS_WIN_10" },
  { key: "ach-versus-50", type: "BADGE", name: "Gladiateur", description: "Succès « Gladiateur »", color: "#EF4444", icon: "swords", achievement: "VERSUS_WIN_50" },
  { key: "ach-friends-10", type: "BADGE", name: "Populaire", description: "Succès « Populaire »", color: "#F472B6", icon: "heart", achievement: "FRIENDS_10" },
  { key: "ach-clip", type: "BADGE", name: "Réalisateur", description: "Succès « Réalisateur »", color: "#A3E635", icon: "camera", achievement: "CLIP_ACCEPTED" },
  { key: "ach-clips-10", type: "TITLE", name: "Producteur", description: "Succès « Producteur »", color: "#A3E635", achievement: "CLIPS_ACCEPTED_10" },
  { key: "ach-infinite-5000", type: "TITLE", name: "Increvable", description: "Succès « Increvable »", color: "#8B5CF6", achievement: "INFINITE_5000" },
];

async function main() {
  for (const [i, g] of GAMES.entries()) {
    const game = await prisma.game.upsert({
      where: { slug: g.slug },
      create: { slug: g.slug, name: g.name, accent: g.accent, sortOrder: i },
      update: { name: g.name, accent: g.accent, sortOrder: i, isActive: true },
    });
    for (const [order, [name, color]] of g.ranks.entries()) {
      await prisma.rank.upsert({
        where: { gameId_order: { gameId: game.id, order } },
        create: { gameId: game.id, order, name, tier: name, color },
        update: { name, tier: name, color },
      });
    }
  }
  // Les autres jeux éventuellement présents en base sont désactivés : ils disparaissent du site, de l'application et des classements
  await prisma.game.updateMany({ where: { slug: { notIn: GAMES.map((g) => g.slug) } }, data: { isActive: false } });
  // Succès liés à un jeu désactivé
  await prisma.achievement.updateMany({ where: { game: { isActive: false } }, data: { isActive: false } });
  for (const a of ACHIEVEMENTS) {
    // Création seulement : les modifications faites depuis l'administration sont conservées
    await prisma.achievement.upsert({ where: { code: a.code }, create: { ...a, criteria: a.criteria }, update: {} });
  }
  // Le succès secret du niveau 50 portait le nom « ??? » : il prend son vrai nom (affiché une fois obtenu)
  await prisma.achievement.updateMany({ where: { code: "SECRET_LEVEL_50", name: "???" }, data: { name: "Vétéran" } });
  // Passage à 3 défis par jeu et par jour : descriptions mises à jour (sauf si l'équipe les a déjà modifiées)
  for (const [code, before, after] of [
    ["DAILY_FULL_1", "Jouer les 4 défis du jour le même jour", "Jouer tous les défis du jour (tous les jeux) le même jour"],
    ["DAILY_FULL_30", "Jouer les 4 défis du jour pendant 30 jours", "Jouer tous les défis du jour pendant 30 jours"],
    ["DAILY_PERFECT", "Trouver le rang exact aux 4 défis d'une même journée", "Trouver le rang exact à tous les défis d'une même journée"],
  ] as const) {
    await prisma.achievement.updateMany({ where: { code, description: before }, data: { description: after } });
  }
  for (const { achievement, ...c } of COSMETICS) {
    const unlockAchievementId = achievement ? (await prisma.achievement.findUnique({ where: { code: achievement }, select: { id: true } }))?.id : undefined;
    // Création seulement : les modifications faites depuis l'administration sont conservées
    await prisma.cosmetic.upsert({ where: { key: c.key }, create: { ...c, unlockAchievementId }, update: {} });
  }
  console.log(
    `Données de base prêtes : ${GAMES.length} jeux, ${GAMES.reduce((s, g) => s + g.ranks.length, 0)} rangs, ${ACHIEVEMENTS.length} succès, ${COSMETICS.length} récompenses`,
  );
}

main().finally(() => prisma.$disconnect());
