# Image de production (web), construite depuis la racine du projet :
#   docker build -f apps/web/Dockerfile -t rankguess-web .
# Les adresses publiques et les informations légales sont intégrées au moment de la construction (arguments ci-dessous).
FROM node:26-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @ranksight/web --workspace @ranksight/shared --include-workspace-root
COPY packages/shared packages/shared
COPY apps/web apps/web
ARG API_PUBLIC_URL
ARG WEB_URL
ARG ADMIN_URL
ARG NEXT_PUBLIC_SENTRY_DSN=""
ARG S3_ENDPOINT=""
ARG LEGAL_PUBLISHER_NAME=""
ARG LEGAL_PUBLISHER_STATUS=""
ARG LEGAL_ADDRESS=""
ARG LEGAL_EMAIL=""
ARG LEGAL_SIRET=""
ARG LEGAL_VAT_NOTE=""
ARG LEGAL_DIRECTOR=""
ARG LEGAL_HOST_NAME=""
ARG LEGAL_HOST_ADDRESS=""
ARG LEGAL_HOST_CONTACT=""
ARG LEGAL_MEDIATOR_NAME=""
ARG LEGAL_MEDIATOR_URL=""
ENV NEXT_OUTPUT=standalone NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production
RUN npm run build -w @ranksight/shared && npm run build -w @ranksight/web

FROM node:26-alpine
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD wget -qO- http://localhost:3000/ >/dev/null || exit 1
CMD ["node", "apps/web/server.js"]
