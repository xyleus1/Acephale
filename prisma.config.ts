import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "./prisma/schema.prisma",
  engine: "classic",
  datasource: {
    url: env("DATABASE_URL"),
    directUrl: process.env.DATABASE_URL_UNPOOLED ?? env("DATABASE_URL"),
  },
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
