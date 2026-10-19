-- Clips proposés par un lien YouTube ou Medal : la vidéo reste chez le fournisseur (lecteur intégré), aucun fichier stocké
CREATE TYPE "ClipLinkProvider" AS ENUM ('YOUTUBE', 'MEDAL');

ALTER TABLE "clips" ADD COLUMN "link_provider" "ClipLinkProvider",
ADD COLUMN "link_video_id" VARCHAR(64),
ADD COLUMN "link_start_sec" INTEGER;
