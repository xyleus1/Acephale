import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

type CopyRule = {
  name: string;
  pattern: RegExp;
  scope: "ui" | "all-source";
};

type CopyException = {
  file: string;
  exactText: string;
  reason: string;
};

const root = process.cwd();

const rules: CopyRule[] = [
  {
    name: "retired product name",
    pattern: new RegExp("\\bSupply" + " OS\\b", "giu"),
    scope: "all-source",
  },
  {
    name: "model or AI vendor promoted in product UI",
    pattern: /\b(?:GPT[- ]?\d[\w.-]*|OpenAI|Anthropic|Claude|Gemini)\b/giu,
    scope: "ui",
  },
  {
    name: "generic AI capability claim",
    pattern:
      /\b(?:AI[- ](?:native|powered|linked)|powered by AI|answers? with (?:cited|source-backed|evidence-backed)|intelligent (?:assistant|platform|workflow)|smart (?:assistant|platform|workflow|automation))\b/giu,
    scope: "all-source",
  },
  {
    name: "generic product hype",
    pattern:
      /\b(?:unlock the power|reimagine|revolutionary|cutting[- ]edge|next[- ]generation|seamless(?:ly)?|effortless(?:ly)?|supercharge|game[- ]changing|world[- ]class|best[- ]in[- ]class|all[- ]in[- ]one|one[- ]stop)\b/giu,
    scope: "all-source",
  },
  {
    name: "generic capability tagline",
    pattern:
      /\b(?:products?,\s*inventory,\s*sourcing,\s*and execution|RFQs,\s*target price,\s*forwarder replies|procurement intelligence|candidate bench|company brain|pricing brain|decision brain|brain context|commercial assessment|target price memory|control sheet decision board|data room|managed freight,\s*shared clearly|in one place)\b/giu,
    scope: "ui",
  },
  {
    name: "banned Derya metaphor or slogan",
    pattern:
      /\b(?:cited freight evidence|economic unlock|margin unlock|data unlock|quote flywheel|US trucking wedge|where the next RFQ money is|survive the brain|the brain is refusing|the brain should|(?:pricing|decision|load|commercial decision) brain|brain (?:lab|queue|snapshot|snapshots|recommendation|recommendations|result|results|view|read|changes)|command center|pull trusted market data to light up the map)\b/giu,
    scope: "all-source",
  },
];

// Exceptions must be exact, necessary disclosures or diagnostics. Keep this
// list empty unless the operator needs the named vendor or model to act.
const exceptions: CopyException[] = [];

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [absolute] : [];
  });
}

function lineNumber(source: string, index: number) {
  return source.slice(0, index).split("\n").length;
}

function isExcepted(relativeFile: string, match: string) {
  return exceptions.some(
    (exception) =>
      exception.file === relativeFile &&
      exception.exactText === match &&
      exception.reason.trim().length >= 20
  );
}

const violations: string[] = [];
const files = sourceFiles(path.join(root, "src"));

for (const absoluteFile of files) {
  const relativeFile = path.relative(root, absoluteFile);
  const source = fs.readFileSync(absoluteFile, "utf8");
  const isUiFile =
    relativeFile.endsWith(".tsx") &&
    (relativeFile.startsWith("src/app/") ||
      relativeFile.startsWith("src/components/"));

  for (const rule of rules) {
    if (rule.scope === "ui" && !isUiFile) continue;
    rule.pattern.lastIndex = 0;
    for (const match of source.matchAll(rule.pattern)) {
      const value = match[0];
      if (isExcepted(relativeFile, value)) continue;
      violations.push(
        `${relativeFile}:${lineNumber(source, match.index ?? 0)} ${rule.name}: "${value}"`
      );
    }
  }
}

for (const exception of exceptions) {
  assert.ok(
    fs
      .readFileSync(path.join(root, exception.file), "utf8")
      .includes(exception.exactText),
    `stale product-copy exception for ${exception.file}: ${exception.exactText}`
  );
}

assert.deepEqual(
  violations,
  [],
  `Product copy policy violations:\n${violations.join("\n")}`
);

console.log(`Product copy policy passed across ${files.length} product source files`);
