-- Signalement d'un message du tchat d'un salon ou d'un tournoi
ALTER TABLE "chat_reports" ADD COLUMN "game_message_id" UUID;
ALTER TABLE "chat_reports" ADD CONSTRAINT "chat_reports_game_message_id_fkey" FOREIGN KEY ("game_message_id") REFERENCES "game_chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
