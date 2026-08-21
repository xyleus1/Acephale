import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { searchComponentSuppliers } from "../src/lib/supply-os/component-supplier-research";
import {
  evaluatePublicSupplierLeadReceipts,
  parseStoredSupplierResearchRetrievalCapture,
  type SupplierResearchRetrievalCapture,
} from "../src/lib/supply-os/exa-supplier-research";
import { GUILD_SOURCING_LINES, type GuildSourcingLine } from "./fixtures/legacy-supply-os/guild-sourcing-items";
import { parseSupplierResearchRouteBody } from "../src/lib/supply-os/supplier-research-route-contract";
import {
  GUILD_SUPPLIER_CAMPAIGN_EVIDENCE_POLICY_VERSION,
  GUILD_SUPPLIER_CAMPAIGN_DELIVERY_LOCATION,
  GUILD_SUPPLIER_CAMPAIGN_EXPLORATION_EPOCH_ATTEMPTS,
  GUILD_SUPPLIER_CAMPAIGN_NEED_BY_DATE,
  GUILD_SUPPLIER_CAMPAIGN_QUERY_VARIANTS,
  GUILD_SUPPLIER_CAMPAIGN_RETAINED_MAXIMUM,
  GUILD_SUPPLIER_CAMPAIGN_TARGET_MINIMUM,
  aggregateGuildSupplierResearchLine,
  guildSupplierResearchAttemptInput,
  type SupplierResearchCampaignAttempt,
  type SupplierResearchProvider,
} from "./fixtures/legacy-supply-os/supplier-research-campaign";
import type { SupplierCandidate, SupplierResearchResult } from "../src/lib/supply-os/research";

const CHECKPOINT_SCHEMA_VERSION = 1;
const FIXED_OFFICE_ID = "supplier-eval-office";
const FIXED_WORKSPACE_ID = "supplier-eval-workspace";
const DEFAULT_CHECKPOINT = ".codex-tmp/supplier-eval/guild.json";
const RUNNING_ATTEMPT_STALE_MS = 15 * 60_000;
const SEARCHABLE_LINES = GUILD_SOURCING_LINES.filter((line) => line.classification === "SUPPLIER_SEARCH");
const SEARCHABLE_IDS = SEARCHABLE_LINES.map((line) => line.sku);

type JsonRecord = Record<string, unknown>;
export type SupplierEvalProviderMode = SupplierResearchProvider | "both";

export type SupplierEvalDoctorConfig = {
  provider: SupplierEvalProviderMode;
  checkpointPath: string;
};

export type SupplierEvalDoctorResult = {
  exitCode: 0 | 1;
  provider: SupplierEvalProviderMode;
  providerConfiguration: Record<SupplierResearchProvider, "CONFIGURED" | "MISSING" | "NOT_REQUIRED">;
  checkpoint: {
    path: string;
    state: "ABSENT" | "VALID" | "BUSY" | "STALE_RESUMABLE" | "INVALID";
    compatible: boolean;
    storedProvider: SupplierEvalProviderMode | null;
    selectedLines: number | null;
    selectedIds: string[] | null;
    attempts: number | null;
    succeededAttempts: number | null;
    runningAttempts: number | null;
    activeRunningAttempts: number | null;
    staleRunningAttempts: number | null;
    failedAttempts: number | null;
  };
  ready: boolean;
  nextAction: "START" | "RESUME" | "RESUME_STALE" | "WAIT_FOR_ACTIVE_RUN" | "FIX_CONFIGURATION" | "REPLACE_INVALID_CHECKPOINT" | "USE_MATCHING_PROVIDER";
};

export type SupplierEvalConfig = {
  mode: "run" | "revalidate";
  provider: SupplierEvalProviderMode;
  ids: string[];
  target: 3;
  retain: 5;
  untilComplete: boolean;
  maxCalls: number;
  concurrency: number;
  checkpointPath: string;
  resume: boolean;
};

export type SupplierEvalAttempt = SupplierResearchCampaignAttempt & {
  provider: SupplierResearchProvider;
  providerAttemptNumber: number;
};

export type SupplierEvalCheckpoint = {
  schemaVersion: typeof CHECKPOINT_SCHEMA_VERSION;
  runId: string;
  fixtureRevision: string;
  createdEvidencePolicyVersion: number;
  scopeRevision: string;
  integrityHash: string;
  createdAt: string;
  updatedAt: string;
  writeSequence: number;
  scope: {
    provider: SupplierEvalProviderMode;
    ids: string[];
    target: 3;
    retain: 5;
  };
  attempts: SupplierEvalAttempt[];
};

type ReceiptEvaluation = ReturnType<typeof evaluatePublicSupplierLeadReceipts>;
type SearchInput = Parameters<typeof searchComponentSuppliers>[0];

export type SupplierEvalDependencies = {
  search: (input: SearchInput) => Promise<unknown>;
  evaluate: (input: Parameters<typeof evaluatePublicSupplierLeadReceipts>[0], capture: SupplierResearchRetrievalCapture) => ReceiptEvaluation;
  aggregate: (line: GuildSourcingLine, attempts: SupplierResearchCampaignAttempt[]) => SupplierResearchResult;
  now: () => Date;
  randomId: () => string;
  environment: Record<string, string | undefined>;
  log: (message: string) => void;
};

export type SupplierEvalLineScore = {
  itemKey: string;
  classification: GuildSourcingLine["classification"];
  leadCount: number;
  attemptCount: number;
  state: "COMPLETE" | "INCOMPLETE" | "CLARIFICATION_REQUIRED" | "REQUIREMENT_ONLY";
  providerAttempts: Record<SupplierResearchProvider, number>;
  providerCaptures: Record<SupplierResearchProvider, boolean>;
  rejectionHistogram: Record<string, number>;
  candidates: Array<{ companyName: string; website: string; sourceUrls: string[] }>;
};

export type SupplierEvalScorecard = {
  fixtureRevision: string;
  scopeRevision: string;
  createdEvidencePolicyVersion: number;
  currentEvidencePolicyVersion: number;
  generatedAt: string;
  exactPass: boolean;
  coveredLines: number;
  searchableLines: 38;
  totalLines: 40;
  callCount: number;
  failedCalls: number;
  rejectionHistogram: Record<string, number>;
  stageHistogram: Record<string, number>;
  lines: SupplierEvalLineScore[];
};

export type SupplierEvalRunResult = {
  exitCode: 0 | 1 | 2;
  checkpoint: SupplierEvalCheckpoint;
  scorecard: SupplierEvalScorecard;
  jsonPath: string;
  markdownPath: string;
};

const defaultDependencies: SupplierEvalDependencies = {
  search: searchComponentSuppliers,
  evaluate: evaluatePublicSupplierLeadReceipts,
  aggregate: aggregateGuildSupplierResearchLine,
  now: () => new Date(),
  randomId: randomUUID,
  environment: process.env,
  log: (message) => console.log(message),
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as JsonRecord)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export function guildSupplierEvalFixtureRevision() {
  return digest({
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    lines: GUILD_SOURCING_LINES,
    target: GUILD_SUPPLIER_CAMPAIGN_TARGET_MINIMUM,
    retain: GUILD_SUPPLIER_CAMPAIGN_RETAINED_MAXIMUM,
    needByDate: GUILD_SUPPLIER_CAMPAIGN_NEED_BY_DATE,
    deliveryLocation: GUILD_SUPPLIER_CAMPAIGN_DELIVERY_LOCATION,
    queryVariants: GUILD_SUPPLIER_CAMPAIGN_QUERY_VARIANTS,
    generatedAttemptContracts: SEARCHABLE_LINES.flatMap((line) => (["EXA", "OPENAI"] as const).map((provider) => guildSupplierResearchAttemptInput({
      line,
      campaignId: "supplier-eval-request-revision",
      attemptNumber: 1,
      requiredProvider: provider,
    }))),
  }).slice(0, 24);
}

function checkpointScopeRevision(scope: SupplierEvalCheckpoint["scope"]) {
  return digest({ fixtureRevision: guildSupplierEvalFixtureRevision(), scope }).slice(0, 24);
}

function checkpointWithoutIntegrity(checkpoint: SupplierEvalCheckpoint) {
  const { integrityHash: _integrityHash, ...unsigned } = checkpoint;
  return unsigned;
}

function checkpointIntegrity(checkpoint: SupplierEvalCheckpoint) {
  return digest(JSON.parse(JSON.stringify(checkpointWithoutIntegrity(checkpoint))));
}

function positiveInteger(value: string | undefined, name: string, minimum: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

function normalizeProvider(value: string | undefined): SupplierEvalProviderMode {
  const rawProvider = (value ?? "both").toUpperCase();
  if (!['EXA', 'OPENAI', 'BOTH'].includes(rawProvider)) throw new Error("--provider must be EXA, OPENAI, or both.");
  return rawProvider === "BOTH" ? "both" : rawProvider as SupplierResearchProvider;
}

function normalizeIds(value: string | undefined) {
  if (!value || value.toLowerCase() === "all") return [...SEARCHABLE_IDS];
  const ids = [...new Set(value.split(",").map((part) => {
    const trimmed = part.trim().toUpperCase();
    return /^\d{3}$/.test(trimmed) ? `GUILD-${trimmed}` : trimmed;
  }).filter(Boolean))];
  if (!ids.length) throw new Error("--ids must contain at least one GUILD line.");
  const invalid = ids.filter((id) => !SEARCHABLE_IDS.includes(id));
  if (invalid.length) throw new Error(`--ids contains non-sourceable or unknown lines: ${invalid.join(", ")}.`);
  return ids.sort();
}

function parsedArguments(argv: string[]) {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument: ${argument}.`);
    const equalsIndex = argument.indexOf("=");
    if (equalsIndex > 2) {
      values.set(argument.slice(2, equalsIndex), argument.slice(equalsIndex + 1));
      continue;
    }
    const name = argument.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      values.set(name, next);
      index += 1;
    } else {
      flags.add(name);
    }
  }
  const supportedValues = new Set(["provider", "ids", "target", "retain", "max-calls", "concurrency", "checkpoint", "revalidate"]);
  const supportedFlags = new Set(["until-complete", "resume"]);
  const unknown = [...values.keys()].filter((name) => !supportedValues.has(name))
    .concat([...flags].filter((name) => !supportedFlags.has(name)));
  if (unknown.length) throw new Error(`Unknown option: --${unknown[0]}.`);
  return { values, flags };
}

export function parseSupplierEvalArgs(argv: string[], cwd = process.cwd()): SupplierEvalConfig {
  const { values, flags } = parsedArguments(argv);
  const revalidate = values.get("revalidate");
  if (revalidate) {
    if (flags.has("resume")) throw new Error("--revalidate and --resume are mutually exclusive.");
    return {
      mode: "revalidate",
      provider: "both",
      ids: [],
      target: 3,
      retain: 5,
      untilComplete: false,
      maxCalls: 0,
      concurrency: 1,
      checkpointPath: resolve(cwd, revalidate),
      resume: false,
    };
  }
  const provider = normalizeProvider(values.get("provider"));
  const target = positiveInteger(values.get("target") ?? "3", "--target", 1, 5);
  const retain = positiveInteger(values.get("retain") ?? "5", "--retain", 1, 5);
  if (target !== 3 || retain !== 5) throw new Error("Production acceptance is fixed at --target=3 and --retain=5.");
  const ids = normalizeIds(values.get("ids"));
  const untilComplete = flags.has("until-complete");
  return {
    mode: "run",
    provider,
    ids,
    target: 3,
    retain: 5,
    untilComplete,
    maxCalls: positiveInteger(values.get("max-calls") ?? String(ids.length * (provider === "both" ? 2 : 1)), "--max-calls", 1, 10_000),
    concurrency: positiveInteger(values.get("concurrency") ?? "2", "--concurrency", 1, 2),
    checkpointPath: resolve(cwd, values.get("checkpoint") ?? DEFAULT_CHECKPOINT),
    resume: flags.has("resume"),
  };
}

export function parseSupplierEvalDoctorArgs(argv: string[], cwd = process.cwd()): SupplierEvalDoctorConfig {
  const doctorCount = argv.filter((argument) => argument === "--doctor").length;
  if (doctorCount !== 1) throw new Error("Use --doctor exactly once.");
  const { values, flags } = parsedArguments(argv.filter((argument) => argument !== "--doctor"));
  const unsupportedValues = [...values.keys()].filter((name) => !["provider", "checkpoint"].includes(name));
  if (unsupportedValues.length || flags.size) {
    const option = unsupportedValues[0] ?? [...flags][0];
    throw new Error(`--doctor accepts only --provider and --checkpoint, not --${option}.`);
  }
  return {
    provider: normalizeProvider(values.get("provider")),
    checkpointPath: resolve(cwd, values.get("checkpoint") ?? DEFAULT_CHECKPOINT),
  };
}

export function supplierEvalHelpText() {
  return [
    "Derya GUILD supplier evaluation",
    "",
    "Runs public supplier discovery directly from the command line. It never contacts or approves a supplier.",
    "",
    "Preflight without provider requests or file writes:",
    "  npm run supply-os:supplier-eval -- --doctor --provider=both --checkpoint=.codex-tmp/supplier-eval/guild.json",
    "",
    "Recommended six-line canary, bounded to 12 research attempts:",
    "  npm run supply-os:supplier-eval -- --provider=both --ids=001,011,017,024,038,040 --target=3 --retain=5 --max-calls=12 --concurrency=2 --checkpoint=.codex-tmp/supplier-eval/guild-canary.json",
    "",
    "Full 38-line bounded exploration, up to 228 research attempts. Completion depends on retrieved evidence and is not guaranteed:",
    "  npm run supply-os:supplier-eval -- --provider=both --ids=all --target=3 --retain=5 --until-complete --max-calls=228 --concurrency=2 --checkpoint=.codex-tmp/supplier-eval/guild.json",
    "",
    "Resume an existing checkpoint:",
    "  Add --resume and repeat the exact provider, ids, target, retain, and checkpoint options used to create it.",
    "",
    "Revalidate saved captures with zero provider requests:",
    "  npm run supply-os:supplier-eval -- --revalidate=.codex-tmp/supplier-eval/guild.json",
    "",
    "Options:",
    "  --provider=EXA|OPENAI|both   Provider stream. Default: both.",
    "  --ids=all|001,002            Sourceable GUILD lines. Default: all 38.",
    "  --target=3                   Fixed production minimum.",
    "  --retain=5                   Fixed production maximum.",
    "  --until-complete             Continue rotating query variants within --max-calls.",
    "  --max-calls=N                Hard research-attempt budget for this invocation.",
    "                               One attempt may issue multiple provider HTTP requests.",
    "  --concurrency=1|2            Concurrent research attempts. Maximum: 2.",
    "  --checkpoint=PATH            Owner-only resumable checkpoint.",
    "  --resume                     Continue a compatible checkpoint.",
    "  --revalidate=PATH            Replay a checkpoint without provider requests.",
    "  --doctor                     Check key presence and checkpoint health only.",
    "  --help, -h                   Print this help and exit.",
    "",
    "Environment:",
    "  EXA_API_KEY and/or OPENAI_API_KEY must already be exported for the selected provider.",
    "  The command reports only whether a key is configured. Never paste key values into chat.",
    "",
    "Exit codes:",
    "  0  Exact acceptance passed, or doctor is ready.",
    "  1  Configuration, checkpoint, or provider failure.",
    "  2  Evidence is valid but the requested sourcing scope remains incomplete.",
  ].join("\n");
}

function newCheckpoint(config: SupplierEvalConfig, now: Date, runId: string): SupplierEvalCheckpoint {
  const scope = { provider: config.provider, ids: [...config.ids], target: 3 as const, retain: 5 as const };
  const checkpoint: SupplierEvalCheckpoint = {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    runId,
    fixtureRevision: guildSupplierEvalFixtureRevision(),
    createdEvidencePolicyVersion: GUILD_SUPPLIER_CAMPAIGN_EVIDENCE_POLICY_VERSION,
    scopeRevision: checkpointScopeRevision(scope),
    integrityHash: "",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    writeSequence: 0,
    scope,
    attempts: [],
  };
  checkpoint.integrityHash = checkpointIntegrity(checkpoint);
  return checkpoint;
}

function assertCheckpoint(value: unknown): SupplierEvalCheckpoint {
  const checkpoint = value as SupplierEvalCheckpoint;
  if (!checkpoint || checkpoint.schemaVersion !== CHECKPOINT_SCHEMA_VERSION) throw new Error("Checkpoint schema revision is unsupported.");
  if (typeof checkpoint.runId !== "string" || !checkpoint.runId.trim()) throw new Error("Checkpoint run identity is invalid.");
  if (!Number.isSafeInteger(checkpoint.createdEvidencePolicyVersion) || checkpoint.createdEvidencePolicyVersion < 1) {
    throw new Error("Checkpoint evidence policy version is invalid.");
  }
  if (checkpoint.fixtureRevision !== guildSupplierEvalFixtureRevision()) throw new Error("Checkpoint fixture revision does not match the current GUILD fixture.");
  if (checkpoint.scopeRevision !== checkpointScopeRevision(checkpoint.scope)) throw new Error("Checkpoint scope revision is invalid.");
  if (checkpoint.integrityHash !== checkpointIntegrity(checkpoint)) throw new Error("Checkpoint integrity hash is invalid.");
  if (!Array.isArray(checkpoint.attempts)) throw new Error("Checkpoint attempts are invalid.");
  return checkpoint;
}

async function checkpointExists(path: string) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (record(error).code === "ENOENT") return false;
    throw error;
  }
}

type SupplierEvalCheckpointLock = {
  path: string;
  token: string;
};

function processIsAlive(pid: unknown) {
  if (!Number.isSafeInteger(pid) || Number(pid) <= 0) return null;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return record(error).code === "ESRCH" ? false : true;
  }
}

async function acquireCheckpointLock(
  checkpointPath: string,
  dependencies: Pick<SupplierEvalDependencies, "now" | "randomId">,
): Promise<SupplierEvalCheckpointLock> {
  const lockPath = `${checkpointPath}.lock`;
  const token = dependencies.randomId();
  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify({ token, pid: process.pid, acquiredAt: dependencies.now().toISOString() })}\n`, "utf8");
      } catch (error) {
        await handle.close();
        await rm(lockPath, { force: true });
        throw error;
      }
      await handle.close();
      await chmod(lockPath, 0o600);
      return { path: lockPath, token };
    } catch (error) {
      if (record(error).code !== "EEXIST") throw error;
      let lockStat;
      try {
        lockStat = await stat(lockPath);
      } catch (statError) {
        if (record(statError).code === "ENOENT") continue;
        throw statError;
      }
      if (dependencies.now().getTime() - lockStat.mtimeMs < RUNNING_ATTEMPT_STALE_MS) {
        throw new Error("Checkpoint is already active in another process. Wait for it to finish before retrying.");
      }
      let ownerAlive: boolean | null = null;
      try {
        ownerAlive = processIsAlive(record(JSON.parse(await readFile(lockPath, "utf8"))).pid);
      } catch {
        ownerAlive = null;
      }
      if (ownerAlive !== false) {
        throw new Error("Checkpoint lock is stale but its owner process is still running or cannot be verified. Stop that process before retrying.");
      }
      const stalePath = `${lockPath}.stale.${process.pid}.${token}`;
      try {
        await rename(lockPath, stalePath);
        await rm(stalePath, { force: true });
      } catch (renameError) {
        if (record(renameError).code !== "ENOENT") throw renameError;
      }
    }
  }
  throw new Error("Checkpoint lock could not be acquired safely.");
}

async function heartbeatCheckpointLock(lock: SupplierEvalCheckpointLock, now: Date) {
  let raw: string;
  try {
    raw = await readFile(lock.path, "utf8");
  } catch {
    throw new Error("Checkpoint ownership was lost. Provider work stopped.");
  }
  let token: unknown;
  try {
    token = record(JSON.parse(raw)).token;
  } catch {
    token = null;
  }
  if (token !== lock.token) throw new Error("Checkpoint ownership was lost. Provider work stopped.");
  await utimes(lock.path, now, now);
}

async function releaseCheckpointLock(lock: SupplierEvalCheckpointLock) {
  try {
    const raw = JSON.parse(await readFile(lock.path, "utf8"));
    if (record(raw).token === lock.token) await rm(lock.path, { force: true });
  } catch {
    // A missing or replaced lock is not safe for this process to remove.
  }
}

export async function readSupplierEvalCheckpoint(path: string) {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (record(error).code === "ENOENT") throw new Error(`Checkpoint does not exist: ${path}.`);
    throw new Error("Checkpoint could not be read.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Checkpoint JSON is invalid.");
  }
  return assertCheckpoint(parsed);
}

function runningAttemptPartitions(checkpoint: SupplierEvalCheckpoint, now: Date) {
  const running = checkpoint.attempts.filter((attempt) => attempt.status === "RUNNING");
  const stale = running.filter((attempt) => {
    const updatedAt = Date.parse(attempt.updatedAt);
    return Number.isFinite(updatedAt) && now.getTime() - updatedAt >= RUNNING_ATTEMPT_STALE_MS;
  });
  const staleIds = new Set(stale.map((attempt) => attempt.id));
  return {
    active: running.filter((attempt) => !staleIds.has(attempt.id)),
    stale,
  };
}

function providerConfigurationStatus(
  provider: SupplierEvalProviderMode,
  environment: Record<string, string | undefined>,
) {
  const required = new Set<SupplierResearchProvider>(provider === "both" ? ["EXA", "OPENAI"] : [provider]);
  return Object.fromEntries((["EXA", "OPENAI"] as const).map((candidate) => [
    candidate,
    required.has(candidate)
      ? environment[candidate === "EXA" ? "EXA_API_KEY" : "OPENAI_API_KEY"]?.trim()
        ? "CONFIGURED"
        : "MISSING"
      : "NOT_REQUIRED",
  ])) as SupplierEvalDoctorResult["providerConfiguration"];
}

export async function runSupplierEvalDoctor(
  config: SupplierEvalDoctorConfig,
  environment: Record<string, string | undefined> = process.env,
  now: () => Date = () => new Date(),
): Promise<SupplierEvalDoctorResult> {
  const providerConfiguration = providerConfigurationStatus(config.provider, environment);
  const requiredProviders = config.provider === "both" ? ["EXA", "OPENAI"] as const : [config.provider];
  const configurationReady = requiredProviders.every((provider) => providerConfiguration[provider] === "CONFIGURED");
  let state: SupplierEvalDoctorResult["checkpoint"]["state"] = "ABSENT";
  let compatible = true;
  let storedProvider: SupplierEvalProviderMode | null = null;
  let selectedLines: number | null = null;
  let selectedIds: string[] | null = null;
  let attempts: number | null = null;
  let succeededAttempts: number | null = null;
  let runningAttempts: number | null = null;
  let activeRunningAttempts: number | null = null;
  let staleRunningAttempts: number | null = null;
  let failedAttempts: number | null = null;
  if (await checkpointExists(config.checkpointPath)) {
    try {
      const checkpoint = await readSupplierEvalCheckpoint(config.checkpointPath);
      storedProvider = checkpoint.scope.provider;
      compatible = storedProvider === config.provider;
      selectedLines = checkpoint.scope.ids.length;
      selectedIds = checkpoint.scope.ids;
      attempts = checkpoint.attempts.length;
      succeededAttempts = checkpoint.attempts.filter((attempt) => attempt.status === "SUCCEEDED").length;
      runningAttempts = checkpoint.attempts.filter((attempt) => attempt.status === "RUNNING").length;
      const running = runningAttemptPartitions(checkpoint, now());
      activeRunningAttempts = running.active.length;
      staleRunningAttempts = running.stale.length;
      state = activeRunningAttempts > 0 ? "BUSY" : staleRunningAttempts > 0 ? "STALE_RESUMABLE" : "VALID";
      failedAttempts = checkpoint.attempts.filter((attempt) => attempt.status === "FAILED").length;
    } catch {
      state = "INVALID";
      compatible = false;
    }
  }
  const ready = configurationReady && !["INVALID", "BUSY"].includes(state) && compatible;
  const nextAction = state === "BUSY"
    ? "WAIT_FOR_ACTIVE_RUN"
    : !configurationReady
      ? "FIX_CONFIGURATION"
      : state === "INVALID"
        ? "REPLACE_INVALID_CHECKPOINT"
        : !compatible
          ? "USE_MATCHING_PROVIDER"
          : state === "STALE_RESUMABLE"
            ? "RESUME_STALE"
            : state === "VALID"
              ? "RESUME"
              : "START";
  return {
    exitCode: ready ? 0 : 1,
    provider: config.provider,
    providerConfiguration,
    checkpoint: {
      path: config.checkpointPath,
      state,
      compatible,
      storedProvider,
      selectedLines,
      selectedIds,
      attempts,
      succeededAttempts,
      runningAttempts,
      activeRunningAttempts,
      staleRunningAttempts,
      failedAttempts,
    },
    ready,
    nextAction,
  };
}

export function formatSupplierEvalDoctorResult(result: SupplierEvalDoctorResult) {
  const nextAction = {
    START: "Start without --resume.",
    RESUME: "Repeat the checkpoint's exact scope and add --resume.",
    RESUME_STALE: "No active attempt remains. Add --resume to mark stale RUNNING work interrupted and continue.",
    WAIT_FOR_ACTIVE_RUN: "Another process may still own this checkpoint. Wait for it to finish before using --resume.",
    FIX_CONFIGURATION: "Export the missing provider key in this shell. Never paste its value into chat.",
    REPLACE_INVALID_CHECKPOINT: "Keep the invalid file for inspection and choose a new checkpoint path.",
    USE_MATCHING_PROVIDER: "Use the checkpoint's stored provider mode, or choose a new checkpoint path.",
  }[result.nextAction];
  const checkpointDetails = !["ABSENT", "INVALID"].includes(result.checkpoint.state)
    ? [
        `Checkpoint provider: ${result.checkpoint.storedProvider}`,
        `Checkpoint selected lines: ${result.checkpoint.selectedLines}`,
        `Checkpoint ids: ${result.checkpoint.selectedIds?.map((id) => id.replace(/^GUILD-/, "")).join(",")}`,
        `Checkpoint attempts: ${result.checkpoint.attempts} total, ${result.checkpoint.succeededAttempts} succeeded, ${result.checkpoint.runningAttempts} running, ${result.checkpoint.failedAttempts} failed`,
        `Running attempts: ${result.checkpoint.activeRunningAttempts} active, ${result.checkpoint.staleRunningAttempts} stale`,
        `Checkpoint compatible: ${result.checkpoint.compatible ? "yes" : "no"}`,
      ]
    : [];
  return [
    "Supplier evaluation doctor",
    `Provider mode: ${result.provider}`,
    `EXA_API_KEY: ${result.providerConfiguration.EXA.toLowerCase()}`,
    `OPENAI_API_KEY: ${result.providerConfiguration.OPENAI.toLowerCase()}`,
    `Checkpoint: ${result.checkpoint.state.toLowerCase()}`,
    `Checkpoint path: ${result.checkpoint.path}`,
    ...checkpointDetails,
    "Sourceable lines: 38",
    "Blocked without research attempts: GUILD-027 clarification required, GUILD-039 requirement only",
    `Ready: ${result.ready ? "yes" : "no"}`,
    `Next: ${nextAction}`,
  ].join("\n");
}

export async function writeSupplierEvalCheckpointAtomic(
  path: string,
  checkpoint: SupplierEvalCheckpoint,
  randomId: () => string = randomUUID,
) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  checkpoint.integrityHash = checkpointIntegrity(checkpoint);
  const temporary = `${path}.${process.pid}.${randomId()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

function sameScope(checkpoint: SupplierEvalCheckpoint, config: SupplierEvalConfig) {
  return checkpoint.scopeRevision === checkpointScopeRevision({
    provider: config.provider,
    ids: config.ids,
    target: 3,
    retain: 5,
  });
}

async function loadCheckpoint(config: SupplierEvalConfig, dependencies: SupplierEvalDependencies) {
  if (config.mode === "revalidate") return readSupplierEvalCheckpoint(config.checkpointPath);
  const exists = await checkpointExists(config.checkpointPath);
  if (config.resume) {
    if (!exists) throw new Error(`Checkpoint does not exist: ${config.checkpointPath}.`);
    const checkpoint = await readSupplierEvalCheckpoint(config.checkpointPath);
    if (!sameScope(checkpoint, config)) throw new Error("Checkpoint scope does not match the requested provider, ids, target, and retain settings.");
    const resumeTime = dependencies.now();
    const running = runningAttemptPartitions(checkpoint, resumeTime);
    if (running.active.length) {
      throw new Error("Checkpoint has active RUNNING research attempts. Wait for the owning process to finish before using --resume.");
    }
    let interrupted = false;
    for (const attempt of running.stale) {
      attempt.status = "FAILED";
      attempt.error = { code: "INTERRUPTED" };
      attempt.failedAt = resumeTime.toISOString();
      attempt.updatedAt = attempt.failedAt;
      interrupted = true;
    }
    if (interrupted) {
      checkpoint.updatedAt = resumeTime.toISOString();
      checkpoint.writeSequence += 1;
      await writeSupplierEvalCheckpointAtomic(config.checkpointPath, checkpoint, dependencies.randomId);
    }
    return checkpoint;
  }
  if (exists) throw new Error(`Checkpoint already exists. Use --resume or choose a new --checkpoint path: ${config.checkpointPath}.`);
  const checkpoint = newCheckpoint(config, dependencies.now(), dependencies.randomId());
  await writeSupplierEvalCheckpointAtomic(config.checkpointPath, checkpoint, dependencies.randomId);
  return checkpoint;
}

function providerForNextAttempt(
  checkpoint: SupplierEvalCheckpoint,
  itemKey: string,
  providers: SupplierResearchProvider[],
): SupplierResearchProvider | null {
  const counts = { EXA: 0, OPENAI: 0 };
  for (const attempt of checkpoint.attempts) {
    if (record(attempt.input).campaignItemKey === itemKey) counts[attempt.provider] += 1;
  }
  return [...providers].sort((left, right) => (
    counts[left] - counts[right] || ["EXA", "OPENAI"].indexOf(left) - ["EXA", "OPENAI"].indexOf(right)
  ))[0] ?? null;
}

function nextProviderOrdinal(checkpoint: SupplierEvalCheckpoint, itemKey: string, provider: SupplierResearchProvider) {
  return checkpoint.attempts.reduce((maximum, attempt) => {
    return record(attempt.input).campaignItemKey === itemKey && attempt.provider === provider
      ? Math.max(maximum, attempt.providerAttemptNumber)
      : maximum;
  }, 0) + 1;
}

function lineProviderAttemptCount(checkpoint: SupplierEvalCheckpoint, itemKey: string, provider: SupplierResearchProvider) {
  return checkpoint.attempts.filter((attempt) => (
    record(attempt.input).campaignItemKey === itemKey && attempt.provider === provider
  )).length;
}

function candidateDomain(candidate: SupplierCandidate) {
  if (!candidate.website) return null;
  try {
    return new URL(candidate.website).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function exclusionDomains(result: SupplierResearchResult, attemptNumber: number) {
  const domains = [...new Set([
    ...result.candidates.flatMap((candidate) => candidateDomain(candidate) ? [candidateDomain(candidate)!] : []),
    ...result.sources.flatMap((source) => {
      try {
        return [new URL(source.url).hostname.toLowerCase().replace(/^www\./, "")];
      } catch {
        return [];
      }
    }),
  ])].sort();
  if (domains.length <= 8) return domains;
  const epochIndex = (BigInt(attemptNumber) - 1n) / BigInt(GUILD_SUPPLIER_CAMPAIGN_EXPLORATION_EPOCH_ATTEMPTS);
  const offset = Number((epochIndex * 8n) % BigInt(domains.length));
  return Array.from({ length: 8 }, (_, index) => domains[(offset + index) % domains.length]);
}

function fixedScopeProviderInput(storedInput: JsonRecord): SearchInput {
  const parsed = parseSupplierResearchRouteBody(storedInput);
  if (!parsed.ok) throw new Error(`Production supplier request parsing rejected ${String(storedInput.campaignItemKey ?? "unknown")}.`);
  const queryVariant = storedInput.queryVariant;
  const queryCycle = storedInput.queryCycle;
  const excludeDomains = storedInput.excludeDomains;
  const requiredProvider = storedInput.requiredProvider;
  if (!['exact-identity', 'official-catalog', 'capability-qa'].includes(String(queryVariant))) throw new Error("Stored query variant is invalid.");
  if (!Number.isInteger(queryCycle) || Number(queryCycle) < 0 || Number(queryCycle) > 2) throw new Error("Stored query cycle is invalid.");
  if (requiredProvider !== "EXA" && requiredProvider !== "OPENAI") throw new Error("Stored provider pin is invalid.");
  return {
    ...parsed.input,
    manufacturer: parsed.input.manufacturer ?? undefined,
    mpn: parsed.input.mpn ?? undefined,
    specification: parsed.input.specification ?? undefined,
    targetCountry: parsed.input.targetCountry ?? undefined,
    requestedQuantity: parsed.input.requestedQuantity ?? undefined,
    requestedUnit: parsed.input.requestedUnit ?? undefined,
    sourceRegion: parsed.input.sourceRegion ?? undefined,
    deliveryLocation: parsed.input.deliveryLocation ?? undefined,
    needByDate: parsed.input.needByDate ?? undefined,
    officeId: FIXED_OFFICE_ID,
    workspaceId: FIXED_WORKSPACE_ID,
    queryVariant: queryVariant as SearchInput["queryVariant"],
    queryCycle: Number(queryCycle),
    excludeDomains: Array.isArray(excludeDomains) ? excludeDomains.flatMap((value) => typeof value === "string" ? [value] : []) : [],
    requiredProvider,
  };
}

function materializedAttempt(attempt: SupplierEvalAttempt, dependencies: SupplierEvalDependencies): SupplierResearchCampaignAttempt {
  if (attempt.status !== "SUCCEEDED") return attempt;
  const output = record(attempt.output);
  const capture = parseStoredSupplierResearchRetrievalCapture(output.retrieval);
  if (!capture || capture.provider !== attempt.provider) return { ...attempt, output: { ...output, candidates: [], publicSupplierLeadReceipts: [] } };
  const evaluation = dependencies.evaluate(attempt.input as Parameters<typeof evaluatePublicSupplierLeadReceipts>[0], capture);
  const sources = new Map<string, unknown>();
  for (const source of Array.isArray(output.sources) ? output.sources : []) {
    const url = record(source).url;
    if (typeof url === "string") sources.set(url, source);
  }
  const candidates = evaluation.receipts.map((receipt) => {
    const candidateId = `supplier-eval-${receipt.receiptHash.slice(0, 24)}`;
    sources.set(receipt.sourceUrl, { url: receipt.sourceUrl, ...(receipt.sourceTitle ? { title: receipt.sourceTitle } : {}), sourceType: "PUBLIC" });
    return {
      id: candidateId,
      officeId: FIXED_OFFICE_ID,
      workspaceId: FIXED_WORKSPACE_ID,
      componentItemKey: receipt.itemKey,
      companyName: receipt.companyName,
      website: receipt.website,
      roles: [receipt.role],
      productCapability: { value: receipt.productCapability, state: "SUPPORTED" },
      sourceUrls: [receipt.sourceUrl],
      status: "REVIEW_REQUIRED",
      approvedByUserId: null,
      approvedAt: null,
    };
  });
  const receipts = evaluation.receipts.map((receipt, index) => ({ ...receipt, candidateId: record(candidates[index]).id }));
  return { ...attempt, output: { ...output, candidates, sources: [...sources.values()], publicSupplierLeadReceipts: receipts } };
}

function attemptsForLine(checkpoint: SupplierEvalCheckpoint, itemKey: string) {
  return checkpoint.attempts.filter((attempt) => record(attempt.input).campaignItemKey === itemKey);
}

function aggregateLine(checkpoint: SupplierEvalCheckpoint, line: GuildSourcingLine, dependencies: SupplierEvalDependencies) {
  return dependencies.aggregate(line, attemptsForLine(checkpoint, line.sku).map((attempt) => materializedAttempt(attempt, dependencies)));
}

function decisionHistogram(checkpoint: SupplierEvalCheckpoint, dependencies: SupplierEvalDependencies) {
  return diagnosticHistograms(checkpoint.attempts, dependencies);
}

function diagnosticHistograms(attempts: SupplierEvalAttempt[], dependencies: SupplierEvalDependencies) {
  const rejections: Record<string, number> = {};
  const stages: Record<string, number> = {};
  for (const attempt of attempts) {
    if (attempt.status !== "SUCCEEDED") continue;
    const capture = parseStoredSupplierResearchRetrievalCapture(record(attempt.output).retrieval);
    if (!capture || capture.provider !== attempt.provider) {
      rejections.CAPTURE_INVALID = (rejections.CAPTURE_INVALID ?? 0) + 1;
      continue;
    }
    const evaluation = dependencies.evaluate(attempt.input as Parameters<typeof evaluatePublicSupplierLeadReceipts>[0], capture);
    for (const value of evaluation.decisions) {
      const decision = record(value);
      const code = typeof decision.code === "string" ? decision.code : "UNCLASSIFIED";
      const stage = typeof decision.stage === "string" ? decision.stage : "UNCLASSIFIED";
      stages[stage] = (stages[stage] ?? 0) + 1;
      if (code !== "ACCEPTED") rejections[code] = (rejections[code] ?? 0) + 1;
    }
  }
  return { rejections, stages };
}

function normalizedIdentity(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function publicUrl(value: string) {
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "").replace(/^\[|\]$/g, "");
    return ["http:", "https:"].includes(parsed.protocol)
      && !parsed.username
      && !parsed.password
      && hostname
      && hostname !== "localhost"
      && !hostname.endsWith(".local")
      && !hostname.endsWith(".internal")
      && !isIP(hostname)
      ? { url: parsed.toString(), hostname }
      : null;
  } catch {
    return null;
  }
}

function domainsOverlap(left: string, right: string) {
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);
}

function validCompletedCandidates(line: GuildSourcingLine, result: SupplierResearchResult, candidates: SupplierCandidate[]) {
  if (candidates.length < 3 || candidates.length > 5) return false;
  const companies = new Set<string>();
  const domains = new Set<string>();
  const resultSources = new Set(result.sources.flatMap((source) => publicUrl(source.url)?.url ?? []));
  for (const candidate of candidates) {
    const company = normalizedIdentity(candidate.companyName);
    const website = candidate.website ? publicUrl(candidate.website) : null;
    const candidateSources = candidate.sourceUrls.flatMap((source) => publicUrl(source) ?? []);
    const capabilitySources = new Set(candidate.productCapability.sources.flatMap((source) => publicUrl(source.url)?.url ?? []));
    if (!company || !website || companies.has(company) || domains.has(website.hostname)) return false;
    if (
      candidate.officeId !== FIXED_OFFICE_ID
      || candidate.workspaceId !== FIXED_WORKSPACE_ID
      || candidate.componentItemKey !== line.sku
      || candidate.status !== "REVIEW_REQUIRED"
      || candidate.approvedByUserId !== null
      || candidate.approvedAt !== null
      || candidate.productCapability.state !== "SUPPORTED"
      || typeof candidate.productCapability.value !== "string"
      || !candidate.productCapability.value.trim()
      || !candidateSources.length
      || !candidateSources.some((source) => domainsOverlap(source.hostname, website.hostname))
      || !candidateSources.some((source) => capabilitySources.has(source.url) && resultSources.has(source.url))
    ) return false;
    companies.add(company);
    domains.add(website.hostname);
  }
  return true;
}

function buildScorecard(checkpoint: SupplierEvalCheckpoint, dependencies: SupplierEvalDependencies, callCount: number) {
  const lines: SupplierEvalLineScore[] = GUILD_SOURCING_LINES.map((line) => {
    const attempts = attemptsForLine(checkpoint, line.sku);
    const providerAttempts = {
      EXA: attempts.filter((attempt) => attempt.provider === "EXA").length,
      OPENAI: attempts.filter((attempt) => attempt.provider === "OPENAI").length,
    };
    const providerCaptures = {
      EXA: hasSuccessfulProviderCapture(checkpoint, line, "EXA"),
      OPENAI: hasSuccessfulProviderCapture(checkpoint, line, "OPENAI"),
    };
    const rejections = diagnosticHistograms(attempts, dependencies).rejections;
    if (line.classification === "CLARIFICATION_REQUIRED") {
      return { itemKey: line.sku, classification: line.classification, leadCount: 0, attemptCount: attempts.length, state: "CLARIFICATION_REQUIRED", providerAttempts, providerCaptures, rejectionHistogram: rejections, candidates: [] };
    }
    if (line.classification === "REQUIREMENT_ONLY") {
      return { itemKey: line.sku, classification: line.classification, leadCount: 0, attemptCount: attempts.length, state: "REQUIREMENT_ONLY", providerAttempts, providerCaptures, rejectionHistogram: rejections, candidates: [] };
    }
    const aggregate = aggregateLine(checkpoint, line, dependencies);
    const candidates = aggregate.candidates.slice(0, checkpoint.scope.retain);
    return {
      itemKey: line.sku,
      classification: line.classification,
      leadCount: candidates.length,
      attemptCount: attempts.length,
      state: validCompletedCandidates(line, aggregate, candidates) ? "COMPLETE" : "INCOMPLETE",
      providerAttempts,
      providerCaptures,
      rejectionHistogram: rejections,
      candidates: candidates.map((candidate) => ({ companyName: candidate.companyName, website: candidate.website ?? "", sourceUrls: candidate.sourceUrls })),
    };
  });
  const coveredLines = lines.filter((line) => line.classification === "SUPPLIER_SEARCH" && line.state === "COMPLETE").length;
  const fullScope = checkpoint.scope.ids.length === SEARCHABLE_IDS.length && SEARCHABLE_IDS.every((id) => checkpoint.scope.ids.includes(id));
  const providerParity = checkpoint.scope.provider !== "both" || lines
    .filter((line) => line.classification === "SUPPLIER_SEARCH")
    .every((line) => line.providerCaptures.EXA && line.providerCaptures.OPENAI);
  const exactPass = fullScope
    && coveredLines === 38
    && providerParity
    && lines.find((line) => line.itemKey === "GUILD-027")?.attemptCount === 0
    && lines.find((line) => line.itemKey === "GUILD-039")?.attemptCount === 0;
  const histograms = decisionHistogram(checkpoint, dependencies);
  return {
    fixtureRevision: checkpoint.fixtureRevision,
    scopeRevision: checkpoint.scopeRevision,
    createdEvidencePolicyVersion: checkpoint.createdEvidencePolicyVersion,
    currentEvidencePolicyVersion: GUILD_SUPPLIER_CAMPAIGN_EVIDENCE_POLICY_VERSION,
    generatedAt: dependencies.now().toISOString(),
    exactPass: Boolean(exactPass),
    coveredLines,
    searchableLines: 38 as const,
    totalLines: 40 as const,
    callCount,
    failedCalls: checkpoint.attempts.filter((attempt) => attempt.status === "FAILED" && record(attempt.error).code !== "INTERRUPTED").length,
    rejectionHistogram: histograms.rejections,
    stageHistogram: histograms.stages,
    lines,
  } satisfies SupplierEvalScorecard;
}

function scorecardMarkdown(scorecard: SupplierEvalScorecard) {
  const rejections = Object.entries(scorecard.rejectionHistogram).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  return [
    "# GUILD supplier evaluation",
    "",
    `Status: ${scorecard.exactPass ? "PASS" : "INCOMPLETE"}`,
    `Coverage: ${scorecard.coveredLines}/38 sourceable lines`,
    `Research attempts this run: ${scorecard.callCount}`,
    `Evidence policy: created v${scorecard.createdEvidencePolicyVersion}, revalidated v${scorecard.currentEvidencePolicyVersion}`,
    "",
    "## Rejections",
    "",
    ...(rejections.length ? rejections.map(([code, count]) => `- ${code}: ${count}`) : ["- None"]),
    "",
    "## Lines",
    "",
    "| Line | State | Leads | Provider attempts | Top rejections |",
    "| --- | --- | ---: | --- | --- |",
    ...scorecard.lines.map((line) => {
      const topRejections = Object.entries(line.rejectionHistogram)
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 3)
        .map(([code, count]) => `${code}=${count}`)
        .join(", ") || "None";
      const captureMark = (provider: SupplierResearchProvider) => line.providerCaptures[provider] ? "captured" : "missing";
      return `| ${line.itemKey} | ${line.state} | ${line.leadCount} | EXA ${line.providerAttempts.EXA} (${captureMark("EXA")}), OPENAI ${line.providerAttempts.OPENAI} (${captureMark("OPENAI")}) | ${topRejections} |`;
    }),
    "",
    "## Retained suppliers",
    "",
    ...scorecard.lines.flatMap((line) => line.candidates.flatMap((candidate) => [
      `### ${line.itemKey}: ${candidate.companyName}`,
      "",
      `Website: ${candidate.website}`,
      "",
      ...candidate.sourceUrls.map((url) => `- Evidence: ${url}`),
      "",
    ])),
  ].join("\n");
}

async function writeScorecard(checkpointPath: string, scorecard: SupplierEvalScorecard) {
  const stem = checkpointPath.endsWith(".json") ? checkpointPath.slice(0, -5) : checkpointPath;
  const jsonPath = `${stem}.final.json`;
  const markdownPath = `${stem}.scorecard.md`;
  await mkdir(dirname(jsonPath), { recursive: true, mode: 0o700 });
  await writeFile(jsonPath, `${JSON.stringify(scorecard, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await writeFile(markdownPath, scorecardMarkdown(scorecard), { encoding: "utf8", mode: 0o600 });
  await chmod(jsonPath, 0o600);
  await chmod(markdownPath, 0o600);
  return { jsonPath, markdownPath };
}

function providerConfigurationError(config: SupplierEvalConfig, environment: Record<string, string | undefined>) {
  if (config.mode === "revalidate") return null;
  const providers = config.provider === "both" ? ["EXA", "OPENAI"] as const : [config.provider];
  const missing = providers.filter((provider) => !environment[provider === "EXA" ? "EXA_API_KEY" : "OPENAI_API_KEY"]?.trim());
  return missing.length ? `Missing provider configuration for ${missing.join(" and ")}. Export the key in this shell without pasting it into chat.` : null;
}

function diagnosticsForAttempt(attempt: SupplierEvalAttempt, dependencies: SupplierEvalDependencies) {
  const output = record(attempt.output);
  const capture = parseStoredSupplierResearchRetrievalCapture(output.retrieval);
  if (!capture || capture.provider !== attempt.provider) return "capture invalid";
  const evaluation = dependencies.evaluate(attempt.input as Parameters<typeof evaluatePublicSupplierLeadReceipts>[0], capture);
  const histogram: Record<string, number> = {};
  for (const raw of evaluation.decisions) {
    const code = typeof record(raw).code === "string" ? String(record(raw).code) : "UNCLASSIFIED";
    if (code !== "ACCEPTED") histogram[code] = (histogram[code] ?? 0) + 1;
  }
  const discovered = Array.isArray(output.sources) ? output.sources.length : capture.records.length;
  const retrieved = capture.stage === "SEARCH_ONLY" ? 0 : capture.records.length;
  const rejected = Object.entries(histogram).sort((left, right) => right[1] - left[1]).map(([code, count]) => `${code}=${count}`).join(", ") || "none";
  return `discovered ${discovered}, retrieved ${retrieved}, accepted ${evaluation.receipts.length}, rejected ${rejected}`;
}

function terminalErrorCode(error: unknown) {
  const code = record(error).code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{1,80}$/.test(code) ? code : "PROVIDER_FAILURE";
}

const PROVIDER_WIDE_FAILURE_CODES = new Set([
  "MISSING_CONFIGURATION",
  "PROVIDER_AUTHENTICATION_FAILED",
  "ACCESS_REVOKED",
  "PROVIDER_RATE_LIMITED",
]);

function suppressProviderAfterError(errorCode: string) {
  return PROVIDER_WIDE_FAILURE_CODES.has(errorCode);
}

function reserveAttempt(
  checkpoint: SupplierEvalCheckpoint,
  line: GuildSourcingLine,
  provider: SupplierResearchProvider,
  dependencies: SupplierEvalDependencies,
) {
  const providerAttemptNumber = nextProviderOrdinal(checkpoint, line.sku, provider);
  const aggregate = aggregateLine(checkpoint, line, dependencies);
  const storedInput = guildSupplierResearchAttemptInput({
    line,
    campaignId: `supplier-eval:${checkpoint.runId}:${provider.toLowerCase()}`,
    attemptNumber: providerAttemptNumber,
    requiredProvider: provider,
    excludeDomains: exclusionDomains(aggregate, providerAttemptNumber),
  }) as unknown as JsonRecord;
  const now = dependencies.now().toISOString();
  const attempt: SupplierEvalAttempt = {
    id: `supplier-eval:${line.sku}:${provider}:${providerAttemptNumber}:${dependencies.randomId()}`,
    provider,
    providerAttemptNumber,
    status: "RUNNING",
    input: storedInput,
    output: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    failedAt: null,
  };
  checkpoint.attempts.push(attempt);
  return attempt;
}

async function executeAttempt(attempt: SupplierEvalAttempt, dependencies: SupplierEvalDependencies) {
  try {
    const providerInput = fixedScopeProviderInput(record(attempt.input));
    const output = await dependencies.search(providerInput);
    const capture = parseStoredSupplierResearchRetrievalCapture(record(output).retrieval);
    if (!capture || capture.provider !== attempt.provider) throw Object.assign(new Error("Provider returned an invalid or mismatched retrieval capture."), { code: "INVALID_CAPTURE" });
    attempt.status = "SUCCEEDED";
    attempt.output = output;
    attempt.error = null;
    attempt.completedAt = dependencies.now().toISOString();
    attempt.updatedAt = attempt.completedAt;
    return null;
  } catch (error) {
    attempt.status = "FAILED";
    attempt.output = null;
    attempt.error = { code: terminalErrorCode(error) };
    attempt.failedAt = dependencies.now().toISOString();
    attempt.updatedAt = attempt.failedAt;
    return terminalErrorCode(error);
  }
}

function incompleteSelectedLines(checkpoint: SupplierEvalCheckpoint, dependencies: SupplierEvalDependencies) {
  return SEARCHABLE_LINES.filter((line) => checkpoint.scope.ids.includes(line.sku))
    .filter((line) => {
      const aggregate = aggregateLine(checkpoint, line, dependencies);
      const candidates = aggregate.candidates.slice(0, checkpoint.scope.retain);
      return !validCompletedCandidates(line, aggregate, candidates);
    });
}

type PlannedAttempt = { line: GuildSourcingLine; provider: SupplierResearchProvider };

function providerKeys(provider: SupplierEvalProviderMode): SupplierResearchProvider[] {
  return provider === "both" ? ["EXA", "OPENAI"] : [provider];
}

function lineProviderKey(line: GuildSourcingLine | string, provider: SupplierResearchProvider) {
  return `${typeof line === "string" ? line : line.sku}:${provider}`;
}

function hasSuccessfulProviderCapture(checkpoint: SupplierEvalCheckpoint, line: GuildSourcingLine, provider: SupplierResearchProvider) {
  return checkpoint.attempts.some((attempt) => {
    if (record(attempt.input).campaignItemKey !== line.sku || attempt.provider !== provider || attempt.status !== "SUCCEEDED") return false;
    const capture = parseStoredSupplierResearchRetrievalCapture(record(attempt.output).retrieval);
    return capture?.provider === provider;
  });
}

function plannedAttempts(args: {
  checkpoint: SupplierEvalCheckpoint;
  config: SupplierEvalConfig;
  dependencies: SupplierEvalDependencies;
  attemptedThisRun: Set<string>;
  suppressedProviders: Set<SupplierResearchProvider>;
  failedLineProviders: Set<string>;
}) {
  const selected = SEARCHABLE_LINES.filter((line) => args.checkpoint.scope.ids.includes(line.sku));
  const providers = providerKeys(args.checkpoint.scope.provider).filter((provider) => !args.suppressedProviders.has(provider));
  const missingBaseline = selected.flatMap((line) => providers.flatMap((provider) => (
    !hasSuccessfulProviderCapture(args.checkpoint, line, provider)
      && !args.attemptedThisRun.has(lineProviderKey(line, provider))
      && !args.failedLineProviders.has(lineProviderKey(line, provider))
      ? [{ line, provider }]
      : []
  ))).sort((left, right) => (
    lineProviderAttemptCount(args.checkpoint, left.line.sku, left.provider)
    - lineProviderAttemptCount(args.checkpoint, right.line.sku, right.provider)
    || left.line.sku.localeCompare(right.line.sku)
    || ["EXA", "OPENAI"].indexOf(left.provider) - ["EXA", "OPENAI"].indexOf(right.provider)
  ));
  if (missingBaseline.length) return missingBaseline;
  if (!args.config.untilComplete) {
    return selected.flatMap((line) => providers.flatMap((provider) => (
      args.attemptedThisRun.has(lineProviderKey(line, provider))
        || args.failedLineProviders.has(lineProviderKey(line, provider))
        ? []
        : [{ line, provider }]
    )));
  }
  return incompleteSelectedLines(args.checkpoint, args.dependencies)
    .flatMap((line) => {
      const available = providers.filter((provider) => !args.failedLineProviders.has(lineProviderKey(line, provider)));
      const provider = providerForNextAttempt(args.checkpoint, line.sku, available);
      return provider ? [{ line, provider }] : [];
    })
    .sort((left, right) => (
      attemptsForLine(args.checkpoint, left.line.sku).length - attemptsForLine(args.checkpoint, right.line.sku).length
      || left.line.sku.localeCompare(right.line.sku)
    ));
}

export async function runSupplierEval(
  config: SupplierEvalConfig,
  overrides: Partial<SupplierEvalDependencies> = {},
): Promise<SupplierEvalRunResult> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const configurationError = providerConfigurationError(config, dependencies.environment);
  if (configurationError) throw new Error(configurationError);
  const lock = await acquireCheckpointLock(config.checkpointPath, dependencies);
  try {
    const checkpoint = await loadCheckpoint(config, dependencies);
    await heartbeatCheckpointLock(lock, dependencies.now());
    if (config.mode === "revalidate") {
      const scorecard = buildScorecard(checkpoint, dependencies, 0);
      const paths = await writeScorecard(config.checkpointPath, scorecard);
      dependencies.log(`Revalidated ${checkpoint.attempts.length} captured attempts with zero provider requests: ${scorecard.coveredLines}/38 lines.`);
      return { exitCode: scorecard.exactPass ? 0 : 2, checkpoint, scorecard, ...paths };
    }
    let calls = 0;
    let hadProviderError = false;
    const attemptedThisRun = new Set<string>();
    const suppressedProviders = new Set<SupplierResearchProvider>();
    const failedLineProviders = new Set<string>();
    let completionWrite = Promise.resolve();
    while (calls < config.maxCalls) {
      await heartbeatCheckpointLock(lock, dependencies.now());
      const planned = plannedAttempts({
        checkpoint,
        config,
        dependencies,
        attemptedThisRun,
        suppressedProviders,
        failedLineProviders,
      });
      if (!planned.length) break;
      const batch = planned.slice(0, Math.min(config.concurrency, config.maxCalls - calls));
      const reservations = batch.map(({ line, provider }) => {
        attemptedThisRun.add(lineProviderKey(line, provider));
        return reserveAttempt(checkpoint, line, provider, dependencies);
      });
      checkpoint.updatedAt = dependencies.now().toISOString();
      checkpoint.writeSequence += 1;
      await writeSupplierEvalCheckpointAtomic(config.checkpointPath, checkpoint, dependencies.randomId);
      await heartbeatCheckpointLock(lock, dependencies.now());
      const outcomes = await Promise.all(reservations.map(async (attempt) => {
        const errorCode = await executeAttempt(attempt, dependencies);
        calls += 1;
        completionWrite = completionWrite.then(async () => {
          checkpoint.updatedAt = dependencies.now().toISOString();
          checkpoint.writeSequence += 1;
          await writeSupplierEvalCheckpointAtomic(config.checkpointPath, checkpoint, dependencies.randomId);
          await heartbeatCheckpointLock(lock, dependencies.now());
          if (errorCode) {
            hadProviderError = true;
            dependencies.log(`${String(record(attempt.input).campaignItemKey)} ${attempt.provider} #${attempt.providerAttemptNumber}: ${errorCode}`);
          } else {
            dependencies.log(`${String(record(attempt.input).campaignItemKey)} ${attempt.provider} #${attempt.providerAttemptNumber}: ${diagnosticsForAttempt(attempt, dependencies)}`);
          }
        });
        await completionWrite;
        return { attempt, errorCode };
      }));
      for (const { errorCode } of outcomes) {
        if (!errorCode) continue;
        hadProviderError = true;
      }
      for (const { attempt, errorCode } of outcomes) {
        if (!errorCode) continue;
        if (suppressProviderAfterError(errorCode)) {
          if (!suppressedProviders.has(attempt.provider)) {
            dependencies.log(`${attempt.provider} suspended for the remainder of this invocation after ${errorCode}.`);
          }
          suppressedProviders.add(attempt.provider);
        } else {
          failedLineProviders.add(lineProviderKey(String(record(attempt.input).campaignItemKey), attempt.provider));
        }
      }
    }
    await heartbeatCheckpointLock(lock, dependencies.now());
    const scorecard = buildScorecard(checkpoint, dependencies, calls);
    const paths = await writeScorecard(config.checkpointPath, scorecard);
    dependencies.log(`GUILD supplier evaluation: ${scorecard.coveredLines}/38 lines, ${calls} research attempts, ${scorecard.exactPass ? "PASS" : "INCOMPLETE"}.`);
    return { exitCode: hadProviderError ? 1 : scorecard.exactPass ? 0 : 2, checkpoint, scorecard, ...paths };
  } finally {
    await releaseCheckpointLock(lock);
  }
}

export type SupplierEvalMainDependencies = {
  run: (config: SupplierEvalConfig) => Promise<SupplierEvalRunResult>;
  doctor: (config: SupplierEvalDoctorConfig) => Promise<SupplierEvalDoctorResult>;
  cwd: () => string;
  log: (message: string) => void;
  error: (message: string) => void;
  setExitCode: (code: 0 | 1 | 2) => void;
};

const defaultMainDependencies: SupplierEvalMainDependencies = {
  run: runSupplierEval,
  doctor: runSupplierEvalDoctor,
  cwd: () => process.cwd(),
  log: (message) => console.log(message),
  error: (message) => console.error(message),
  setExitCode: (code) => {
    process.exitCode = code;
  },
};

export async function supplierEvalMain(
  argv = process.argv.slice(2),
  overrides: Partial<SupplierEvalMainDependencies> = {},
) {
  const dependencies = { ...defaultMainDependencies, ...overrides };
  try {
    if (!argv.length || argv.includes("--help") || argv.includes("-h")) {
      dependencies.log(supplierEvalHelpText());
      dependencies.setExitCode(0);
      return;
    }
    if (argv.includes("--doctor")) {
      const result = await dependencies.doctor(parseSupplierEvalDoctorArgs(argv, dependencies.cwd()));
      dependencies.log(formatSupplierEvalDoctorResult(result));
      dependencies.setExitCode(result.exitCode);
      return;
    }
    const result = await dependencies.run(parseSupplierEvalArgs(argv, dependencies.cwd()));
    dependencies.setExitCode(result.exitCode);
  } catch (error) {
    dependencies.error(error instanceof Error ? error.message : "Supplier evaluation failed.");
    dependencies.setExitCode(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  supplierEvalMain().catch((error) => {
    console.error(error instanceof Error ? error.message : "Supplier evaluation failed.");
    process.exitCode = 1;
  });
}
