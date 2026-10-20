# Image de production de l'API (construite depuis la racine du projet) :
#   docker build -f apps/api/Dockerfile -t rankguess-api .
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @ranksight/api --workspace @ranksight/shared --include-workspace-root
COPY packages/shared packages/shared
COPY apps/api apps/api
# URL factice uniquement pour la compilation Prisma (prisma.config.ts exige DATABASE_URL pour `prisma generate`,
# qui ne se connecte pas à la base). Limitée à cette étape de construction : l'image finale ne la contient pas,
# la véritable URL est fournie au démarrage par docker-compose (deploy/.env.production).
ENV DATABASE_URL="postgresql://rankguess:build-only@localhost:5432/rankguess"
RUN npm run build -w @ranksight/shared && npm run build -w @ranksight/api \
 && npm prune --omit=dev --workspace @ranksight/api --workspace @ranksight/shared

FROM node:22-alpine
ENV NODE_ENV=production
# ffmpeg : compression des vidéos (720p) et images d'aperçu
RUN apk add --no-cache ffmpeg
WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/shared ./packages/shared
COPY --from=build /repo/apps/api/package.json ./apps/api/
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/src/generated ./apps/api/src/generated
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build /repo/apps/api/prisma.config.ts ./apps/api/
WORKDIR /repo/apps/api
RUN mkdir -p storage && chown node:node storage
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD wget -qO- http://127.0.0.1:4000/health || exit 1
# Migrations de la base, puis jeux, rangs et succès (sans effacer l'existant), puis démarrage
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx prisma/seed.ts && node dist/main.js"]
