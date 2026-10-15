-- Mode Plus haut / Plus bas : nouvelle table, aucune donnée existante modifiée.
-- CreateTable
CREATE TABLE "higher_lower_runs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "round" INTEGER NOT NULL DEFAULT 1,
    "current_clip_id" UUID NOT NULL,
    "next_clip_id" UUID,
    "used_clip_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "end_reason" VARCHAR(16),
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "higher_lower_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "higher_lower_runs_user_id_started_at_idx" ON "higher_lower_runs"("user_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "higher_lower_runs_user_id_score_idx" ON "higher_lower_runs"("user_id", "score" DESC);

-- AddForeignKey
ALTER TABLE "higher_lower_runs" ADD CONSTRAINT "higher_lower_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "higher_lower_runs" ADD CONSTRAINT "higher_lower_runs_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "higher_lower_runs" ADD CONSTRAINT "higher_lower_runs_score_check" CHECK ("score" >= 0 AND "round" >= 1);
