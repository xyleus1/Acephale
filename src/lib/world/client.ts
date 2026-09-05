import { PrismaClient } from "../../generated/world-client";

declare global {
  // eslint-disable-next-line no-var
  var worldPrismaGlobal: PrismaClient | undefined;
}

function createWorldPrisma() {
  const datasourceUrl = process.env.WORLD_DATABASE_URL;
  if (!datasourceUrl) {
    throw new Error("WORLD_DATABASE_URL is required to use the world company database.");
  }
  return new PrismaClient({ datasourceUrl });
}

export function getWorldPrisma() {
  if (!global.worldPrismaGlobal) {
    global.worldPrismaGlobal = createWorldPrisma();
  }
  return global.worldPrismaGlobal;
}

export const worldPrisma = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    return Reflect.get(getWorldPrisma(), property, receiver);
  },
});
