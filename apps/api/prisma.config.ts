import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

// Le .env unique est à la racine du monorepo (les commandes Prisma tournent dans apps/api)
config({ path: "../../.env", quiet: true });
config({ quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
