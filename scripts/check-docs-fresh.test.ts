import fs from "fs";
import path from "path";
import { checkDocsFreshness } from "./check-docs-fresh";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function writeDoc(root: string, rel: string, contents: string) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return file;
}

function main() {
  const tmp = process.cwd();
  const created: string[] = [];
  try {
    const missing = writeDoc(tmp, "docs/current-state/__tmp-missing.md", "# Missing\n");
    const valid = writeDoc(tmp, "docs/current-state/__tmp-valid.md", "Status: current-state\nOwner: eng\nLast-verified: 2026-06-23\nSource-of-truth: test\n\n# Valid\n");
    const badDate = writeDoc(tmp, "docs/current-state/__tmp-bad-date.md", "Status: current-state\nLast-verified: yesterday\n\n# Bad\n");
    const plan = writeDoc(tmp, "docs/plans/__tmp-plan.md", "Status: plan\nOwner: eng\n\n# Plan\n");
    const legacy = writeDoc(tmp, "docs/__tmp-legacy.md", "# Legacy doc without opt-in status\n");
    created.push(missing, valid, badDate, plan, legacy);

    const issues = checkDocsFreshness([missing, valid, badDate, plan, legacy]);
    assert(issues.some((issue) => issue.file.endsWith("missing.md") && issue.message.includes("Missing Status")), "missing status should be reported");
    assert(!issues.some((issue) => issue.file.endsWith("valid.md")), "valid current-state doc should pass");
    assert(issues.some((issue) => issue.file.endsWith("bad-date.md") && issue.message.includes("Invalid Last-verified")), "bad Last-verified should fail");
    assert(!issues.some((issue) => issue.file.endsWith("plan.md")), "plan docs should not require Last-verified");
    assert(!issues.some((issue) => issue.file.endsWith("legacy.md")), "legacy docs without opt-in status should not be forced");

    console.log(JSON.stringify({ ok: true, issueCount: issues.length }, null, 2));
  } finally {
    for (const file of created) fs.rmSync(file, { force: true });
  }
}

main();
