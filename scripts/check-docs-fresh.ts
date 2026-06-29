import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DOCS_DIR = path.join(ROOT, "docs");
const VALID_STATUSES = new Set([
  "current-state",
  "plan",
  "brainstorm",
  "report",
  "archived",
  "proposed",
  "active",
  "superseded",
  "rejected",
]);
const GOVERNED_DIRS = [
  "docs/current-state/",
  "docs/plans/",
  "docs/decisions/",
  "docs/brain/",
  "docs/sops/",
  "docs/agent-journal/",
];

type Issue = { file: string; message: string };

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return entry.isFile() && entry.name.endsWith(".md") ? [fullPath] : [];
  });
}

function relative(file: string) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

function isTemplate(file: string) {
  const rel = relative(file);
  return rel.startsWith("docs/templates/");
}

function isArchived(file: string) {
  return relative(file).startsWith("docs/archive/");
}

function shouldRequireStatus(file: string) {
  const rel = relative(file);
  if (isTemplate(file) || isArchived(file)) return false;
  if (GOVERNED_DIRS.some((prefix) => rel.startsWith(prefix))) return true;
  return /^Status:\s*/m.test(fs.readFileSync(file, "utf8").slice(0, 1000));
}

function statusLine(contents: string) {
  return contents.slice(0, 1000).split(/\r?\n/).find((line) => /^Status:\s*/.test(line));
}

function lastVerifiedLine(contents: string) {
  return contents.slice(0, 1000).split(/\r?\n/).find((line) => /^Last-verified:\s*/.test(line));
}

export function checkDocsFreshness(files = walk(DOCS_DIR)) {
  const issues: Issue[] = [];
  for (const file of files) {
    if (!shouldRequireStatus(file)) continue;
    const rel = relative(file);
    const contents = fs.readFileSync(file, "utf8");
    const status = statusLine(contents);
    if (!status) {
      issues.push({ file: rel, message: "Missing Status: line near the top." });
      continue;
    }
    const value = status.replace(/^Status:\s*/, "").trim();
    if (!VALID_STATUSES.has(value)) {
      issues.push({ file: rel, message: `Invalid Status "${value}". Use one of: ${[...VALID_STATUSES].join(", ")}.` });
    }
    if (value === "current-state") {
      const lastVerified = lastVerifiedLine(contents);
      if (!lastVerified) {
        issues.push({ file: rel, message: "Status current-state requires Last-verified: YYYY-MM-DD near the top." });
      } else {
        const date = lastVerified.replace(/^Last-verified:\s*/, "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) {
          issues.push({ file: rel, message: `Invalid Last-verified "${date}". Use YYYY-MM-DD.` });
        }
      }
    }
  }
  return issues;
}

if (require.main === module) {
  const issues = checkDocsFreshness();
  if (issues.length > 0) {
    console.error("Documentation freshness check failed:");
    for (const issue of issues) {
      console.error(`- ${issue.file}: ${issue.message}`);
    }
    process.exit(1);
  }
  console.log("Documentation freshness check passed.");
}
