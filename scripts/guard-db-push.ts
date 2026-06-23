import { existsSync, readFileSync } from "fs";

function loadDotEnvIfNeeded() {
  if (process.env.DATABASE_URL || !existsSync(".env")) return;
  const lines = readFileSync(".env", "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] ??= value;
  }
}

loadDotEnvIfNeeded();

const rawUrl = process.env.DATABASE_URL ?? "";
const allowRemote = process.env.ALLOW_REMOTE_DB_PUSH === "1" || process.env.ALLOW_REMOTE_DB_PUSH === "true";

function hostFromDatabaseUrl(value: string) {
  if (!value) return null;
  if (value.startsWith("file:")) return "local-file";
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function isLocalHost(host: string | null) {
  if (!host) return false;
  return [
    "localhost",
    "127.0.0.1",
    "::1",
    "local-file",
  ].includes(host) || host.startsWith("192.168.") || host.startsWith("10.") || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
}

const host = hostFromDatabaseUrl(rawUrl);

if (!rawUrl) {
  console.error("DATABASE_URL is not set. Refusing to run prisma db push.");
  process.exit(1);
}

if (!isLocalHost(host) && !allowRemote) {
  console.error([
    `Refusing to run prisma db push against remote database host "${host ?? "unknown"}".`,
    "Set ALLOW_REMOTE_DB_PUSH=1 only when you intentionally want to mutate a remote schema.",
  ].join("\n"));
  process.exit(1);
}

console.log(`Database push guard passed for ${host}.`);
