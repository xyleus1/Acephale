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
const STRICT_ARG = process.argv.includes("--strict");
const JSON_OUTPUT = process.argv.includes("--json");

type Finding = {
  file: string;
  line: number;
  call: string;
  severity: "high" | "medium";
  reason: string;
  hint: string;
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
    || /\binquiry:\s*\{[^}]*officeId/s.test(snippet)
    || /\bwhere\s*:\s*officeWhere\b/.test(snippet)
    || /\bwhere\s*:\s*eventWhere\(/.test(snippet);
}

function ignored(snippet: string) {
  return /tenant-scope:ignore/.test(snippet);
}

function severity(call: string): Finding["severity"] {
  return /\.(update|updateMany|delete|deleteMany)$/.test(call) ? "high" : "medium";
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
    if (ignored(source.slice(Math.max(0, start - 240), start + 240))) continue;
    if (!/\bwhere\s*:/.test(snippet)) continue;
    if (hasTenantScope(snippet)) continue;
    const call = `${match[1]}.${match[2]}`;
    const level = severity(call);
    findings.push({
      file,
      line: lineNo(source, start),
      call,
      severity: level,
      reason: "Prisma query has a where clause but no obvious officeId or tenant relation scope nearby.",
      hint: level === "high"
        ? "Mutation queries should normally include officeId directly or through a tenant-scoped relation."
        : "Read queries should either include officeId/tenant relation scope or an explicit tenant-scope:ignore comment.",
    });
  }
}

if (findings.length === 0) {
  console.log("Tenant scope audit passed: no obvious unscoped Prisma queries found.");
  process.exit(0);
}

const high = findings.filter((finding) => finding.severity === "high").length;
const medium = findings.length - high;
if (JSON_OUTPUT) {
  console.log(JSON.stringify({ ok: false, high, medium, findings }, null, 2));
} else {
  console.log(`Tenant scope audit found ${findings.length} suspicious Prisma quer${findings.length === 1 ? "y" : "ies"} (${high} high, ${medium} medium).`);
  console.log("Fix by adding officeId/tenant relation scope, or add a tight tenant-scope:ignore comment only for intentionally global/public lookups.");
  for (const item of findings.slice(0, 80)) {
    console.log(`${item.file}:${item.line} [${item.severity}] ${item.call} - ${item.reason} ${item.hint}`);
  }
  if (findings.length > 80) {
    console.log(`...and ${findings.length - 80} more.`);
  }
}

if (STRICT || STRICT_ARG) {
  process.exit(1);
}

if (!JSON_OUTPUT) {
  console.log("Non-strict mode: report only. Set STRICT_TENANT_SCOPE=1 or pass --strict to fail on findings.");
}
