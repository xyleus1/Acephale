import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, readdir, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ComponentSupplierResearchInput } from "../src/lib/supply-os/component-supplier-research";
import type { GuildSourcingLine } from "./fixtures/legacy-supply-os/guild-sourcing-items";
import type { SupplierResearchCampaignAttempt } from "./fixtures/legacy-supply-os/supplier-research-campaign";
import type { SupplierCandidate, SupplierResearchResult } from "../src/lib/supply-os/research";
import {
  formatSupplierEvalDoctorResult,
  parseSupplierEvalArgs,
  parseSupplierEvalDoctorArgs,
  readSupplierEvalCheckpoint,
  runSupplierEval,
  runSupplierEvalDoctor,
  supplierEvalHelpText,
  supplierEvalMain,
  writeSupplierEvalCheckpointAtomic,
  type SupplierEvalDependencies,
  type SupplierEvalMainDependencies,
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

const help = supplierEvalHelpText();
assert.match(help, /recommended six-line canary/i);
assert.match(help, /--max-calls=12/);
assert.match(help, /--max-calls=228/);
assert.match(help, /12 research attempts/i);
assert.match(help, /228 research attempts/i);
assert.match(help, /one attempt may issue multiple provider HTTP requests/i);
assert.match(help, /not guaranteed/i);
assert.doesNotMatch(help, /--max-calls=76/);
assert.doesNotMatch(help, /provider-call budget/i);
assert.match(help, /--doctor/);
assert.match(help, /--revalidate/);
assert.match(help, /exit codes/i);
assert.match(help, /never paste key values into chat/i);

const dispatchRoot = await mkdtemp(join(tmpdir(), "supplier-eval-dispatch-test-"));
const dispatchDefaultCheckpoint = join(dispatchRoot, ".codex-tmp", "supplier-eval", "guild.json");
const dispatchHelpCheckpoint = join(dispatchRoot, "help-must-not-exist.json");
const dispatchDoctorCheckpoint = join(dispatchRoot, "doctor-must-not-exist.json");
let liveRunnerCalls = 0;
let doctorCalls = 0;
const dispatchLogs: string[] = [];
const dispatchErrors: string[] = [];
const dispatchExitCodes: Array<0 | 1 | 2> = [];
const dispatchDependencies = {
  run: async () => {
    liveRunnerCalls += 1;
    throw new Error("live runner must not be dispatched");
  },
  doctor: async (config) => {
    doctorCalls += 1;
    return runSupplierEvalDoctor(config, {});
  },
  cwd: () => dispatchRoot,
  log: (message) => dispatchLogs.push(message),
  error: (message) => dispatchErrors.push(message),
  setExitCode: (code) => dispatchExitCodes.push(code),
} satisfies Partial<SupplierEvalMainDependencies>;
await supplierEvalMain([], dispatchDependencies);
await supplierEvalMain(["--help", `--checkpoint=${dispatchHelpCheckpoint}`], dispatchDependencies);
await supplierEvalMain([
  "--doctor",
  "--provider=both",
  `--checkpoint=${dispatchDoctorCheckpoint}`,
], dispatchDependencies);
assert.equal(liveRunnerCalls, 0, "no-argument, help, and doctor dispatch never enter the live provider runner");
assert.equal(doctorCalls, 1, "only doctor dispatch runs the read-only doctor");
assert.deepEqual(dispatchExitCodes, [0, 0, 1]);
assert.equal(dispatchErrors.length, 0);
assert.equal(dispatchLogs.filter((message) => message.includes("Derya GUILD supplier evaluation")).length, 2);
assert.ok(dispatchLogs.some((message) => message.includes("Supplier evaluation doctor")));
for (const path of [dispatchDefaultCheckpoint, dispatchHelpCheckpoint, dispatchDoctorCheckpoint]) {
  await assert.rejects(() => stat(path), /ENOENT/, `dispatch must not create ${path}`);
}

assert.throws(
  () => parseSupplierEvalDoctorArgs(["--doctor", "--ids=001"]),
  /accepts only --provider and --checkpoint/i,
  "doctor rejects options that could imply provider work",
);
const doctorCheckpoint = join(root, "doctor", "guild.json");
const missingDoctor = await runSupplierEvalDoctor(
  parseSupplierEvalDoctorArgs(["--doctor", "--provider=both", `--checkpoint=${doctorCheckpoint}`]),
  { EXA_API_KEY: "exa-secret-value" },
);
assert.equal(missingDoctor.exitCode, 1);
assert.equal(missingDoctor.ready, false);
assert.equal(missingDoctor.providerConfiguration.EXA, "CONFIGURED");
assert.equal(missingDoctor.providerConfiguration.OPENAI, "MISSING");
assert.equal(missingDoctor.checkpoint.state, "ABSENT");
assert.equal(missingDoctor.nextAction, "FIX_CONFIGURATION");
assert.equal(formatSupplierEvalDoctorResult(missingDoctor).includes("exa-secret-value"), false, "doctor never prints key values");
await assert.rejects(() => stat(doctorCheckpoint), /ENOENT/, "doctor never creates a checkpoint");

const readyDoctor = await runSupplierEvalDoctor(
  parseSupplierEvalDoctorArgs(["--doctor", "--provider=EXA", `--checkpoint=${doctorCheckpoint}`]),
  { EXA_API_KEY: "configured" },
);
assert.equal(readyDoctor.exitCode, 0);
assert.equal(readyDoctor.ready, true);
assert.equal(readyDoctor.providerConfiguration.OPENAI, "NOT_REQUIRED");
assert.equal(readyDoctor.nextAction, "START");

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

const concurrentCheckpoint = join(root, "concurrent-start", "guild.json");
let releaseConcurrentSearch!: () => void;
const concurrentSearchGate = new Promise<void>((resolve) => {
  releaseConcurrentSearch = resolve;
});
let concurrentProviderSearches = 0;
const concurrentSearch: SupplierEvalDependencies["search"] = async (input) => {
  concurrentProviderSearches += 1;
  await concurrentSearchGate;
  return providerOutput(input);
};
let concurrentASequence = 0;
let concurrentBSequence = 0;
const concurrentArgs = [
  "--provider=EXA",
  "--ids=001",
  "--max-calls=1",
  "--concurrency=1",
  `--checkpoint=${concurrentCheckpoint}`,
];
const concurrentRunA = runSupplierEval(parseSupplierEvalArgs(concurrentArgs), {
  ...dependencies({ aggregateMultiplier: 3, search: concurrentSearch }),
  randomId: () => `concurrent-a-${++concurrentASequence}`,
});
const concurrentRunB = runSupplierEval(parseSupplierEvalArgs(concurrentArgs), {
  ...dependencies({ aggregateMultiplier: 3, search: concurrentSearch }),
  randomId: () => `concurrent-b-${++concurrentBSequence}`,
});
const concurrentSettled = Promise.allSettled([concurrentRunA, concurrentRunB]);
for (let poll = 0; poll < 600 && concurrentProviderSearches === 0; poll += 1) {
  await new Promise((resolve) => setTimeout(resolve, 5));
}
const searchesBeforeRelease = concurrentProviderSearches;
releaseConcurrentSearch();
const concurrentResults = await concurrentSettled;
assert.equal(searchesBeforeRelease, 1, "the checkpoint lock admits only one provider search while the winning process is active");
assert.equal(concurrentProviderSearches, 1, "a simultaneous fresh start cannot issue duplicate provider work");
assert.equal(concurrentResults.filter((result) => result.status === "fulfilled").length, 1);
const rejectedConcurrentRun = concurrentResults.find((result): result is PromiseRejectedResult => result.status === "rejected");
assert.ok(rejectedConcurrentRun);
assert.match(String(rejectedConcurrentRun.reason), /already active in another process/i);
assert.equal((await readSupplierEvalCheckpoint(concurrentCheckpoint)).attempts.length, 1);
await assert.rejects(() => stat(`${concurrentCheckpoint}.lock`), /ENOENT/, "the winning process releases its checkpoint lock");

const staleLiveCheckpoint = join(root, "stale-live-owner", "guild.json");
let releaseStaleLiveSearch!: () => void;
const staleLiveSearchGate = new Promise<void>((resolve) => {
  releaseStaleLiveSearch = resolve;
});
let staleLiveProviderSearches = 0;
let staleLiveOwnerSequence = 0;
const staleLiveOwner = runSupplierEval(parseSupplierEvalArgs([
  "--provider=EXA",
  "--ids=001",
  "--max-calls=1",
  "--concurrency=1",
  `--checkpoint=${staleLiveCheckpoint}`,
]), {
  ...dependencies({
    aggregateMultiplier: 3,
    search: async (input) => {
      staleLiveProviderSearches += 1;
      await staleLiveSearchGate;
      return providerOutput(input);
    },
  }),
  randomId: () => `stale-live-owner-${++staleLiveOwnerSequence}`,
});
for (let poll = 0; poll < 600 && staleLiveProviderSearches === 0; poll += 1) {
  await new Promise((resolve) => setTimeout(resolve, 5));
}
assert.equal(staleLiveProviderSearches, 1);
const staleLockTime = new Date(Date.now() - 16 * 60_000);
await utimes(`${staleLiveCheckpoint}.lock`, staleLockTime, staleLockTime);
await assert.rejects(
  () => runSupplierEval(parseSupplierEvalArgs([
    "--provider=EXA",
    "--ids=001",
    "--max-calls=1",
    "--concurrency=1",
    `--checkpoint=${staleLiveCheckpoint}`,
  ]), dependencies({ aggregateMultiplier: 3 })),
  /owner process is still running or cannot be verified/i,
  "elapsed time cannot steal a lock from a process that may still complete provider work",
);
assert.equal(staleLiveProviderSearches, 1);
releaseStaleLiveSearch();
await staleLiveOwner;
assert.equal((await readSupplierEvalCheckpoint(staleLiveCheckpoint)).attempts.length, 1);
await assert.rejects(() => stat(`${staleLiveCheckpoint}.lock`), /ENOENT/);

const deadOwnerCheckpoint = join(root, "dead-owner-recovery.json");
const deadOwnerLock = `${deadOwnerCheckpoint}.lock`;
await writeFile(deadOwnerLock, `${JSON.stringify({ token: "dead-owner", pid: 99_999_999, acquiredAt: staleLockTime.toISOString() })}\n`, { mode: 0o600 });
await utimes(deadOwnerLock, staleLockTime, staleLockTime);
let deadOwnerRecoverySearches = 0;
await runSupplierEval(parseSupplierEvalArgs([
  "--provider=EXA",
  "--ids=001",
  "--max-calls=1",
  `--checkpoint=${deadOwnerCheckpoint}`,
]), dependencies({
  aggregateMultiplier: 3,
  search: async (input) => {
    deadOwnerRecoverySearches += 1;
    return providerOutput(input);
  },
}));
assert.equal(deadOwnerRecoverySearches, 1, "a stale lock is recoverable only after its recorded process is dead");
await assert.rejects(() => stat(deadOwnerLock), /ENOENT/);

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

const resumeFairnessCalls: ComponentSupplierResearchInput[] = [];
const resumeFairnessPath = join(root, "resume-fairness", "guild.json");
const resumeFairnessDependencies = dependencies({
  search: async (input) => {
    resumeFairnessCalls.push(input);
    throw Object.assign(new Error("line-specific timeout"), { code: "PROVIDER_TIMEOUT" });
  },
});
for (let invocation = 0; invocation < 4; invocation += 1) {
  const result = await runSupplierEval(parseSupplierEvalArgs([
    "--provider=both",
    "--ids=001,002",
    "--max-calls=1",
    "--concurrency=1",
    `--checkpoint=${resumeFairnessPath}`,
    ...(invocation > 0 ? ["--resume"] : []),
  ]), resumeFairnessDependencies);
  assert.equal(result.exitCode, 1);
}
assert.deepEqual(
  resumeFairnessCalls.map((input) => [input.componentItemKey, input.requiredProvider]),
  [
    ["request:guild-001", "EXA"],
    ["request:guild-001", "OPENAI"],
    ["request:guild-002", "EXA"],
    ["request:guild-002", "OPENAI"],
  ],
  "repeated one-attempt resumes prioritize never-attempted line/provider baselines over historically failing pairs",
);

const rotationCalls: ComponentSupplierResearchInput[] = [];
const rotationSources = Array.from({ length: 12 }, (_, index) => ({
  url: `https://source-${String(index + 1).padStart(2, "0")}.example.com/products`,
  sourceType: "PUBLIC" as const,
}));
await runSupplierEval(parseSupplierEvalArgs([
  "--provider=EXA",
  "--ids=001",
  "--until-complete",
  "--max-calls=10",
  "--concurrency=1",
  `--checkpoint=${join(root, "rotating-exclusions", "guild.json")}`,
]), {
  ...dependencies({ calls: rotationCalls }),
  aggregate: () => ({ candidates: [], sources: rotationSources, degraded: true, warnings: [] }),
});
assert.equal(rotationCalls.length, 10);
assert.deepEqual(
  rotationCalls[0]?.excludeDomains,
  rotationSources.slice(0, 8).map((source) => new URL(source.url).hostname),
  "the first exploration epoch excludes the first bounded domain window",
);
assert.deepEqual(rotationCalls[8]?.excludeDomains, rotationCalls[0]?.excludeDomains, "all nine query variants share one exclusion window");
assert.deepEqual(
  rotationCalls[9]?.excludeDomains,
  [...rotationSources.slice(8), ...rotationSources.slice(0, 4)].map((source) => new URL(source.url).hostname),
  "the next exploration epoch rotates beyond the alphabetically first eight domains",
);

const fairCalls: ComponentSupplierResearchInput[] = [];
await runSupplierEval(parseSupplierEvalArgs([
  "--provider=EXA",
  "--ids=001,002,003",
  "--until-complete",
  "--max-calls=6",
  "--concurrency=1",
  `--checkpoint=${join(root, "fair-line-rotation", "guild.json")}`,
]), {
  ...dependencies({ calls: fairCalls }),
  aggregate: () => ({ candidates: [], sources: [], degraded: true, warnings: [] }),
});
assert.deepEqual(
  fairCalls.map((input) => input.componentItemKey),
  [
    "request:guild-001",
    "request:guild-002",
    "request:guild-003",
    "request:guild-001",
    "request:guild-002",
    "request:guild-003",
  ],
  "post-baseline exploration advances incomplete lines by least attempt count instead of starving later lines",
);

const invalidCandidateCalls: ComponentSupplierResearchInput[] = [];
await runSupplierEval(parseSupplierEvalArgs([
  "--provider=EXA",
  "--ids=001",
  "--until-complete",
  "--max-calls=2",
  "--concurrency=1",
  `--checkpoint=${join(root, "invalid-candidate-completion", "guild.json")}`,
]), {
  ...dependencies({ calls: invalidCandidateCalls }),
  aggregate: (line) => {
    const candidates = Array.from({ length: 3 }, (_, index) => ({
      ...candidate(line, index + 1),
      officeId: "wrong-office",
    }));
    return {
      candidates,
      sources: candidates.flatMap((value) => value.productCapability.sources),
      degraded: false,
      warnings: [],
    };
  },
});
assert.equal(invalidCandidateCalls.length, 2, "three candidates that fail final scope proof do not stop until-complete planning");

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
let runningCheckpoint: Awaited<ReturnType<typeof readSupplierEvalCheckpoint>> | null = null;
for (let poll = 0; poll < 600; poll += 1) {
  try {
    const checkpoint = await readSupplierEvalCheckpoint(settlingCheckpoint);
    settledWhileSiblingRunning = checkpoint.attempts.some((attempt) => (
      (attempt.input as Record<string, unknown>).campaignItemKey === "GUILD-001" && attempt.status === "SUCCEEDED"
    )) && checkpoint.attempts.some((attempt) => (
      (attempt.input as Record<string, unknown>).campaignItemKey === "GUILD-002" && attempt.status === "RUNNING"
    ));
    if (settledWhileSiblingRunning) {
      runningCheckpoint = checkpoint;
      break;
    }
  } catch {
    // The initial atomic rename may not have completed yet.
  }
  await new Promise((resolve) => setTimeout(resolve, 5));
}
assert.equal(settledWhileSiblingRunning, true, "each provider completion is checkpointed while a concurrent sibling is still running");
assert.ok(runningCheckpoint);
const runningObservationTime = new Date();
const busyDoctor = await runSupplierEvalDoctor(
  parseSupplierEvalDoctorArgs(["--doctor", "--provider=EXA", `--checkpoint=${settlingCheckpoint}`]),
  { EXA_API_KEY: "configured" },
  () => runningObservationTime,
);
assert.equal(busyDoctor.exitCode, 1);
assert.equal(busyDoctor.ready, false);
assert.equal(busyDoctor.checkpoint.state, "BUSY");
assert.equal(busyDoctor.checkpoint.activeRunningAttempts, 1);
assert.equal(busyDoctor.checkpoint.staleRunningAttempts, 0);
assert.equal(busyDoctor.nextAction, "WAIT_FOR_ACTIVE_RUN");

let concurrentResumeSearches = 0;
await assert.rejects(
  () => runSupplierEval(parseSupplierEvalArgs([
    "--provider=EXA",
    "--ids=001,002",
    "--max-calls=1",
    `--checkpoint=${settlingCheckpoint}`,
    "--resume",
  ]), {
    ...dependencies({
      search: async (input) => {
        concurrentResumeSearches += 1;
        return providerOutput(input);
      },
    }),
    now: () => runningObservationTime,
  }),
  /already active in another process/i,
  "the checkpoint lock rejects a concurrent resume before it can inspect or mutate active work",
);
assert.equal(concurrentResumeSearches, 0);

const freshRunningCopyPath = join(root, "fresh-running-resume", "guild.json");
await writeSupplierEvalCheckpointAtomic(freshRunningCopyPath, structuredClone(runningCheckpoint), () => "fresh-copy");
await assert.rejects(
  () => runSupplierEval(parseSupplierEvalArgs([
    "--provider=EXA",
    "--ids=001,002",
    "--max-calls=1",
    `--checkpoint=${freshRunningCopyPath}`,
    "--resume",
  ]), {
    ...dependencies({
      search: async (input) => {
        concurrentResumeSearches += 1;
        return providerOutput(input);
      },
    }),
    now: () => runningObservationTime,
  }),
  /active RUNNING research attempts/i,
  "resume fails closed on a fresh RUNNING attempt even when no lock file remains",
);
assert.equal(concurrentResumeSearches, 0);
await assert.rejects(() => stat(`${freshRunningCopyPath}.lock`), /ENOENT/);

const staleCheckpointPath = join(root, "stale-resume", "guild.json");
const staleCheckpoint = structuredClone(runningCheckpoint);
const staleUpdatedAt = new Date(runningObservationTime.getTime() - 16 * 60_000).toISOString();
for (const attempt of staleCheckpoint.attempts) {
  if (attempt.status === "RUNNING") attempt.updatedAt = staleUpdatedAt;
}
staleCheckpoint.updatedAt = staleUpdatedAt;
await writeSupplierEvalCheckpointAtomic(staleCheckpointPath, staleCheckpoint, () => "stale-copy");
releaseSlowCall();
await settlingRun;

const staleDoctor = await runSupplierEvalDoctor(
  parseSupplierEvalDoctorArgs(["--doctor", "--provider=EXA", `--checkpoint=${staleCheckpointPath}`]),
  { EXA_API_KEY: "configured" },
  () => runningObservationTime,
);
assert.equal(staleDoctor.exitCode, 0);
assert.equal(staleDoctor.ready, true);
assert.equal(staleDoctor.checkpoint.state, "STALE_RESUMABLE");
assert.equal(staleDoctor.checkpoint.activeRunningAttempts, 0);
assert.equal(staleDoctor.checkpoint.staleRunningAttempts, 1);
assert.equal(staleDoctor.nextAction, "RESUME_STALE");

const staleResumeCalls: ComponentSupplierResearchInput[] = [];
const staleResumed = await runSupplierEval(parseSupplierEvalArgs([
  "--provider=EXA",
  "--ids=001,002",
  "--max-calls=1",
  `--checkpoint=${staleCheckpointPath}`,
  "--resume",
]), {
  ...dependencies({ calls: staleResumeCalls }),
  now: () => runningObservationTime,
});
const interruptedAttempt = staleResumed.checkpoint.attempts.find((attempt) => attempt.id === staleCheckpoint.attempts.find((attempt) => attempt.status === "RUNNING")?.id);
assert.equal(interruptedAttempt?.status, "FAILED");
assert.equal((interruptedAttempt?.error as Record<string, unknown>).code, "INTERRUPTED");
assert.equal(staleResumeCalls.length, 1, "stale resume interrupts the abandoned attempt before issuing one new bounded attempt");

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

const validDoctor = await runSupplierEvalDoctor(
  parseSupplierEvalDoctorArgs(["--doctor", "--provider=both", `--checkpoint=${resumeCheckpoint}`]),
  { EXA_API_KEY: "configured", OPENAI_API_KEY: "configured" },
);
assert.equal(validDoctor.exitCode, 0);
assert.equal(validDoctor.checkpoint.state, "VALID");
assert.equal(validDoctor.checkpoint.compatible, true);
assert.equal(validDoctor.checkpoint.attempts, 3);
assert.deepEqual(validDoctor.checkpoint.selectedIds, ["GUILD-001"]);
assert.match(formatSupplierEvalDoctorResult(validDoctor), /Checkpoint ids: 001/);
assert.equal(validDoctor.nextAction, "RESUME");

const mismatchedDoctor = await runSupplierEvalDoctor(
  parseSupplierEvalDoctorArgs(["--doctor", "--provider=EXA", `--checkpoint=${resumeCheckpoint}`]),
  { EXA_API_KEY: "configured" },
);
assert.equal(mismatchedDoctor.exitCode, 1);
assert.equal(mismatchedDoctor.checkpoint.state, "VALID");
assert.equal(mismatchedDoctor.checkpoint.compatible, false);
assert.equal(mismatchedDoctor.nextAction, "USE_MATCHING_PROVIDER");

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

const retryableCalls: ComponentSupplierResearchInput[] = [];
const retryableFailure = await runSupplierEval(parseSupplierEvalArgs([
  "--provider=EXA",
  "--ids=001,002",
  "--until-complete",
  "--max-calls=4",
  "--concurrency=1",
  `--checkpoint=${join(root, "retryable-line-error", "guild.json")}`,
]), dependencies({
  aggregateMultiplier: 1,
  search: async (input) => {
    retryableCalls.push(input);
    if (input.componentItemKey === "request:guild-001") {
      throw Object.assign(new Error("temporary line failure"), { code: "PROVIDER_TIMEOUT" });
    }
    return providerOutput(input);
  },
}));
assert.equal(retryableFailure.exitCode, 1, "any provider error keeps the invocation exit nonzero");
assert.deepEqual(
  retryableCalls.map((input) => input.componentItemKey),
  ["request:guild-001", "request:guild-002", "request:guild-002", "request:guild-002"],
  "a retryable line error is suppressed for this invocation while independent incomplete work continues",
);
assert.equal(retryableFailure.scorecard.failedCalls, 1);
assert.equal(retryableFailure.scorecard.lines.find((line) => line.itemKey === "GUILD-002")?.state, "COMPLETE");

for (const errorCode of ["PROVIDER_AUTHENTICATION_FAILED", "PROVIDER_RATE_LIMITED"] as const) {
  const providerCalls: ComponentSupplierResearchInput[] = [];
  const providerWideFailure = await runSupplierEval(parseSupplierEvalArgs([
    "--provider=both",
    "--ids=001,002",
    "--max-calls=4",
    "--concurrency=1",
    `--checkpoint=${join(root, `provider-wide-${errorCode.toLowerCase()}`, "guild.json")}`,
  ]), dependencies({
    aggregateMultiplier: 3,
    search: async (input) => {
      providerCalls.push(input);
      if (input.requiredProvider === "EXA") {
        throw Object.assign(new Error("provider-wide failure"), { code: errorCode });
      }
      return providerOutput(input);
    },
  }));
  assert.equal(providerWideFailure.exitCode, 1);
  assert.equal(providerCalls.filter((input) => input.requiredProvider === "EXA").length, 1, `${errorCode} suppresses repeated EXA calls`);
  assert.equal(providerCalls.filter((input) => input.requiredProvider === "OPENAI").length, 2, `${errorCode} still allows independent OpenAI work`);
  assert.deepEqual(
    providerCalls.filter((input) => input.requiredProvider === "OPENAI").map((input) => input.componentItemKey),
    ["request:guild-001", "request:guild-002"],
  );
}

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

const malformedDoctor = await runSupplierEvalDoctor(
  parseSupplierEvalDoctorArgs(["--doctor", "--provider=both", `--checkpoint=${malformedPath}`]),
  { EXA_API_KEY: "configured", OPENAI_API_KEY: "configured" },
);
assert.equal(malformedDoctor.exitCode, 1);
assert.equal(malformedDoctor.checkpoint.state, "INVALID");
assert.equal(malformedDoctor.nextAction, "REPLACE_INVALID_CHECKPOINT");
assert.equal(JSON.stringify(malformedDoctor).includes("private-page-text"), false, "doctor does not leak invalid checkpoint contents");

console.log("supply-os-supplier-eval tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
