-- Salons privés (jusqu'à 8 joueurs) : uniquement des ajouts, aucune donnée existante n'est modifiée.
-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('LOBBY', 'ACTIVE', 'FINISHED', 'CLOSED');

-- AlterEnum
ALTER TYPE "GameMode" ADD VALUE 'ROOM';

-- AlterTable
ALTER TABLE "guesses" ADD COLUMN     "room_id" UUID,
ADD COLUMN     "stats_pending" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "rooms" (
    "id" UUID NOT NULL,
    "code" VARCHAR(8) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "host_id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "status" "RoomStatus" NOT NULL DEFAULT 'LOBBY',
    "rounds" INTEGER NOT NULL,
    "round_sec" INTEGER NOT NULL,
    "max_players" INTEGER NOT NULL DEFAULT 8,
    "current_round" INTEGER NOT NULL DEFAULT 0,
    "round_starts_at" TIMESTAMP(3),
    "round_ends_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_players" (
    "room_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMP(3),
    "score" INTEGER NOT NULL DEFAULT 0,
    "placement" INTEGER,

    CONSTRAINT "room_players_pkey" PRIMARY KEY ("room_id","user_id")
);

-- CreateTable
CREATE TABLE "room_rounds" (
    "room_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "clip_id" UUID NOT NULL,

    CONSTRAINT "room_rounds_pkey" PRIMARY KEY ("room_id","position")
);

-- CreateTable
CREATE TABLE "room_invites" (
    "room_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "invited_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_invites_pkey" PRIMARY KEY ("room_id","user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rooms_code_key" ON "rooms"("code");

-- CreateIndex
CREATE INDEX "rooms_status_expires_at_idx" ON "rooms"("status", "expires_at");

-- CreateIndex
CREATE INDEX "rooms_status_round_ends_at_idx" ON "rooms"("status", "round_ends_at");

-- CreateIndex
CREATE INDEX "rooms_created_by_id_created_at_idx" ON "rooms"("created_by_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "room_players_user_id_joined_at_idx" ON "room_players"("user_id", "joined_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "room_rounds_room_id_clip_id_key" ON "room_rounds"("room_id", "clip_id");

-- CreateIndex
CREATE INDEX "room_invites_user_id_idx" ON "room_invites"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "guesses_user_id_room_id_clip_id_key" ON "guesses"("user_id", "room_id", "clip_id");

-- CreateIndex
CREATE INDEX "guesses_stats_pending_created_at_idx" ON "guesses"("stats_pending", "created_at");

-- AddForeignKey
ALTER TABLE "guesses" ADD CONSTRAINT "guesses_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_players" ADD CONSTRAINT "room_players_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_players" ADD CONSTRAINT "room_players_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_rounds" ADD CONSTRAINT "room_rounds_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_rounds" ADD CONSTRAINT "room_rounds_clip_id_fkey" FOREIGN KEY ("clip_id") REFERENCES "clips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_invites" ADD CONSTRAINT "room_invites_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_invites" ADD CONSTRAINT "room_invites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_invites" ADD CONSTRAINT "room_invites_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Garde-fous : paramètres de partie dans les bornes prévues
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_rounds_check" CHECK ("rounds" BETWEEN 1 AND 20);
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_round_sec_check" CHECK ("round_sec" BETWEEN 10 AND 180);
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_max_players_check" CHECK ("max_players" BETWEEN 2 AND 8);
ALTER TABLE "room_players" ADD CONSTRAINT "room_players_score_check" CHECK ("score" >= 0);
