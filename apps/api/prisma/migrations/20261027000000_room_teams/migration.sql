-- Duels par équipes dans les salons privés : uniquement des ajouts (colonnes facultatives).
-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "team_size" INTEGER;

-- AlterTable
ALTER TABLE "room_players" ADD COLUMN     "team" INTEGER;

ALTER TABLE "rooms" ADD CONSTRAINT "rooms_team_size_check" CHECK ("team_size" IS NULL OR "team_size" IN (2, 3));
ALTER TABLE "room_players" ADD CONSTRAINT "room_players_team_check" CHECK ("team" IS NULL OR "team" IN (1, 2));
