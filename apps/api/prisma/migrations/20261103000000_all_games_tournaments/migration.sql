-- Tournois « Tous les jeux » : le jeu d'un tournoi et de ses matchs devient facultatif (NULL = tous les jeux actifs).
-- Aucune donnée modifiée : les tournois et salons existants gardent leur jeu.
ALTER TABLE "tournaments" ALTER COLUMN "game_id" DROP NOT NULL;
ALTER TABLE "rooms" ALTER COLUMN "game_id" DROP NOT NULL;
