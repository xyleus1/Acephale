import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

const ROOTS = ["src/app", "src/lib"];
const IGNORE = new Set([
  "src/lib/prisma.ts",
  "src/lib/auth.ts",
  "src/lib/seed-demo-load.ts",
  "src/lib/setup-demo-actions.ts",
]);
const STRICT = process.env.STRICT_TENANT_SCOPE === "1" || process.env.STRICT_TENANT_SCOPE === "true";

type Finding = {
  file: string;
  line: number;
  call: string;
  reason: string;
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) return walk(full);
    return full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : [];
  });
}

function lineNo(source: string, index: number) {
  return source.slice(0, index).split("\n").length;
}

function hasTenantScope(snippet: string) {
  return /\bofficeId\b/.test(snippet)
    || /\boffice:\s*\{/.test(snippet)
    || /\bcompany:\s*\{[^}]*officeId/s.test(snippet)
    || /\bjob:\s*\{[^}]*officeId/s.test(snippet)
    || /\binquiry:\s*\{[^}]*officeId/s.test(snippet);
}

const files = ROOTS.flatMap(walk)
  .map((file) => file.replaceAll(path.sep, "/"))
  .filter((file) => !IGNORE.has(file));

const findings: Finding[] = [];
const prismaCall = /prisma\.([a-zA-Z][\w]*)\.(findFirst|findMany|update|updateMany|delete|deleteMany)\s*\(/g;

for (const file of files) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(prismaCall)) {
    const start = match.index ?? 0;
    const snippet = source.slice(start, start + 900);
    if (!/\bwhere\s*:/.test(snippet)) continue;
    if (hasTenantScope(snippet)) continue;
    const call = `${match[1]}.${match[2]}`;
    findings.push({
      file,
      line: lineNo(source, start),
      call,
      reason: "Prisma query has a where clause but no obvious officeId or tenant relation scope nearby.",
    });
  }
}

if (findings.length === 0) {
  console.log("Tenant scope audit passed: no obvious unscoped Prisma queries found.");
  process.exit(0);
}

console.log(`Tenant scope audit found ${findings.length} suspicious Prisma quer${findings.length === 1 ? "y" : "ies"}.`);
for (const item of findings.slice(0, 80)) {
  console.log(`${item.file}:${item.line} ${item.call} - ${item.reason}`);
}
if (findings.length > 80) {
  console.log(`...and ${findings.length - 80} more.`);
}

if (STRICT) {
  process.exit(1);
}

console.log("Non-strict mode: report only. Set STRICT_TENANT_SCOPE=1 to fail on findings.");
