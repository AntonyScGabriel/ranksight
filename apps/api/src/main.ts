import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Logger, VersioningType } from "@nestjs/common";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module.js";
import { env } from "./config/env.js";
import { RedisIoAdapter } from "./redis/redis-io.adapter.js";
import { HttpAdapterHost } from "@nestjs/core";
import { initErrorReporting, reportError, ReportingExceptionFilter } from "./common/error-reporting.js";
import { requestContext } from "./common/request-context.js";

async function bootstrap() {
  const config = env();
  initErrorReporting();
  process.on("unhandledRejection", (reason) => {
    new Logger("Process").error(`Promesse rejetée non gérée : ${String(reason)}`);
    reportError(reason);
  });
  // rawBody : corps brut conservé pour vérifier la signature des notifications Stripe
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, rawBody: true });
  // 1 Mo : suffisant pour l'image d'un rang envoyée depuis l'administration (512 Ko max une fois décodée)
  app.useBodyParser("json", { limit: "1mb" });

  app.use(requestContext);
  app.use(
    helmet({
      // L'API ne sert que du JSON et des fichiers : aucune page, aucun script autorisé
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      hsts: config.NODE_ENV === "production" ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );
  app.use(cookieParser());
  app.getHttpAdapter().getInstance().disable("x-powered-by");
  app.useGlobalFilters(new ReportingExceptionFilter(app.get(HttpAdapterHost).httpAdapter));
  app.enableCors({ origin: config.CORS_ORIGINS, credentials: true });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  app.enableShutdownHooks();
  // Derrière Cloudflare ou un load balancer : IP réelle pour la limitation de débit
  app.getHttpAdapter().getInstance().set("trust proxy", 1);

  const ioAdapter = new RedisIoAdapter(app);
  await ioAdapter.connect();
  app.useWebSocketAdapter(ioAdapter);

  await app.listen(config.API_PORT, "0.0.0.0");
  new Logger("Bootstrap").log(`API RankGuess prête sur ${config.API_PUBLIC_URL}/v1`);
}

void bootstrap();
