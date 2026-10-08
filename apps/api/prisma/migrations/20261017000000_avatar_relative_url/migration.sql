-- Photos de profil : adresse enregistrée sans domaine (chaque client la complète avec l'adresse de l'API qu'il utilise)
UPDATE "users"
SET "avatar_url" = regexp_replace("avatar_url", '^https?://[^/]+(/v1/avatars/[A-Za-z0-9-]+\.webp)$', '\1')
WHERE "avatar_url" ~ '^https?://[^/]+/v1/avatars/[A-Za-z0-9-]+\.webp$';
