-- Tournois privés : uniquement des ajouts.
-- CreateEnum
CREATE TYPE "TournamentStatus" AS ENUM ('LOBBY', 'ACTIVE', 'FINISHED', 'CLOSED');

-- CreateTable
CREATE TABLE "tournaments" (
    "id" UUID NOT NULL,
    "code" VARCHAR(8) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "host_id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "capacity" INTEGER NOT NULL,
    "bracket_size" INTEGER,
    "rounds" INTEGER NOT NULL,
    "round_sec" INTEGER NOT NULL,
    "status" "TournamentStatus" NOT NULL DEFAULT 'LOBBY',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "tournaments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_players" (
    "tournament_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seed" INTEGER,
    "left_at" TIMESTAMP(3),
    "placement" INTEGER,

    CONSTRAINT "tournament_players_pkey" PRIMARY KEY ("tournament_id","user_id")
);

-- CreateTable
CREATE TABLE "tournament_matches" (
    "id" UUID NOT NULL,
    "tournament_id" UUID NOT NULL,
    "stage" INTEGER NOT NULL,
    "slot" INTEGER NOT NULL,
    "player1_id" UUID,
    "player2_id" UUID,
    "ready1_at" TIMESTAMP(3),
    "ready2_at" TIMESTAMP(3),
    "deadline_at" TIMESTAMP(3),
    "room_id" UUID,
    "winner_id" UUID,
    "decided_by" VARCHAR(12),
    "score1" INTEGER,
    "score2" INTEGER,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "tournament_matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tournaments_code_key" ON "tournaments"("code");

-- CreateIndex
CREATE INDEX "tournaments_status_expires_at_idx" ON "tournaments"("status", "expires_at");

-- CreateIndex
CREATE INDEX "tournament_players_user_id_joined_at_idx" ON "tournament_players"("user_id", "joined_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "tournament_matches_room_id_key" ON "tournament_matches"("room_id");

-- CreateIndex
CREATE INDEX "tournament_matches_deadline_at_idx" ON "tournament_matches"("deadline_at");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_matches_tournament_id_stage_slot_key" ON "tournament_matches"("tournament_id", "stage", "slot");

-- AddForeignKey
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_players" ADD CONSTRAINT "tournament_players_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_players" ADD CONSTRAINT "tournament_players_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Garde-fous
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_capacity_check" CHECK ("capacity" IN (4, 8, 16));
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_bracket_size_check" CHECK ("bracket_size" IS NULL OR "bracket_size" IN (4, 8, 16));
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_rounds_check" CHECK ("rounds" BETWEEN 1 AND 10);
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_round_sec_check" CHECK ("round_sec" BETWEEN 10 AND 180);
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_players_check" CHECK ("player1_id" IS NULL OR "player2_id" IS NULL OR "player1_id" <> "player2_id");
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_winner_check" CHECK ("winner_id" IS NULL OR "winner_id" = "player1_id" OR "winner_id" = "player2_id");
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_decided_by_check" CHECK ("decided_by" IS NULL OR "decided_by" IN ('POINTS', 'SUDDEN_DEATH', 'SPEED', 'SEED', 'FORFEIT', 'NO_SHOW', 'BYE'));
