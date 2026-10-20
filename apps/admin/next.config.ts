import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// Un seul fichier .env, à la racine du projet
loadEnvConfig(path.resolve(process.cwd(), "../.."));

const apiOrigin = process.env.API_PUBLIC_URL ?? "http://localhost:4000";
const api = process.env.NEXT_PUBLIC_API_URL ?? `${apiOrigin}/v1`;
const apiHost = new URL(api).origin;
// Stockage S3/R2 en production : les vidéos sont envoyées directement depuis le navigateur (URL signées)
const storageOrigin = process.env.S3_ENDPOINT ? new URL(process.env.S3_ENDPOINT).origin : "";
const dev = process.env.NODE_ENV !== "production";

/** Administration : politique de sécurité stricte (pas d'intégration dans un cadre ; seuls cadres externes : lecteurs des clips à lien) */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  `img-src 'self' data: blob: https: ${apiHost}${dev ? " http:" : ""}`,
  `media-src 'self' blob: https: ${apiHost}${dev ? " http:" : ""}`,
  `connect-src 'self' ${apiHost} ${apiHost.replace(/^http/, "ws")}${storageOrigin ? ` ${storageOrigin}` : ""}`,
  `form-action 'self' ${apiHost}`,
  // Seule exception : lecteurs intégrés YouTube / Medal des clips proposés par un lien (à modérer)
  "frame-src https://www.youtube-nocookie.com https://medal.tv",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const config: NextConfig = {
  transpilePackages: ["@ranksight/shared"],
  poweredByHeader: false,
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const, outputFileTracingRoot: path.resolve(process.cwd(), "../..") } : {}),
  env: {
    NEXT_PUBLIC_API_URL: api,
    NEXT_PUBLIC_WEB_URL: process.env.WEB_URL ?? "http://localhost:3000",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy", value: csp },
          ...(dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
        ],
      },
    ];
  },
};

export default config;
