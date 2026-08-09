import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSupplyCapability, SUPPLY_EVIDENCE_KINDS } from "./capabilities";
import {
  requireSupplyWorkspace,
  SupplyPersistenceError,
  type SupplyAccessContext,
} from "./persistence";

const MAX_JSON_BYTES = 128_000;
const MAX_SCENARIOS = 24;
const MAX_EVIDENCE = 100;
const DECISION_REQUIRED_ROLE = "MANAGER";

const DECISION_STATUSES = ["APPROVED", "REJECTED"] as const;
const EVIDENCE_USAGES = ["SUPPORTS", "CONTRADICTS", "CONSTRAINT", "ASSUMPTION"] as const;
const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const SCENARIO_KINDS = ["BASELINE", "PROPOSED", "ALTERNATIVE"] as const;
const EXECUTION_ACTIONS = ["request_quote", "place_order", "book_shipment", "file_customs_entry"] as const;

type DecisionStatus = (typeof DECISION_STATUSES)[number];
type EvidenceUsage = (typeof EVIDENCE_USAGES)[number];
type RiskLevel = (typeof RISK_LEVELS)[number];
type ScenarioKind = (typeof SCENARIO_KINDS)[number];
type ExecutionAction = (typeof EXECUTION_ACTIONS)[number];
type JsonObject = Record<string, unknown>;

const ACTION_REQUIRED_ROLE: Record<ExecutionAction, "ADMIN" | "MANAGER"> = {
  request_quote: "MANAGER",
  place_order: "ADMIN",
  book_shipment: "MANAGER",
  file_customs_entry: "ADMIN",
};

export type SupplyDecisionEvidenceInput = {
  evidenceKey: string;
  kind: string;
  sourceType: string;
  sourceUri?: string | null;
  sourceRecordId?: string | null;
  sourceVersion?: string | null;
  title: string;
  excerpt?: string | null;
  payload?: JsonObject | null;
  confidence?: number | null;
  observedAt?: string | null;
  usage?: EvidenceUsage;
  note?: string | null;
};

export type SupplyScenarioInput = {
  scenarioKey: string;
  name: string;
  kind?: ScenarioKind;
  summary?: string | null;
  assumptions: JsonObject;
  measures: JsonObject;
  supplierPlan?: JsonObject | null;
  logisticsPlan?: JsonObject | null;
  compliancePlan?: JsonObject | null;
  currency?: string | null;
  expectedCost?: number | string | null;
  expectedLeadTimeDays?: number | null;
  riskLevel?: RiskLevel;
  feasible?: boolean | null;
  rank?: number | null;
  evidence?: Array<{ evidenceKey: string; usage?: EvidenceUsage; note?: string | null }>;
};

export type CreateSupplyDecisionInput = {
  snapshotId: string;
  decisionType: string;
  subjectType: string;
  subjectRef: string;
  title: string;
  objective?: string | null;
  riskLevel?: RiskLevel;
  proposal: JsonObject;
  rationale?: string | null;
  constraints?: JsonObject | null;
  scenarios: SupplyScenarioInput[];
  evidence: SupplyDecisionEvidenceInput[];
  idempotencyKey: string;
};

export type CreateSupplyExecutionTaskInput = {
  scenarioId?: string | null;
  taskKey: string;
  input: { plan: string; action: ExecutionAction };
  externalSystem?: string | null;
  scheduledFor?: string | null;
  idempotencyKey: string;
};

export type RequestSupplyApprovalInput = {
  reason?: string | null;
  context?: JsonObject | null;
  expiresAt?: string | null;
  idempotencyKey: string;
};

function invalid(message: string): never {
  throw new SupplyPersistenceError(message, "invalid_input");
}

function conflict(message: string): never {
  throw new SupplyPersistenceError(message, "conflict");
}

function requiredText(value: unknown, label: string, maxLength = 240) {
  if (typeof value !== "string") invalid(`${label} is required.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    invalid(`${label} must contain 1 to ${maxLength} characters.`);
  }
  return normalized;
}

function optionalText(value: unknown, label: string, maxLength = 2_000) {
  if (value === undefined || value === null || value === "") return null;
  return requiredText(value, label, maxLength);
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string, fallback: T) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    invalid(`${label} must be one of: ${allowed.join(", ")}.`);
  }
  return value as T;
}

function plainObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    invalid(`${label} must be a JSON object.`);
  }
  canonicalSupplyJson(value);
  return value as JsonObject;
}

function assertOnlyKeys(value: JsonObject, allowed: readonly string[], label: string) {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) invalid(`${label} contains unsupported fields: ${unexpected.sort().join(", ")}.`);
}

function optionalObject(value: unknown, label: string) {
  if (value === undefined || value === null) return null;
  return plainObject(value, label);
}

function normalizedDate(value: unknown, label: string, futureOnly = false) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") invalid(`${label} must be an ISO timestamp.`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) invalid(`${label} must be an ISO timestamp.`);
  if (futureOnly && date.getTime() <= Date.now()) invalid(`${label} must be in the future.`);
  return date;
}

function idempotencyKey(value: unknown) {
  const key = requiredText(value, "Idempotency key", 160);
  if (key.length < 8 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(key)) {
    invalid("Idempotency key must contain 8 to 160 safe characters.");
  }
  return key;
}

function canonicalValue(value: unknown, path: string): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid(`${path} contains a non-finite number.`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => canonicalValue(entry, `${path}[${index}]`));
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child === undefined) invalid(`${path}.${key} cannot be undefined.`);
      output[key] = canonicalValue(child, `${path}.${key}`);
    }
    return output;
  }
  invalid(`${path} contains a value that JSON cannot represent.`);
}

export function canonicalSupplyJson(value: unknown) {
  const serialized = JSON.stringify(canonicalValue(value, "JSON"));
  if (Buffer.byteLength(serialized, "utf8") > MAX_JSON_BYTES) {
    invalid(`JSON payloads must be smaller than ${MAX_JSON_BYTES} bytes.`);
  }
  return serialized;
}

export function supplyJsonHash(value: unknown) {
  return createHash("sha256").update(canonicalSupplyJson(value)).digest("hex");
}

function normalizeEvidence(input: SupplyDecisionEvidenceInput, index: number) {
  const object = plainObject(input, `Evidence ${index + 1}`);
  assertOnlyKeys(object, [
    "evidenceKey", "kind", "sourceType", "sourceUri", "sourceRecordId", "sourceVersion",
    "title", "excerpt", "payload", "confidence", "observedAt", "usage", "note",
  ], `Evidence ${index + 1}`);
  const evidenceKey = requiredText(input.evidenceKey, `Evidence ${index + 1} key`, 160);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(evidenceKey)) {
    invalid(`Evidence ${index + 1} key contains unsupported characters.`);
  }
  if (typeof input.kind !== "string" || !SUPPLY_EVIDENCE_KINDS.includes(input.kind as (typeof SUPPLY_EVIDENCE_KINDS)[number])) {
    invalid(`Evidence ${index + 1} kind must be one of: ${SUPPLY_EVIDENCE_KINDS.join(", ")}.`);
  }
  const kind = input.kind as (typeof SUPPLY_EVIDENCE_KINDS)[number];
  const payload = optionalObject(input.payload, `Evidence ${index + 1} payload`);
  const confidence = input.confidence === undefined || input.confidence === null ? null : Number(input.confidence);
  if (confidence !== null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
    invalid(`Evidence ${index + 1} confidence must be between 0 and 1.`);
  }
  const normalized = {
    evidenceKey,
    kind,
    sourceType: requiredText(input.sourceType, `Evidence ${index + 1} source type`, 120),
    sourceUri: optionalText(input.sourceUri, `Evidence ${index + 1} source URI`, 2_048),
    sourceRecordId: optionalText(input.sourceRecordId, `Evidence ${index + 1} source record`, 240),
    sourceVersion: optionalText(input.sourceVersion, `Evidence ${index + 1} source version`, 120),
    title: requiredText(input.title, `Evidence ${index + 1} title`, 300),
    excerpt: optionalText(input.excerpt, `Evidence ${index + 1} excerpt`, 10_000),
    payload,
    confidence,
    observedAt: normalizedDate(input.observedAt, `Evidence ${index + 1} observed timestamp`),
    usage: enumValue(input.usage, EVIDENCE_USAGES, `Evidence ${index + 1} usage`, "SUPPORTS"),
    note: optionalText(input.note, `Evidence ${index + 1} note`, 2_000),
  };
  return {
    ...normalized,
    contentHash: supplyJsonHash({
      kind: normalized.kind,
      sourceType: normalized.sourceType,
      sourceUri: normalized.sourceUri,
      sourceRecordId: normalized.sourceRecordId,
      sourceVersion: normalized.sourceVersion,
      title: normalized.title,
      excerpt: normalized.excerpt,
      payload: normalized.payload,
      observedAt: normalized.observedAt?.toISOString() ?? null,
    }),
  };
}

function normalizeScenario(input: SupplyScenarioInput, index: number, evidenceKeys: Set<string>) {
  const object = plainObject(input, `Scenario ${index + 1}`);
  assertOnlyKeys(object, [
    "scenarioKey", "name", "kind", "summary", "assumptions", "measures", "supplierPlan",
    "logisticsPlan", "compliancePlan", "currency", "expectedCost", "expectedLeadTimeDays",
    "riskLevel", "feasible", "rank", "evidence",
  ], `Scenario ${index + 1}`);
  const scenarioKey = requiredText(input.scenarioKey, `Scenario ${index + 1} key`, 160);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(scenarioKey)) {
    invalid(`Scenario ${index + 1} key contains unsupported characters.`);
  }
  const expectedCost = input.expectedCost === undefined || input.expectedCost === null || input.expectedCost === ""
    ? null
    : Number(input.expectedCost);
  if (expectedCost !== null && (!Number.isFinite(expectedCost) || expectedCost < 0)) {
    invalid(`Scenario ${index + 1} expected cost must be nonnegative.`);
  }
  const leadTime = input.expectedLeadTimeDays === undefined || input.expectedLeadTimeDays === null
    ? null
    : Number(input.expectedLeadTimeDays);
  if (leadTime !== null && (!Number.isInteger(leadTime) || leadTime < 0)) {
    invalid(`Scenario ${index + 1} lead time must be a nonnegative integer.`);
  }
  const rank = input.rank === undefined || input.rank === null ? null : Number(input.rank);
  if (rank !== null && (!Number.isInteger(rank) || rank < 1)) {
    invalid(`Scenario ${index + 1} rank must be a positive integer.`);
  }
  const evidence = (input.evidence ?? []).map((reference, referenceIndex) => {
    const referenceObject = plainObject(reference, `Scenario ${index + 1} evidence ${referenceIndex + 1}`);
    assertOnlyKeys(referenceObject, ["evidenceKey", "usage", "note"], `Scenario ${index + 1} evidence ${referenceIndex + 1}`);
    const evidenceKey = requiredText(reference.evidenceKey, `Scenario ${index + 1} evidence ${referenceIndex + 1}`, 160);
    if (!evidenceKeys.has(evidenceKey)) {
      invalid(`Scenario ${index + 1} references unknown evidence "${evidenceKey}".`);
    }
    return {
      evidenceKey,
      usage: enumValue(reference.usage, EVIDENCE_USAGES, `Scenario ${index + 1} evidence usage`, "SUPPORTS"),
      note: optionalText(reference.note, `Scenario ${index + 1} evidence note`, 2_000),
    };
  });
  if (new Set(evidence.map((reference) => `${reference.evidenceKey}:${reference.usage}`)).size !== evidence.length) {
    invalid(`Scenario ${index + 1} contains duplicate evidence links.`);
  }
  const currency = optionalText(input.currency, `Scenario ${index + 1} currency`, 3)?.toUpperCase() ?? null;
  if (currency && !/^[A-Z]{3}$/.test(currency)) invalid(`Scenario ${index + 1} currency must be a 3-letter code.`);
  if (input.feasible !== undefined && input.feasible !== null && typeof input.feasible !== "boolean") {
    invalid(`Scenario ${index + 1} feasible must be a boolean.`);
  }
  return {
    scenarioKey,
    name: requiredText(input.name, `Scenario ${index + 1} name`, 240),
    kind: enumValue(input.kind, SCENARIO_KINDS, `Scenario ${index + 1} kind`, "ALTERNATIVE"),
    summary: optionalText(input.summary, `Scenario ${index + 1} summary`, 4_000),
    assumptions: plainObject(input.assumptions, `Scenario ${index + 1} assumptions`),
    measures: plainObject(input.measures, `Scenario ${index + 1} measures`),
    supplierPlan: optionalObject(input.supplierPlan, `Scenario ${index + 1} supplier plan`),
    logisticsPlan: optionalObject(input.logisticsPlan, `Scenario ${index + 1} logistics plan`),
    compliancePlan: optionalObject(input.compliancePlan, `Scenario ${index + 1} compliance plan`),
    currency,
    expectedCost: expectedCost === null ? null : expectedCost.toString(),
    expectedLeadTimeDays: leadTime,
    riskLevel: enumValue(input.riskLevel, RISK_LEVELS, `Scenario ${index + 1} risk`, "MEDIUM"),
    feasible: input.feasible === undefined ? null : input.feasible,
    rank,
    evidence,
  };
}

async function requireDecision(context: SupplyAccessContext, decisionId: string, mode: "view" | "edit") {
  const decision = await prisma.supplyDecision.findFirst({
    where: { id: decisionId, officeId: context.officeId },
  });
  if (!decision) throw new SupplyPersistenceError("Supply decision not found.", "not_found");
  await requireSupplyWorkspace(context, decision.workspaceId, mode);
  return decision;
}

async function requireExecutionTask(context: SupplyAccessContext, taskId: string, mode: "view" | "edit") {
  const task = await prisma.supplyExecutionTask.findFirst({
    where: { id: taskId, officeId: context.officeId },
  });
  if (!task) throw new SupplyPersistenceError("Supply execution task not found.", "not_found");
  await requireSupplyWorkspace(context, task.workspaceId, mode);
  return task;
}

async function assertCurrentSupplySnapshot(
  context: SupplyAccessContext,
  workspaceId: string,
  snapshotId: string | null,
) {
  const current = await prisma.supplySnapshot.findFirst({
    where: { officeId: context.officeId, workspaceId, status: "PUBLISHED" },
    orderBy: { version: "desc" },
    select: { id: true },
  });
  if (!snapshotId || current?.id !== snapshotId) {
    conflict("This action is stale because a newer supply snapshot is now current.");
  }
}

const decisionDetailInclude = {
  snapshot: { select: { id: true, version: true, status: true, sourceHash: true, publishedAt: true } },
  scenarios: {
    orderBy: [{ rank: "asc" as const }, { scenarioKey: "asc" as const }],
    include: { evidenceLinks: { include: { evidence: true } } },
  },
  evidenceLinks: { include: { evidence: true } },
  approvals: { orderBy: { requestedAt: "desc" as const } },
  executionTasks: {
    orderBy: { createdAt: "desc" as const },
    include: { approvals: true, events: { orderBy: { sequence: "asc" as const } } },
  },
} satisfies Prisma.SupplyDecisionInclude;

function decisionDetail(decisionId: string) {
  return prisma.supplyDecision.findUniqueOrThrow({
    where: { id: decisionId },
    include: decisionDetailInclude,
  });
}

export async function createSupplyDecision(
  context: SupplyAccessContext,
  workspaceId: string,
  input: CreateSupplyDecisionInput,
) {
  await requireSupplyWorkspace(context, workspaceId, "edit");
  const inputObject = plainObject(input, "Decision request");
  assertOnlyKeys(inputObject, [
    "snapshotId", "decisionType", "subjectType", "subjectRef", "title", "objective", "riskLevel",
    "proposal", "rationale", "constraints", "scenarios", "evidence", "idempotencyKey",
  ], "Decision request");
  const key = idempotencyKey(input.idempotencyKey);
  const snapshotId = requiredText(input.snapshotId, "Snapshot ID", 240);
  const snapshot = await prisma.supplySnapshot.findFirst({
    where: { id: snapshotId, officeId: context.officeId, workspaceId, status: "PUBLISHED" },
    select: { id: true },
  });
  if (!snapshot) invalid("Decisions require a published snapshot in this workspace.");
  await assertCurrentSupplySnapshot(context, workspaceId, snapshotId);

  if (!Array.isArray(input.evidence) || input.evidence.length < 1 || input.evidence.length > MAX_EVIDENCE) {
    invalid(`Decision evidence must contain 1 to ${MAX_EVIDENCE} records.`);
  }
  if (!Array.isArray(input.scenarios) || input.scenarios.length < 1 || input.scenarios.length > MAX_SCENARIOS) {
    invalid(`Decision scenarios must contain 1 to ${MAX_SCENARIOS} records.`);
  }
  const evidence = input.evidence.map(normalizeEvidence);
  const evidenceKeys = new Set(evidence.map((record) => record.evidenceKey));
  if (evidenceKeys.size !== evidence.length) invalid("Decision evidence keys must be unique.");
  const scenarios = input.scenarios.map((scenario, index) => normalizeScenario(scenario, index, evidenceKeys));
  if (new Set(scenarios.map((scenario) => scenario.scenarioKey)).size !== scenarios.length) {
    invalid("Decision scenario keys must be unique.");
  }
  const proposal = plainObject(input.proposal, "Decision proposal");
  const constraints = optionalObject(input.constraints, "Decision constraints");
  const normalizedDecision = {
    decisionType: requiredText(input.decisionType, "Decision type", 120),
    subjectType: requiredText(input.subjectType, "Decision subject type", 120),
    subjectRef: requiredText(input.subjectRef, "Decision subject reference", 240),
    title: requiredText(input.title, "Decision title", 300),
    objective: optionalText(input.objective, "Decision objective", 4_000),
    riskLevel: enumValue(input.riskLevel, RISK_LEVELS, "Decision risk", "MEDIUM"),
    proposal,
    rationale: optionalText(input.rationale, "Decision rationale", 10_000),
    constraints,
  };

  const existing = await prisma.supplyDecision.findFirst({
    where: { officeId: context.officeId, workspaceId, idempotencyKey: key },
  });
  if (existing) {
    const same = existing.snapshotId === snapshotId
      && existing.decisionType === normalizedDecision.decisionType
      && existing.subjectType === normalizedDecision.subjectType
      && existing.subjectRef === normalizedDecision.subjectRef
      && existing.title === normalizedDecision.title
      && canonicalSupplyJson(existing.proposal) === canonicalSupplyJson(proposal);
    if (!same) conflict("Idempotency key is already bound to a different decision.");
    return decisionDetail(existing.id);
  }

  const decisionId = await prisma.$transaction(async (tx) => {
    const decision = await tx.supplyDecision.create({
      data: {
        officeId: context.officeId,
        workspaceId,
        snapshotId,
        createdByUserId: context.userId,
        decisionType: normalizedDecision.decisionType,
        subjectType: normalizedDecision.subjectType,
        subjectRef: normalizedDecision.subjectRef,
        title: normalizedDecision.title,
        objective: normalizedDecision.objective,
        riskLevel: normalizedDecision.riskLevel,
        proposal: proposal as Prisma.InputJsonValue,
        rationale: normalizedDecision.rationale,
        ...(constraints ? { constraints: constraints as Prisma.InputJsonValue } : {}),
        idempotencyKey: key,
      },
    });
    const evidenceIds = new Map<string, string>();
    for (const record of evidence) {
      const current = await tx.supplyEvidence.findUnique({
        where: { workspaceId_evidenceKey: { workspaceId, evidenceKey: record.evidenceKey } },
      });
      if (current && current.contentHash !== record.contentHash) {
        conflict(`Evidence key "${record.evidenceKey}" is already bound to different content.`);
      }
      const stored = current ?? await tx.supplyEvidence.create({
        data: {
          officeId: context.officeId,
          workspaceId,
          snapshotId,
          createdByUserId: context.userId,
          evidenceKey: record.evidenceKey,
          kind: record.kind,
          sourceType: record.sourceType,
          sourceUri: record.sourceUri,
          sourceRecordId: record.sourceRecordId,
          sourceVersion: record.sourceVersion,
          title: record.title,
          excerpt: record.excerpt,
          ...(record.payload ? { payload: record.payload as Prisma.InputJsonValue } : {}),
          contentHash: record.contentHash,
          confidence: record.confidence,
          observedAt: record.observedAt,
        },
      });
      evidenceIds.set(record.evidenceKey, stored.id);
      await tx.supplyDecisionEvidence.create({
        data: {
          officeId: context.officeId,
          workspaceId,
          decisionId: decision.id,
          evidenceId: stored.id,
          usage: record.usage,
          note: record.note,
        },
      });
    }
    for (const scenario of scenarios) {
      const created = await tx.supplyScenario.create({
        data: {
          officeId: context.officeId,
          workspaceId,
          decisionId: decision.id,
          scenarioKey: scenario.scenarioKey,
          name: scenario.name,
          kind: scenario.kind,
          summary: scenario.summary,
          assumptions: scenario.assumptions as Prisma.InputJsonValue,
          measures: scenario.measures as Prisma.InputJsonValue,
          ...(scenario.supplierPlan ? { supplierPlan: scenario.supplierPlan as Prisma.InputJsonValue } : {}),
          ...(scenario.logisticsPlan ? { logisticsPlan: scenario.logisticsPlan as Prisma.InputJsonValue } : {}),
          ...(scenario.compliancePlan ? { compliancePlan: scenario.compliancePlan as Prisma.InputJsonValue } : {}),
          currency: scenario.currency,
          expectedCost: scenario.expectedCost,
          expectedLeadTimeDays: scenario.expectedLeadTimeDays,
          riskLevel: scenario.riskLevel,
          feasible: typeof scenario.feasible === "boolean" ? scenario.feasible : null,
          rank: scenario.rank,
        },
      });
      for (const reference of scenario.evidence) {
        await tx.supplyScenarioEvidence.create({
          data: {
            officeId: context.officeId,
            workspaceId,
            scenarioId: created.id,
            evidenceId: evidenceIds.get(reference.evidenceKey)!,
            usage: reference.usage,
            note: reference.note,
          },
        });
      }
    }
    return decision.id;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return decisionDetail(decisionId);
}

function sealedDecisionScope(decision: Awaited<ReturnType<typeof decisionDetail>>) {
  return {
    schema: "supply-decision/v1",
    snapshot: {
      id: decision.snapshot.id,
      version: decision.snapshot.version,
      sourceHash: decision.snapshot.sourceHash,
    },
    decision: {
      decisionType: decision.decisionType,
      subjectType: decision.subjectType,
      subjectRef: decision.subjectRef,
      title: decision.title,
      objective: decision.objective,
      riskLevel: decision.riskLevel,
      proposal: decision.proposal,
      rationale: decision.rationale,
      constraints: decision.constraints,
    },
    evidence: decision.evidenceLinks
      .map((link) => ({
        evidenceKey: link.evidence.evidenceKey,
        kind: link.evidence.kind,
        contentHash: link.evidence.contentHash,
        usage: link.usage,
        note: link.note,
      }))
      .sort((a, b) => `${a.evidenceKey}:${a.usage}`.localeCompare(`${b.evidenceKey}:${b.usage}`)),
    scenarios: decision.scenarios.map((scenario) => ({
      scenarioKey: scenario.scenarioKey,
      name: scenario.name,
      kind: scenario.kind,
      summary: scenario.summary,
      assumptions: scenario.assumptions,
      measures: scenario.measures,
      supplierPlan: scenario.supplierPlan,
      logisticsPlan: scenario.logisticsPlan,
      compliancePlan: scenario.compliancePlan,
      currency: scenario.currency,
      expectedCost: scenario.expectedCost?.toString() ?? null,
      expectedLeadTimeDays: scenario.expectedLeadTimeDays,
      riskLevel: scenario.riskLevel,
      feasible: scenario.feasible,
      rank: scenario.rank,
      evidence: scenario.evidenceLinks
        .map((link) => ({
          evidenceKey: link.evidence.evidenceKey,
          contentHash: link.evidence.contentHash,
          usage: link.usage,
          note: link.note,
        }))
        .sort((a, b) => `${a.evidenceKey}:${a.usage}`.localeCompare(`${b.evidenceKey}:${b.usage}`)),
    })),
  };
}

export async function proposeSupplyDecision(context: SupplyAccessContext, decisionId: string) {
  const decision = await requireDecision(context, decisionId, "edit");
  await assertCurrentSupplySnapshot(context, decision.workspaceId, decision.snapshotId);
  if (decision.status !== "DRAFT" && decision.status !== "PROPOSED") {
    conflict("Only a draft decision can be proposed.");
  }
  if (decision.status === "PROPOSED") return decisionDetail(decision.id);

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyDecision" WHERE "id" = ${decision.id} FOR UPDATE`);
    const detail = await tx.supplyDecision.findUniqueOrThrow({
      where: { id: decision.id },
      include: decisionDetailInclude,
    });
    if (detail.status === "PROPOSED") return;
    if (detail.status !== "DRAFT") conflict("Decision changed while it was being proposed.");
    if (detail.snapshot.status !== "PUBLISHED") conflict("Decision snapshot is not published.");
    if (!detail.scenarios.length || !detail.evidenceLinks.length) {
      conflict("A decision needs at least one scenario and one evidence record before proposal.");
    }
    const proposalHash = supplyJsonHash(sealedDecisionScope(detail));
    await tx.supplyDecision.update({
      where: { id: decision.id },
      data: { status: "PROPOSED", proposalHash },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return decisionDetail(decision.id);
}

function assertApprovalRequest(input: RequestSupplyApprovalInput) {
  const inputObject = plainObject(input, "Approval request");
  assertOnlyKeys(inputObject, ["reason", "context", "expiresAt", "idempotencyKey"], "Approval request");
  const key = idempotencyKey(input.idempotencyKey);
  const requestContext = optionalObject(input.context, "Approval context");
  const expiresAt = normalizedDate(input.expiresAt, "Approval expiry", true);
  return {
    key,
    requestReason: optionalText(input.reason, "Approval reason", 4_000),
    requestContext,
    expiresAt,
  };
}

export async function requestSupplyDecisionApproval(
  context: SupplyAccessContext,
  decisionId: string,
  input: RequestSupplyApprovalInput,
) {
  const decision = await requireDecision(context, decisionId, "edit");
  await assertCurrentSupplySnapshot(context, decision.workspaceId, decision.snapshotId);
  if (decision.status !== "PROPOSED" || !decision.proposalHash) {
    conflict("Only a sealed proposed decision can request approval.");
  }
  const request = assertApprovalRequest(input);
  const existing = await prisma.supplyApproval.findFirst({
    where: { officeId: context.officeId, workspaceId: decision.workspaceId, idempotencyKey: request.key },
  });
  if (existing) {
    if (existing.decisionId !== decision.id || existing.scopeHash !== decision.proposalHash) {
      conflict("Idempotency key is already bound to a different approval request.");
    }
    return existing;
  }
  return prisma.supplyApproval.create({
    data: {
      officeId: context.officeId,
      workspaceId: decision.workspaceId,
      decisionId: decision.id,
      requestedByUserId: context.userId,
      requiredRole: DECISION_REQUIRED_ROLE,
      scopeHash: decision.proposalHash,
      requestReason: request.requestReason,
      ...(request.requestContext ? { requestContext: request.requestContext as Prisma.InputJsonValue } : {}),
      idempotencyKey: request.key,
      expiresAt: request.expiresAt,
    },
  });
}

function approverRoles(requiredRole: string | null) {
  return requiredRole === "ADMIN" ? ["ADMIN"] : ["ADMIN", "MANAGER"];
}

async function assertApprover(context: SupplyAccessContext, approval: { requestedByUserId: string | null; requiredRole: string | null }) {
  if (!approverRoles(approval.requiredRole).includes(context.role)) {
    throw new SupplyPersistenceError(`This approval requires ${approval.requiredRole ?? "MANAGER"} authority.`, "forbidden");
  }
  if (approval.requestedByUserId !== context.userId) return;
  const alternatives = await prisma.user.count({
    where: {
      officeId: context.officeId,
      isActive: true,
      id: { not: context.userId },
      role: { in: approverRoles(approval.requiredRole) as Array<"ADMIN" | "MANAGER"> },
    },
  });
  if (alternatives > 0) {
    throw new SupplyPersistenceError("A different eligible approver is available, so self-approval is blocked.", "forbidden");
  }
}

export async function decideSupplyApproval(
  context: SupplyAccessContext,
  approvalId: string,
  input: { decision: "APPROVE" | "REJECT"; note?: string | null },
) {
  if (context.role !== "ADMIN" && context.role !== "MANAGER") {
    throw new SupplyPersistenceError("Only an admin or manager can decide approvals.", "forbidden");
  }
  const approval = await prisma.supplyApproval.findFirst({
    where: { id: approvalId, officeId: context.officeId },
  });
  if (!approval) throw new SupplyPersistenceError("Supply approval not found.", "not_found");
  const inputObject = plainObject(input, "Approval decision");
  assertOnlyKeys(inputObject, ["decision", "note"], "Approval decision");
  await requireSupplyWorkspace(context, approval.workspaceId, "edit");
  const desired: DecisionStatus = input.decision === "APPROVE" ? "APPROVED" : input.decision === "REJECT" ? "REJECTED" : invalid("Decision must be APPROVE or REJECT.");
  if (approval.decisionId && approval.requiredRole !== DECISION_REQUIRED_ROLE) {
    conflict("Decision approval authority does not match the required policy.");
  }
  let approvalSnapshotId: string | null = null;
  if (approval.decisionId) {
    const targetDecision = await prisma.supplyDecision.findFirst({
      where: { id: approval.decisionId, officeId: context.officeId, workspaceId: approval.workspaceId },
      select: { snapshotId: true },
    });
    if (!targetDecision) conflict("The approval decision no longer exists.");
    approvalSnapshotId = targetDecision.snapshotId;
  }
  if (approval.executionTaskId) {
    const targetTask = await prisma.supplyExecutionTask.findFirst({
      where: { id: approval.executionTaskId, officeId: context.officeId, workspaceId: approval.workspaceId },
      select: { input: true, snapshotId: true },
    });
    if (!targetTask) conflict("The approval execution task no longer exists.");
    approvalSnapshotId = targetTask.snapshotId;
    const action = executionAction((targetTask.input as JsonObject).action);
    if (approval.requiredRole !== ACTION_REQUIRED_ROLE[action]) {
      conflict("Task approval authority does not match the action policy.");
    }
  }
  await assertCurrentSupplySnapshot(context, approval.workspaceId, approvalSnapshotId);
  if (approval.status !== "PENDING") {
    if (approval.status === desired && approval.decidedByUserId === context.userId) return approval;
    conflict("This approval has already been decided.");
  }
  if (approval.expiresAt && approval.expiresAt.getTime() <= Date.now()) conflict("This approval request has expired.");
  await assertApprover(context, approval);
  const note = optionalText(input.note, "Approval note", 4_000);
  const decidedAt = new Date();

  await prisma.$transaction(async (tx) => {
    const changed = await tx.supplyApproval.updateMany({
      where: { id: approval.id, officeId: context.officeId, status: "PENDING" },
      data: { status: desired, decidedByUserId: context.userId, decidedAt, decisionNote: note },
    });
    if (changed.count !== 1) conflict("Approval changed while it was being decided. Retry the request.");
    if (approval.decisionId) {
      const decision = await tx.supplyDecision.findFirst({
        where: { id: approval.decisionId, officeId: context.officeId, status: "PROPOSED", proposalHash: approval.scopeHash },
      });
      if (!decision) conflict("The decision no longer matches this approval scope.");
      await tx.supplyDecision.update({
        where: { id: decision.id },
        data: { status: desired, finalizedAt: decidedAt },
      });
    } else if (approval.executionTaskId && desired === "REJECTED") {
      const task = await tx.supplyExecutionTask.findFirst({
        where: { id: approval.executionTaskId, officeId: context.officeId, inputHash: approval.scopeHash, status: { in: ["PLANNED", "BLOCKED"] } },
      });
      if (!task) conflict("The execution task no longer matches this approval scope.");
      if (task.status === "PLANNED") {
        await tx.supplyExecutionTask.update({ where: { id: task.id }, data: { status: "BLOCKED" } });
      }
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return prisma.supplyApproval.findUniqueOrThrow({ where: { id: approval.id } });
}

function executionAction(value: unknown) {
  if (typeof value !== "string" || !EXECUTION_ACTIONS.includes(value as ExecutionAction)) {
    invalid(`Action must be one of: ${EXECUTION_ACTIONS.join(", ")}.`);
  }
  return value as ExecutionAction;
}

export async function createSupplyExecutionTask(
  context: SupplyAccessContext,
  decisionId: string,
  input: CreateSupplyExecutionTaskInput,
) {
  const decision = await requireDecision(context, decisionId, "edit");
  await assertCurrentSupplySnapshot(context, decision.workspaceId, decision.snapshotId);
  if (decision.status !== "APPROVED") conflict("Execution tasks require an approved decision.");
  const snapshot = await prisma.supplySnapshot.findFirst({
    where: { id: decision.snapshotId, officeId: context.officeId, workspaceId: decision.workspaceId, status: "PUBLISHED" },
  });
  if (!snapshot) conflict("Execution tasks require a published decision snapshot.");
  const inputObject = plainObject(input, "Execution task request");
  assertOnlyKeys(inputObject, ["scenarioId", "taskKey", "input", "externalSystem", "scheduledFor", "idempotencyKey"], "Execution task request");
  const key = idempotencyKey(input.idempotencyKey);
  const taskKey = requiredText(input.taskKey, "Task key", 160);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(taskKey)) invalid("Task key contains unsupported characters.");
  const actionInput = plainObject(input.input, "Execution input") as { plan: unknown; action: unknown };
  const capability = getSupplyCapability("action.execute");
  const parsed = capability?.inputSchema.safeParse(actionInput);
  if (!parsed?.success) invalid("Execution input does not match the action.execute capability contract.");
  const action = executionAction(parsed.data.action);
  const normalizedInput = {
    plan: requiredText(parsed.data.plan, "Execution plan", 500),
    action,
  };
  const inputHash = supplyJsonHash(normalizedInput);
  const scheduledFor = normalizedDate(input.scheduledFor, "Scheduled timestamp");
  const externalSystem = optionalText(input.externalSystem, "External system", 160);

  let scenarioId: string | null = null;
  if (input.scenarioId) {
    const scenario = await prisma.supplyScenario.findFirst({
      where: { id: input.scenarioId, decisionId: decision.id, officeId: context.officeId, workspaceId: decision.workspaceId },
      select: { id: true },
    });
    if (!scenario) invalid("Execution scenario does not belong to this decision.");
    scenarioId = scenario.id;
  }

  const existing = await prisma.supplyExecutionTask.findFirst({
    where: { officeId: context.officeId, workspaceId: decision.workspaceId, idempotencyKey: key },
  });
  if (existing) {
    if (existing.decisionId !== decision.id || existing.taskKey !== taskKey || existing.inputHash !== inputHash) {
      conflict("Idempotency key is already bound to a different execution task.");
    }
    return existing;
  }

  return prisma.$transaction(async (tx) => {
    const task = await tx.supplyExecutionTask.create({
      data: {
        officeId: context.officeId,
        workspaceId: decision.workspaceId,
        snapshotId: decision.snapshotId,
        decisionId: decision.id,
        scenarioId,
        createdByUserId: context.userId,
        taskKey,
        taskType: "action.execute",
        capabilityKey: "action.execute",
        status: "PLANNED",
        requiresApproval: true,
        input: normalizedInput,
        inputHash,
        externalSystem,
        idempotencyKey: key,
        scheduledFor,
      },
    });
    const eventPayload = { action, requiredRole: ACTION_REQUIRED_ROLE[action] };
    await tx.supplyExecutionEvent.create({
      data: {
        officeId: context.officeId,
        workspaceId: decision.workspaceId,
        executionTaskId: task.id,
        actorUserId: context.userId,
        sequence: 1,
        eventType: "TASK_PLANNED",
        status: "PLANNED",
        message: "Action prepared. No external side effect has been released.",
        payload: eventPayload,
        payloadHash: supplyJsonHash(eventPayload),
        idempotencyKey: "planned",
      },
    });
    return task;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function requestSupplyTaskApproval(
  context: SupplyAccessContext,
  taskId: string,
  input: RequestSupplyApprovalInput,
) {
  const task = await requireExecutionTask(context, taskId, "edit");
  await assertCurrentSupplySnapshot(context, task.workspaceId, task.snapshotId);
  if (task.taskType !== "action.execute" || task.capabilityKey !== "action.execute") {
    invalid("Only action.execute tasks use this approval path.");
  }
  if (task.status !== "PLANNED" && task.status !== "BLOCKED") {
    conflict("Only a planned or blocked task can request approval.");
  }
  const action = executionAction((task.input as JsonObject).action);
  const request = assertApprovalRequest(input);
  const existing = await prisma.supplyApproval.findFirst({
    where: { officeId: context.officeId, workspaceId: task.workspaceId, idempotencyKey: request.key },
  });
  if (existing) {
    if (existing.executionTaskId !== task.id || existing.scopeHash !== task.inputHash) {
      conflict("Idempotency key is already bound to a different approval request.");
    }
    return existing;
  }
  return prisma.supplyApproval.create({
    data: {
      officeId: context.officeId,
      workspaceId: task.workspaceId,
      executionTaskId: task.id,
      requestedByUserId: context.userId,
      requiredRole: ACTION_REQUIRED_ROLE[action],
      scopeHash: task.inputHash,
      requestReason: request.requestReason,
      ...(request.requestContext ? { requestContext: request.requestContext as Prisma.InputJsonValue } : {}),
      idempotencyKey: request.key,
      expiresAt: request.expiresAt,
    },
  });
}

export async function releaseSupplyExecutionTask(context: SupplyAccessContext, taskId: string) {
  const task = await requireExecutionTask(context, taskId, "edit");
  await assertCurrentSupplySnapshot(context, task.workspaceId, task.snapshotId);
  if (task.status === "READY") {
    return prisma.supplyExecutionTask.findUniqueOrThrow({
      where: { id: task.id },
      include: { approvals: { orderBy: { requestedAt: "desc" } }, events: { orderBy: { sequence: "asc" } } },
    });
  }
  if (task.status !== "PLANNED" && task.status !== "BLOCKED") {
    conflict("Only a planned or blocked task can be released.");
  }
  const matchingApproval = await prisma.supplyApproval.findFirst({
    where: {
      officeId: context.officeId,
      workspaceId: task.workspaceId,
      executionTaskId: task.id,
      status: "APPROVED",
      scopeHash: task.inputHash,
      requiredRole: ACTION_REQUIRED_ROLE[executionAction((task.input as JsonObject).action)],
    },
    select: { id: true, requiredRole: true, decidedBy: { select: { role: true, isActive: true } } },
  });
  if (!matchingApproval) conflict("Task release requires matching human approval of the exact input hash.");
  if (!matchingApproval.decidedBy?.isActive || !approverRoles(matchingApproval.requiredRole).includes(matchingApproval.decidedBy.role)) {
    conflict("Task approval no longer has an active eligible approver.");
  }

  await prisma.$transaction(async (tx) => {
    const changed = await tx.supplyExecutionTask.updateMany({
      where: { id: task.id, officeId: context.officeId, status: { in: ["PLANNED", "BLOCKED"] } },
      data: { status: "READY" },
    });
    if (changed.count !== 1) conflict("Execution task changed while it was being released. Retry the request.");
    const sequence = await tx.supplyExecutionEvent.aggregate({
      where: { executionTaskId: task.id },
      _max: { sequence: true },
    });
    const payload = { approvalId: matchingApproval.id, inputHash: task.inputHash };
    await tx.supplyExecutionEvent.create({
      data: {
        officeId: context.officeId,
        workspaceId: task.workspaceId,
        executionTaskId: task.id,
        actorUserId: context.userId,
        sequence: (sequence._max.sequence ?? 0) + 1,
        eventType: "TASK_RELEASED",
        status: "READY",
        message: "Action is approved and ready. No external side effect has been performed.",
        payload,
        payloadHash: supplyJsonHash(payload),
        idempotencyKey: `release:${task.inputHash}`,
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return prisma.supplyExecutionTask.findUniqueOrThrow({
    where: { id: task.id },
    include: { approvals: { orderBy: { requestedAt: "desc" } }, events: { orderBy: { sequence: "asc" } } },
  });
}

export async function getSupplyControlState(context: SupplyAccessContext, workspaceId: string) {
  await requireSupplyWorkspace(context, workspaceId, "view");
  const workspace = await prisma.supplyWorkspace.findFirstOrThrow({
    where: { id: workspaceId, officeId: context.officeId },
    select: {
      id: true,
      name: true,
      version: true,
      updatedAt: true,
      snapshots: {
        where: { status: "PUBLISHED" },
        orderBy: { version: "desc" },
        take: 1,
        select: { id: true, version: true, sourceHash: true, publishedAt: true },
      },
      decisions: {
        orderBy: { createdAt: "desc" },
        take: 50,
        include: {
          scenarios: { orderBy: [{ rank: "asc" }, { scenarioKey: "asc" }] },
          evidenceLinks: { include: { evidence: true } },
          approvals: { orderBy: { requestedAt: "desc" } },
          executionTasks: {
            orderBy: { createdAt: "desc" },
            include: { approvals: { orderBy: { requestedAt: "desc" } }, events: { orderBy: { sequence: "asc" } } },
          },
        },
      },
      approvals: {
        where: { status: "PENDING" },
        orderBy: { requestedAt: "asc" },
        take: 100,
      },
      executionTasks: {
        where: { status: { in: ["PLANNED", "BLOCKED", "READY", "RUNNING"] } },
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { approvals: { orderBy: { requestedAt: "desc" } }, events: { orderBy: { sequence: "asc" } } },
      },
    },
  });
  return {
    workspace: { id: workspace.id, name: workspace.name, version: workspace.version, updatedAt: workspace.updatedAt },
    snapshot: workspace.snapshots[0] ?? null,
    decisions: workspace.decisions,
    pendingApprovals: workspace.approvals,
    activeTasks: workspace.executionTasks,
  };
}
