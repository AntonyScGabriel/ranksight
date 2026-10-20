-- Tournois publics (listés, rejoignables sans code) ou privés ; modération du tchat des tournois (suppression de
-- messages, joueur réduit au silence). Les tournois existants restent privés, les événements deviennent publics.
ALTER TABLE "tournaments" ADD COLUMN "visibility" "RoomVisibility" NOT NULL DEFAULT 'PRIVATE';
UPDATE "tournaments" SET "visibility" = 'PUBLIC' WHERE "is_event";
CREATE INDEX "tournaments_visibility_status_idx" ON "tournaments"("visibility", "status");

ALTER TABLE "tournament_players" ADD COLUMN "chat_muted" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "game_chat_messages" ADD COLUMN "deleted_at" TIMESTAMP(3),
ADD COLUMN "deleted_by_id" UUID;