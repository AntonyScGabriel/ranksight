# Image de production (admin), construite depuis la racine du projet :
#   docker build -f apps/admin/Dockerfile -t rankguess-admin .
# Les adresses publiques et les informations légales sont intégrées au moment de la construction (arguments ci-dessous).
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/admin/package.json apps/admin/
RUN npm ci --workspace @ranksight/admin --workspace @ranksight/shared --include-workspace-root
COPY packages/shared packages/shared
COPY apps/admin apps/admin
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
RUN npm run build -w @ranksight/shared && npm run build -w @ranksight/admin

FROM node:22-alpine
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3001 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/admin/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/admin/.next/static ./apps/admin/.next/static
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD wget -qO- http://127.0.0.1:3001/ >/dev/null || exit 1
CMD ["node", "apps/admin/server.js"]
