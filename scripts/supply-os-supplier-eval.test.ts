import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ComponentSupplierResearchInput } from "../src/lib/supply-os/component-supplier-research";
import type { GuildSourcingLine } from "../src/lib/supply-os/guild-sourcing-items";
import type { SupplierResearchCampaignAttempt } from "../src/lib/supply-os/supplier-research-campaign";
import type { SupplierCandidate, SupplierResearchResult } from "../src/lib/supply-os/research";
import {
  parseSupplierEvalArgs,
  readSupplierEvalCheckpoint,
  runSupplierEval,
  type SupplierEvalDependencies,
} from "./supply-os-supplier-eval";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function providerOutput(input: ComponentSupplierResearchInput) {
  const provider = input.requiredProvider!;
  const records: [] = [];
  return {
    candidates: [],
    sources: [],
    warnings: [],
    publicSupplierLeadReceipts: [],
    retrieval: provider === "EXA" ? {
      provider: "EXA",
      freshnessPolicy: "FORCED_LIVE",
      searchRequestId: "exa-search",
      contentsRequestId: "exa-contents",
      searchHttpStatus: 200,
      contentsHttpStatus: 200,
      searchResponseHash: "a".repeat(64),
      contentsResponseHash: "b".repeat(64),
      retrievedAt: new Date().toISOString(),
      records,
    } : {
      provider: "OPENAI",
      freshnessPolicy: "SERVER_RETRIEVED",
      stage: "CONTENTS_COMPLETE",
      searchRequestId: "openai-search",
      contentsRequestId: "openai-contents",
      searchHttpStatus: 200,
      contentsHttpStatus: 200,
      searchResponseHash: "c".repeat(64),
      contentsResponseHash: hash(JSON.stringify(records)),
      retrievedAt: new Date().toISOString(),
      records,
    },
  };
}

function candidate(line: GuildSourcingLine, index: number): SupplierCandidate {
  const sourceUrl = `https://supplier-${line.item}-${index}.example.com/products`;
  const unknown = {
    value: null,
    state: "UNKNOWN" as const,
    confidence: null,
    sources: [],
    observedAt: null,
    freshness: "UNKNOWN" as const,
  };
  return {
    id: `${line.sku}-${index}`,
    officeId: "supplier-eval-office",
    workspaceId: "supplier-eval-workspace",
    componentItemKey: line.sku,
    companyName: `Supplier ${line.item} ${index}`,
    website: `https://supplier-${line.item}-${index}.example.com`,
    roles: ["DISTRIBUTOR"],
    country: unknown,
    facility: unknown,
    productCapability: {
      value: line.specification,
      state: "SUPPORTED",
      confidence: 1,
      sources: [{ url: sourceUrl, sourceType: "PUBLIC" }],
      observedAt: new Date().toISOString(),
      freshness: "UNKNOWN",
    },
    price: unknown,
    currency: unknown,
    unitOfMeasure: unknown,
    minimumOrderQuantity: unknown,
    leadTimeDays: unknown,
    sourceUrls: [sourceUrl],
    status: "REVIEW_REQUIRED",
    approvedByUserId: null,
    approvedAt: null,
    cautions: [],
  };
}

function aggregateBySuccessfulAttempt(multiplier: number) {
  return (line: GuildSourcingLine, attempts: SupplierResearchCampaignAttempt[]): SupplierResearchResult => {
    const count = Math.min(5, attempts.filter((attempt) => attempt.status === "SUCCEEDED").length * multiplier);
    const candidates = Array.from({ length: count }, (_, index) => candidate(line, index + 1));
    return {
      candidates,
      sources: candidates.flatMap((value) => value.productCapability.sources),
      degraded: count < 3,
      warnings: [],
    };
  };
}

function dependencies(args: {
  aggregateMultiplier?: number;
  search?: SupplierEvalDependencies["search"];
  calls?: ComponentSupplierResearchInput[];
}) {
  let sequence = 0;
  const calls = args.calls ?? [];
  return {
    search: args.search ?? (async (input) => {
      calls.push(input);
      return providerOutput(input);
    }),
    evaluate: ((input, capture) => ({
      receipts: [],
      decisions: [{
        code: "CAPTURE_NO_RECORDS",
        stage: "CAPTURE",
        accepted: false,
        provider: capture.provider,
        itemKey: input.componentItemKey,
        queryProfile: "GENERIC_COTS",
        recordIndex: null,
        searchRank: null,
        sourceUrl: null,
        sourceHostname: null,
        proposedRole: null,
      }],
    })) satisfies SupplierEvalDependencies["evaluate"],
    aggregate: aggregateBySuccessfulAttempt(args.aggregateMultiplier ?? 1),
    now: () => new Date(),
    randomId: () => `id-${++sequence}`,
    environment: { EXA_API_KEY: "configured", OPENAI_API_KEY: "configured" },
    log: () => {},
  } satisfies SupplierEvalDependencies;
}

async function main() {
const root = await mkdtemp(join(tmpdir(), "supplier-eval-test-"));

assert.throws(
  () => parseSupplierEvalArgs(["--target=2"]),
  /fixed at --target=3 and --retain=5/i,
  "the command cannot weaken production acceptance",
);
assert.throws(() => parseSupplierEvalArgs(["--concurrency=3"]), /integer from 1 to 2/i, "live concurrency stays bounded");

const missingConfigCheckpoint = join(root, "missing-config", "guild.json");
await assert.rejects(
  () => runSupplierEval(parseSupplierEvalArgs([
    "--provider=both",
    "--ids=001",
    `--checkpoint=${missingConfigCheckpoint}`,
  ]), {
    ...dependencies({}),
    environment: {},
  }),
  /missing provider configuration/i,
);
await assert.rejects(() => stat(missingConfigCheckpoint), /ENOENT/, "missing keys fail before creating a checkpoint");

const freshBothCalls: ComponentSupplierResearchInput[] = [];
const freshBoth = await runSupplierEval(parseSupplierEvalArgs([
  "--provider=both",
  "--ids=001",
  `--checkpoint=${join(root, "fresh-both", "guild.json")}`,
]), dependencies({ aggregateMultiplier: 3, calls: freshBothCalls }));
assert.equal(freshBoth.exitCode, 2);
assert.deepEqual(freshBothCalls.map((input) => input.requiredProvider), ["EXA", "OPENAI"], "both mode runs both same-ordinal providers even when the first result completes the line");
assert.deepEqual(freshBoth.checkpoint.attempts.map((attempt) => attempt.providerAttemptNumber), [1, 1]);
assert.deepEqual(freshBoth.scorecard.lines.find((line) => line.itemKey === "GUILD-001")?.providerCaptures, { EXA: true, OPENAI: true });

const baselineResumeCalls: ComponentSupplierResearchInput[] = [];
const baselineResumePath = join(root, "baseline-resume", "guild.json");
await runSupplierEval(parseSupplierEvalArgs([
  "--provider=both",
  "--ids=001",
  "--max-calls=1",
  `--checkpoint=${baselineResumePath}`,
]), dependencies({ calls: baselineResumeCalls }));
const baselineResumed = await runSupplierEval(parseSupplierEvalArgs([
  "--provider=both",
  "--ids=001",
  "--max-calls=1",
  `--checkpoint=${baselineResumePath}`,
  "--resume",
]), dependencies({ calls: baselineResumeCalls }));
assert.deepEqual(
  baselineResumed.checkpoint.attempts.map((attempt) => [attempt.provider, attempt.providerAttemptNumber]),
  [["EXA", 1], ["OPENAI", 1]],
  "a normal resume fills the missing provider baseline before starting another provider round",
);

let releaseSlowCall!: () => void;
const slowCall = new Promise<void>((resolve) => {
  releaseSlowCall = resolve;
});
const settlingCheckpoint = join(root, "settling", "guild.json");
const settlingRun = runSupplierEval(parseSupplierEvalArgs([
  "--provider=EXA",
  "--ids=001,002",
  "--max-calls=2",
  "--concurrency=2",
  `--checkpoint=${settlingCheckpoint}`,
]), dependencies({
  aggregateMultiplier: 3,
  search: async (input) => {
    if (input.componentItemKey === "request:guild-002") await slowCall;
    return providerOutput(input);
  },
}));
let settledWhileSiblingRunning = false;
for (let poll = 0; poll < 600; poll += 1) {
  try {
    const checkpoint = await readSupplierEvalCheckpoint(settlingCheckpoint);
    settledWhileSiblingRunning = checkpoint.attempts.some((attempt) => (
      (attempt.input as Record<string, unknown>).campaignItemKey === "GUILD-001" && attempt.status === "SUCCEEDED"
    )) && checkpoint.attempts.some((attempt) => (
      (attempt.input as Record<string, unknown>).campaignItemKey === "GUILD-002" && attempt.status === "RUNNING"
    ));
    if (settledWhileSiblingRunning) break;
  } catch {
    // The initial atomic rename may not have completed yet.
  }
  await new Promise((resolve) => setTimeout(resolve, 5));
}
releaseSlowCall();
await settlingRun;
assert.equal(settledWhileSiblingRunning, true, "each provider completion is checkpointed while a concurrent sibling is still running");

const bothCalls: ComponentSupplierResearchInput[] = [];
const resumeCheckpoint = join(root, "resume", "guild.json");
const first = await runSupplierEval(parseSupplierEvalArgs([
  "--provider=both",
  "--ids=001",
  "--max-calls=1",
  `--checkpoint=${resumeCheckpoint}`,
]), dependencies({ calls: bothCalls }));
assert.equal(first.exitCode, 2, "a one-line partial run is incomplete");
assert.equal(first.checkpoint.attempts.length, 1, "a zero start records its first immutable attempt");
assert.equal(first.checkpoint.attempts[0]?.provider, "EXA");
assert.equal(first.checkpoint.attempts[0]?.providerAttemptNumber, 1);
assert.equal(first.checkpoint.attempts[0]?.input && (first.checkpoint.attempts[0].input as Record<string, unknown>).componentItemKey, "request:guild-001");
assert.equal((first.checkpoint.attempts[0]?.input as Record<string, unknown>).campaignItemKey, "GUILD-001");
assert.equal((first.checkpoint.attempts[0]?.input as Record<string, unknown>).officeId, undefined, "synthetic scope is never persisted in the production attempt input");

const resumed = await runSupplierEval(parseSupplierEvalArgs([
  "--provider=both",
  "--ids=001",
  "--until-complete",
  "--max-calls=2",
  `--checkpoint=${resumeCheckpoint}`,
  "--resume",
]), dependencies({ calls: bothCalls }));
assert.equal(resumed.exitCode, 2, "a completed subset does not claim the 38-line acceptance pass");
assert.deepEqual(
  resumed.checkpoint.attempts.map((attempt) => [attempt.provider, attempt.providerAttemptNumber]),
  [["EXA", 1], ["OPENAI", 1], ["EXA", 2]],
  "both mode alternates exact provider pins while keeping separate provider ordinals",
);
assert.deepEqual(bothCalls.map((input) => input.requiredProvider), ["EXA", "OPENAI", "EXA"]);
assert.ok(bothCalls.every((input) => input.officeId === "supplier-eval-office" && input.workspaceId === "supplier-eval-workspace"));
const resumedLine = resumed.scorecard.lines.find((line) => line.itemKey === "GUILD-001");
assert.deepEqual(resumedLine?.providerAttempts, { EXA: 2, OPENAI: 1 });
assert.equal(resumedLine?.rejectionHistogram.CAPTURE_NO_RECORDS, 3, "line diagnostics identify which validator gate rejected each attempt");
assert.ok((await readFile(resumed.markdownPath, "utf8")).includes("CAPTURE_NO_RECORDS=3"));

let revalidateSpend = 0;
const revalidated = await runSupplierEval(parseSupplierEvalArgs([`--revalidate=${resumeCheckpoint}`]), dependencies({
  search: async () => {
    revalidateSpend += 1;
    throw new Error("revalidation must not call a provider");
  },
}));
assert.equal(revalidateSpend, 0, "offline revalidation spends no provider calls");
assert.equal(revalidated.scorecard.callCount, 0);
assert.equal(revalidated.exitCode, 2);

const stored = await readSupplierEvalCheckpoint(resumeCheckpoint);
assert.equal(stored.writeSequence, 6, "the checkpoint records each reservation and one atomic write per completed call");
assert.equal((await stat(resumeCheckpoint)).mode & 0o777, 0o600, "checkpoint contents are owner-only");
assert.equal((await stat(join(root, "resume"))).mode & 0o777, 0o700, "checkpoint directory is owner-only");
assert.equal((await readdir(join(root, "resume"))).some((name) => name.endsWith(".tmp")), false, "atomic checkpoint files are renamed, not left behind");
assert.ok((await readFile(revalidated.jsonPath, "utf8")).includes('"exactPass": false'));
assert.ok((await readFile(revalidated.markdownPath, "utf8")).includes("Coverage:"));

const passCheckpoint = join(root, "pass", "guild.json");
const passed = await runSupplierEval(parseSupplierEvalArgs([
  "--provider=EXA",
  "--ids=all",
  "--max-calls=38",
  "--concurrency=2",
  `--checkpoint=${passCheckpoint}`,
]), dependencies({ aggregateMultiplier: 3 }));
assert.equal(passed.exitCode, 0, "only exact 38-line coverage exits zero");
assert.equal(passed.scorecard.coveredLines, 38);
assert.equal(passed.scorecard.lines.find((line) => line.itemKey === "GUILD-027")?.state, "CLARIFICATION_REQUIRED");
assert.equal(passed.scorecard.lines.find((line) => line.itemKey === "GUILD-039")?.state, "REQUIREMENT_ONLY");
assert.ok(passed.checkpoint.runId, "fresh checkpoints retain an immutable run identity");
assert.ok(String((passed.checkpoint.attempts[0]?.input as Record<string, unknown>).campaignId).includes(passed.checkpoint.runId), "provider campaign IDs are scoped to the checkpoint run identity");
assert.ok((await readFile(passed.markdownPath, "utf8")).includes("Evidence: https://supplier-001-1.example.com/products"), "the Markdown deliverable lists purchasing evidence URLs");

const bothPass = await runSupplierEval(parseSupplierEvalArgs([
  "--provider=both",
  "--ids=all",
  "--concurrency=2",
  `--checkpoint=${join(root, "both-pass", "guild.json")}`,
]), dependencies({ aggregateMultiplier: 3 }));
assert.equal(bothPass.exitCode, 0, "both-provider acceptance requires and records one successful capture from each provider per line");
assert.ok(bothPass.scorecard.lines.filter((line) => line.classification === "SUPPLIER_SEARCH").every((line) => line.providerCaptures.EXA && line.providerCaptures.OPENAI));

const existingParent = await mkdtemp(join(tmpdir(), "supplier-eval-existing-parent-"));
await chmod(existingParent, 0o755);
await runSupplierEval(parseSupplierEvalArgs([
  "--provider=EXA",
  "--ids=001",
  `--checkpoint=${join(existingParent, "guild.json")}`,
]), dependencies({ aggregateMultiplier: 3 }));
assert.equal((await stat(existingParent)).mode & 0o777, 0o755, "a pre-existing checkpoint parent keeps its permissions");

const errorCheckpoint = join(root, "error", "guild.json");
const failed = await runSupplierEval(parseSupplierEvalArgs([
  "--provider=OPENAI",
  "--ids=001",
  "--max-calls=1",
  `--checkpoint=${errorCheckpoint}`,
]), dependencies({
  search: async () => {
    throw Object.assign(new Error("provider rejected the request"), { code: "PROVIDER_RATE_LIMITED" });
  },
}));
assert.equal(failed.exitCode, 1, "provider errors exit one");
assert.equal((failed.checkpoint.attempts[0]?.error as Record<string, unknown>).code, "PROVIDER_RATE_LIMITED");
assert.equal(JSON.stringify(failed.checkpoint).includes("provider rejected the request"), false, "provider error text is not persisted");

const tampered = JSON.parse(await readFile(resumeCheckpoint, "utf8")) as Record<string, unknown>;
tampered.fixtureRevision = "obsolete";
const tamperedPath = join(root, "tampered.json");
await writeFile(tamperedPath, JSON.stringify(tampered));
await assert.rejects(
  () => runSupplierEval(parseSupplierEvalArgs([`--revalidate=${tamperedPath}`]), dependencies({})),
  /fixture revision does not match/i,
  "revalidation refuses a checkpoint from another fixture revision",
);

const malformedPath = join(root, "malformed.json");
await writeFile(malformedPath, '{"private-page-text":"must never escape"');
let malformedMessage = "";
try {
  await readSupplierEvalCheckpoint(malformedPath);
} catch (error) {
  malformedMessage = error instanceof Error ? error.message : String(error);
}
assert.equal(malformedMessage, "Checkpoint JSON is invalid.", "malformed checkpoint errors never echo captured page text");

console.log("supply-os-supplier-eval tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
