import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { searchComponentSuppliers } from "../src/lib/supply-os/component-supplier-research";
import {
  evaluatePublicSupplierLeadReceipts,
  parseStoredSupplierResearchRetrievalCapture,
  type SupplierResearchRetrievalCapture,
} from "../src/lib/supply-os/exa-supplier-research";
import { GUILD_SOURCING_LINES, type GuildSourcingLine } from "../src/lib/supply-os/guild-sourcing-items";
import { parseSupplierResearchRouteBody } from "../src/lib/supply-os/supplier-research-route-contract";
import {
  GUILD_SUPPLIER_CAMPAIGN_EVIDENCE_POLICY_VERSION,
  GUILD_SUPPLIER_CAMPAIGN_DELIVERY_LOCATION,
  GUILD_SUPPLIER_CAMPAIGN_NEED_BY_DATE,
  GUILD_SUPPLIER_CAMPAIGN_QUERY_VARIANTS,
  GUILD_SUPPLIER_CAMPAIGN_RETAINED_MAXIMUM,
  GUILD_SUPPLIER_CAMPAIGN_TARGET_MINIMUM,
  aggregateGuildSupplierResearchLine,
  guildSupplierResearchAttemptInput,
  type SupplierResearchCampaignAttempt,
  type SupplierResearchProvider,
} from "../src/lib/supply-os/supplier-research-campaign";
import type { SupplierCandidate, SupplierResearchResult } from "../src/lib/supply-os/research";

const CHECKPOINT_SCHEMA_VERSION = 1;
const FIXED_OFFICE_ID = "supplier-eval-office";
const FIXED_WORKSPACE_ID = "supplier-eval-workspace";
const DEFAULT_CHECKPOINT = ".codex-tmp/supplier-eval/guild.json";
const SEARCHABLE_LINES = GUILD_SOURCING_LINES.filter((line) => line.classification === "SUPPLIER_SEARCH");
const SEARCHABLE_IDS = SEARCHABLE_LINES.map((line) => line.sku);

type JsonRecord = Record<string, unknown>;
export type SupplierEvalProviderMode = SupplierResearchProvider | "both";

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
  const rawProvider = (values.get("provider") ?? "both").toUpperCase();
  if (!['EXA', 'OPENAI', 'BOTH'].includes(rawProvider)) throw new Error("--provider must be EXA, OPENAI, or both.");
  const provider = rawProvider === "BOTH" ? "both" : rawProvider as SupplierResearchProvider;
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
    let interrupted = false;
    for (const attempt of checkpoint.attempts) {
      if (attempt.status !== "RUNNING") continue;
      attempt.status = "FAILED";
      attempt.error = { code: "INTERRUPTED" };
      attempt.failedAt = dependencies.now().toISOString();
      attempt.updatedAt = attempt.failedAt;
      interrupted = true;
    }
    if (interrupted) {
      checkpoint.updatedAt = dependencies.now().toISOString();
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

function providerForNextAttempt(checkpoint: SupplierEvalCheckpoint, itemKey: string): SupplierResearchProvider {
  if (checkpoint.scope.provider !== "both") return checkpoint.scope.provider;
  const counts = { EXA: 0, OPENAI: 0 };
  for (const attempt of checkpoint.attempts) {
    if (record(attempt.input).campaignItemKey === itemKey) counts[attempt.provider] += 1;
  }
  return counts.EXA <= counts.OPENAI ? "EXA" : "OPENAI";
}

function nextProviderOrdinal(checkpoint: SupplierEvalCheckpoint, itemKey: string, provider: SupplierResearchProvider) {
  return checkpoint.attempts.reduce((maximum, attempt) => {
    return record(attempt.input).campaignItemKey === itemKey && attempt.provider === provider
      ? Math.max(maximum, attempt.providerAttemptNumber)
      : maximum;
  }, 0) + 1;
}

function candidateDomain(candidate: SupplierCandidate) {
  if (!candidate.website) return null;
  try {
    return new URL(candidate.website).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function exclusionDomains(result: SupplierResearchResult) {
  return [...new Set([
    ...result.candidates.flatMap((candidate) => candidateDomain(candidate) ? [candidateDomain(candidate)!] : []),
    ...result.sources.flatMap((source) => {
      try {
        return [new URL(source.url).hostname.toLowerCase().replace(/^www\./, "")];
      } catch {
        return [];
      }
    }),
  ])].sort().slice(0, 8);
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
    `Calls this run: ${scorecard.callCount}`,
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
    excludeDomains: exclusionDomains(aggregate),
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
    .filter((line) => aggregateLine(checkpoint, line, dependencies).candidates.length < checkpoint.scope.target);
}

type PlannedAttempt = { line: GuildSourcingLine; provider: SupplierResearchProvider };

function providerKeys(provider: SupplierEvalProviderMode): SupplierResearchProvider[] {
  return provider === "both" ? ["EXA", "OPENAI"] : [provider];
}

function lineProviderKey(line: GuildSourcingLine, provider: SupplierResearchProvider) {
  return `${line.sku}:${provider}`;
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
}) {
  const selected = SEARCHABLE_LINES.filter((line) => args.checkpoint.scope.ids.includes(line.sku));
  const providers = providerKeys(args.checkpoint.scope.provider);
  const missingBaseline = selected.flatMap((line) => providers.flatMap((provider) => (
    !hasSuccessfulProviderCapture(args.checkpoint, line, provider)
      && !args.attemptedThisRun.has(lineProviderKey(line, provider))
      ? [{ line, provider }]
      : []
  )));
  if (missingBaseline.length) return missingBaseline;
  if (!args.config.untilComplete) {
    return selected.flatMap((line) => providers.flatMap((provider) => (
      args.attemptedThisRun.has(lineProviderKey(line, provider)) ? [] : [{ line, provider }]
    )));
  }
  return incompleteSelectedLines(args.checkpoint, args.dependencies).map((line) => ({
    line,
    provider: providerForNextAttempt(args.checkpoint, line.sku),
  }));
}

export async function runSupplierEval(
  config: SupplierEvalConfig,
  overrides: Partial<SupplierEvalDependencies> = {},
): Promise<SupplierEvalRunResult> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const configurationError = providerConfigurationError(config, dependencies.environment);
  if (configurationError) throw new Error(configurationError);
  const checkpoint = await loadCheckpoint(config, dependencies);
  if (config.mode === "revalidate") {
    const scorecard = buildScorecard(checkpoint, dependencies, 0);
    const paths = await writeScorecard(config.checkpointPath, scorecard);
    dependencies.log(`Revalidated ${checkpoint.attempts.length} captured attempts with zero provider calls: ${scorecard.coveredLines}/38 lines.`);
    return { exitCode: scorecard.exactPass ? 0 : 2, checkpoint, scorecard, ...paths };
  }
  let calls = 0;
  let hadProviderError = false;
  const attemptedThisRun = new Set<string>();
  let completionWrite = Promise.resolve();
  while (calls < config.maxCalls) {
    const planned = plannedAttempts({ checkpoint, config, dependencies, attemptedThisRun });
    if (!planned.length) break;
    const batch = planned.slice(0, Math.min(config.concurrency, config.maxCalls - calls));
    const reservations = batch.map(({ line, provider }) => {
      attemptedThisRun.add(lineProviderKey(line, provider));
      return reserveAttempt(checkpoint, line, provider, dependencies);
    });
    checkpoint.updatedAt = dependencies.now().toISOString();
    checkpoint.writeSequence += 1;
    await writeSupplierEvalCheckpointAtomic(config.checkpointPath, checkpoint, dependencies.randomId);
    const outcomes = await Promise.all(reservations.map(async (attempt) => {
      const errorCode = await executeAttempt(attempt, dependencies);
      calls += 1;
      completionWrite = completionWrite.then(async () => {
        checkpoint.updatedAt = dependencies.now().toISOString();
        checkpoint.writeSequence += 1;
        await writeSupplierEvalCheckpointAtomic(config.checkpointPath, checkpoint, dependencies.randomId);
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
      if (errorCode) hadProviderError = true;
    }
    if (hadProviderError) break;
  }
  const scorecard = buildScorecard(checkpoint, dependencies, calls);
  const paths = await writeScorecard(config.checkpointPath, scorecard);
  dependencies.log(`GUILD supplier evaluation: ${scorecard.coveredLines}/38 lines, ${calls} calls, ${scorecard.exactPass ? "PASS" : "INCOMPLETE"}.`);
  return { exitCode: hadProviderError ? 1 : scorecard.exactPass ? 0 : 2, checkpoint, scorecard, ...paths };
}

export async function supplierEvalMain(argv = process.argv.slice(2)) {
  try {
    const result = await runSupplierEval(parseSupplierEvalArgs(argv));
    process.exitCode = result.exitCode;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Supplier evaluation failed.");
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  supplierEvalMain().catch((error) => {
    console.error(error instanceof Error ? error.message : "Supplier evaluation failed.");
    process.exitCode = 1;
  });
}
