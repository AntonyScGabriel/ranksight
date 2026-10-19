-- Tchat des salons (salle d'attente, partie, canal d'équipe) et des tournois
CREATE TABLE "game_chat_messages" (
    "id" UUID NOT NULL,
    "room_id" UUID,
    "tournament_id" UUID,
    "user_id" UUID NOT NULL,
    "team" INTEGER,
    "body" VARCHAR(300) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "game_chat_messages_room_id_created_at_idx" ON "game_chat_messages"("room_id", "created_at");
CREATE INDEX "game_chat_messages_tournament_id_created_at_idx" ON "game_chat_messages"("tournament_id", "created_at");
CREATE INDEX "game_chat_messages_user_id_idx" ON "game_chat_messages"("user_id");

ALTER TABLE "game_chat_messages" ADD CONSTRAINT "game_chat_messages_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "game_chat_messages" ADD CONSTRAINT "game_chat_messages_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "game_chat_messages" ADD CONSTRAINT "game_chat_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Un message appartient à un salon ou à un tournoi, jamais aux deux
ALTER TABLE "game_chat_messages" ADD CONSTRAINT "game_chat_messages_scope_check" CHECK (("room_id" IS NULL) <> ("tournament_id" IS NULL));ALTER TABLE "game_chat_messages" ADD CONSTRAINT "game_chat_messages_team_check" CHECK ("team" IS NULL OR "team" IN (1, 2));
