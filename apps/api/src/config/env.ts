import { z } from "zod";

const trimSlash = (u: string) => u.replace(/\/+$/, "");

/** Validation stricte de l'environnement au démarrage : l'API refuse de démarrer si une variable manque. */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().default(4000),
  // Adresses publiques, sans "/" final (les adresses de retour OAuth et les liens d'email en sont dérivés)
  API_PUBLIC_URL: z.string().url().transform(trimSlash),
  WEB_URL: z.string().url().transform(trimSlash),
  ADMIN_URL: z.string().url().default("http://localhost:3001").transform(trimSlash),
  CORS_ORIGINS: z.string().transform((s) => s.split(",").map((o) => trimSlash(o.trim())).filter(Boolean)),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().default(30),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  DISCORD_CLIENT_ID: z.string().default(""),
  DISCORD_CLIENT_SECRET: z.string().default(""),
  /** Mois de la saison 1 (AAAA-MM). Une saison dure un mois civil ; la saison 2 commence le mois suivant, etc. */
  SEASON_ONE: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).default("2026-10"),
  /** Schéma des liens profonds de l'application mobile (ex. ranksight://auth/callback) */
  APP_SCHEME: z.string().regex(/^[a-z][a-z0-9+.-]*$/).default("ranksight"),
  // Envoi d'emails (mot de passe oublié). Sans SMTP_HOST, le lien est écrit dans le journal de l'API.
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  SMTP_USER: z.string().default(""),
  SMTP_PASSWORD: z.string().default(""),
  MAIL_FROM: z.string().default("RankGuess <no-reply@localhost>"),
  // Boutique VIP : paiement par carte via Stripe Checkout. Sans clé, la boutique s'affiche mais l'achat est indisponible.
  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
  STRIPE_API_URL: z.string().url().default("https://api.stripe.com").transform(trimSlash),
  // Achats dans l'application Android (Google Play Billing). Vides = achat indisponible dans l'application.
  /** Identifiant de l'application sur Google Play (ex. com.rankguess.app), identique à ANDROID_PACKAGE du build mobile */
  GOOGLE_PLAY_PACKAGE_NAME: z.string().default(""),
  /** Clé JSON du compte de service Google Cloud ayant accès à la Play Console (contenu brut ou encodé en base64) */
  GOOGLE_PLAY_SERVICE_ACCOUNT: z.string().default(""),
  GOOGLE_PLAY_API_URL: z.string().url().default("https://androidpublisher.googleapis.com").transform(trimSlash),
  // "local" = fichiers sur le disque, servis par l'API (développement) · "s3" = Cloudflare R2 ou tout service S3 (production)
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  LOCAL_STORAGE_DIR: z.string().default("./storage"),
  S3_ENDPOINT: z.string().default(""),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().default(""),
  S3_ACCESS_KEY_ID: z.string().default(""),
  S3_SECRET_ACCESS_KEY: z.string().default(""),
  // Compression des vidéos (720p). Vide = "ffmpeg" et "ffprobe" trouvés dans le PATH ; sans ffmpeg, pas de compression.
  FFMPEG_PATH: z.string().default(""),
  FFPROBE_PATH: z.string().default(""),
  // Sécurité
  /** Clé de chiffrement des données sensibles en base (secret 2FA). Vide = dérivée de JWT_REFRESH_SECRET */
  ENCRYPTION_KEY: z.string().default(""),
  /** Double authentification obligatoire pour l'administration : false (facultative, par défaut), true, ou auto = oui en production */
  ADMIN_REQUIRE_2FA: z.enum(["auto", "true", "false"]).default("false"),
  /** Adresse qui reçoit les messages du formulaire de contact (vide = adresse de MAIL_FROM) */
  CONTACT_EMAIL: z.string().default(""),
  /** Suivi des erreurs (Sentry). Vide = désactivé */
  SENTRY_DSN: z.string().default(""),
}).refine((e) => !e.GOOGLE_PLAY_SERVICE_ACCOUNT || e.GOOGLE_PLAY_PACKAGE_NAME, {
  message: "GOOGLE_PLAY_SERVICE_ACCOUNT exige GOOGLE_PLAY_PACKAGE_NAME",
}).refine((e) => e.STORAGE_DRIVER === "local" || (e.S3_ENDPOINT && e.S3_BUCKET && e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY), {
  message: "STORAGE_DRIVER=s3 exige S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID et S3_SECRET_ACCESS_KEY",
});

export type Env = z.infer<typeof EnvSchema>;

const WEAK_SECRET = /dev-|change-me|changeme|secret|password/i;

/** Garde-fous de production : l'API refuse de démarrer avec une configuration dangereuse. */
function productionProblems(e: Env): string[] {
  if (e.NODE_ENV !== "production") return [];
  const problems: string[] = [];
  for (const name of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"] as const) {
    if (e[name].length < 32 || WEAK_SECRET.test(e[name])) problems.push(`${name} est trop faible : générer une valeur avec « openssl rand -base64 48 »`);
  }
  if (e.JWT_ACCESS_SECRET === e.JWT_REFRESH_SECRET) problems.push("JWT_ACCESS_SECRET et JWT_REFRESH_SECRET doivent être différents");
  if (e.ENCRYPTION_KEY && e.ENCRYPTION_KEY.length < 32) problems.push("ENCRYPTION_KEY doit faire au moins 32 caractères");
  for (const name of ["API_PUBLIC_URL", "WEB_URL", "ADMIN_URL"] as const) {
    if (!e[name].startsWith("https://")) problems.push(`${name} doit être une adresse https:// en production`);
  }
  if (e.CORS_ORIGINS.some((o) => o === "*" || o.includes("localhost"))) problems.push("CORS_ORIGINS ne doit contenir ni « * » ni localhost en production");
  if (e.GOOGLE_PLAY_SERVICE_ACCOUNT && !e.GOOGLE_PLAY_API_URL.startsWith("https://")) problems.push("GOOGLE_PLAY_API_URL doit être une adresse https:// en production");
  if (/ranksight:ranksight@/.test(e.DATABASE_URL)) problems.push("DATABASE_URL utilise le mot de passe de développement");
  return problems;
}

let cached: Env | undefined;
export function env(): Env {
  if (!cached) {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
      console.error("❌ Variables d'environnement invalides :", z.treeifyError(parsed.error));
      process.exit(1);
    }
    const problems = productionProblems(parsed.data);
    if (problems.length) {
      console.error(`❌ Configuration de production refusée :\n - ${problems.join("\n - ")}`);
      process.exit(1);
    }
    cached = parsed.data;
  }
  return cached;
}
