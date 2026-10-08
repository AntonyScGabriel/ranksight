import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// Un seul fichier .env, à la racine du projet, partagé par l'API, le site et l'administration
loadEnvConfig(path.resolve(process.cwd(), "../.."));

const apiOrigin = process.env.API_PUBLIC_URL ?? "http://localhost:4000";
const api = process.env.NEXT_PUBLIC_API_URL ?? `${apiOrigin}/v1`;
const dev = process.env.NODE_ENV !== "production";
// Images des rangs et vidéos servies par l'API (stockage local) : autorisées quelle que soit l'adresse de l'API
const apiHost = new URL(api).origin;
// Suivi des erreurs (facultatif) : le navigateur envoie les erreurs à l'adresse du DSN Sentry
const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? "";
const sentryOrigin = sentryDsn ? new URL(sentryDsn).origin : "";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-Frame-Options", value: "DENY" },
  ...(dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self'",
      `img-src 'self' data: blob: https: ${apiHost}${dev ? " http:" : ""}`,
      `media-src 'self' https: blob: ${apiHost}${dev ? " http:" : ""}`,
      `connect-src 'self' ${apiHost} ${apiHost.replace(/^http/, "ws")} wss:${sentryOrigin ? ` ${sentryOrigin}` : ""}`,
      `form-action 'self' ${apiHost}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join("; "),
  },
];

const config: NextConfig = {
  transpilePackages: ["@ranksight/shared"],
  poweredByHeader: false,
  // Image Docker : serveur autonome (NEXT_OUTPUT=standalone dans le Dockerfile)
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const, outputFileTracingRoot: path.resolve(process.cwd(), "../..") } : {}),
  env: {
    NEXT_PUBLIC_API_URL: api,
    NEXT_PUBLIC_ADMIN_URL: process.env.ADMIN_URL ?? "http://localhost:3001",
    NEXT_PUBLIC_SITE_URL: process.env.WEB_URL ?? "http://localhost:3000",
    NEXT_PUBLIC_SENTRY_DSN: sentryDsn,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
