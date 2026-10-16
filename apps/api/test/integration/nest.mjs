// Contexte Nest de l'API compilée (sans serveur HTTP) : appelle directement les services, sur la même base que l'API.
import { NestFactory } from "@nestjs/core";

export async function services() {
  const { AppModule } = await import("../../dist/app.module.js");
  const { RatingsService } = await import("../../dist/modules/ratings/ratings.service.js");
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error"] });
  return { app, ratings: app.get(RatingsService) };
}
