import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "./schema.prisma",
  engine: "classic",
  datasource: {
    url: env("WORLD_DATABASE_URL"),
  },
  migrations: {
    path: "./migrations",
  },
});
