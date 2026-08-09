import {
  SUPPLY_EVIDENCE_KINDS,
  getCapabilityOutputFields,
  getSupplyCapability,
  type SupplyApprovalPolicy,
  type SupplyCapabilityName,
  type SupplyEvidenceKind,
  type SupplyRiskClass,
} from "./capabilities";

export type SupplyDslContext = {
  officeId: string;
  workspaceId: string;
  actorId: string;
};

export type SupplyDslEvidence = {
  id: string;
  kind: SupplyEvidenceKind;
  trust: "trusted" | "untrusted";
  source: string;
  observedAt: string;
  line: number;
};

export type SupplyDslApproval = {
  stepId: string;
  approverId: string;
  role: string;
  approvedAt: string;
  line: number;
};

export type SupplyDslStep = {
  id: string;
  capability: string;
  dependencies: string[];
  inputs: Record<string, string>;
  line: number;
};

export type ParsedSupplyDsl = {
  version: "v1";
  context: SupplyDslContext;
  evidence: SupplyDslEvidence[];
  approvals: SupplyDslApproval[];
  steps: SupplyDslStep[];
};

export type CompiledSupplyStep = {
  id: string;
  capability: SupplyCapabilityName;
  context: SupplyDslContext;
  dependencies: string[];
  inputs: Readonly<Record<string, string>>;
  outputFields: string[];
  evidenceIds: string[];
  riskClass: SupplyRiskClass;
  requiredEvidence: readonly SupplyEvidenceKind[];
  approvalPolicy: SupplyApprovalPolicy;
  approval: Omit<SupplyDslApproval, "line"> | null;
};

export type CompiledSupplyPlan = {
  version: "v1";
  planId: string;
  context: SupplyDslContext;
  evidence: Array<Omit<SupplyDslEvidence, "line">>;
  steps: CompiledSupplyStep[];
};

export type SupplyDslErrorCode =
  | "SYNTAX_ERROR"
  | "INVALID_CONTEXT"
  | "DUPLICATE_ID"
  | "UNKNOWN_CAPABILITY"
  | "INVALID_INPUT"
  | "INVALID_DEPENDENCY"
  | "INVALID_EVIDENCE"
  | "MISSING_EVIDENCE"
  | "MISSING_APPROVAL"
  | "UNTRUSTED_EXECUTION";

export class SupplyDslError extends Error {
  readonly code: SupplyDslErrorCode;
  readonly line?: number;

  constructor(code: SupplyDslErrorCode, message: string, line?: number) {
    super(line ? `Line ${line}: ${message}` : message);
    this.name = "SupplyDslError";
    this.code = code;
    this.line = line;
  }
}

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const STEP_REFERENCE_PATTERN = /^\$([A-Za-z][A-Za-z0-9_-]*)\.([A-Za-z][A-Za-z0-9_]*)$/;
const EVIDENCE_REFERENCE_PATTERN = /^\$evidence\.([A-Za-z][A-Za-z0-9_-]*)$/;

type LogicalLine = { number: number; value: string };

function stripComment(value: string) {
  let quoted: "'" | '"' | null = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quoted) {
      if (character === quoted) quoted = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quoted = character;
      continue;
    }
    if (character === "#") return value.slice(0, index);
  }
  return value;
}

function logicalLines(source: string): LogicalLine[] {
  return source
    .split(/\r?\n/)
    .map((value, index) => ({ number: index + 1, value: stripComment(value).trim() }))
    .filter((line) => Boolean(line.value));
}

function tokenize(line: LogicalLine) {
  const tokens: string[] = [];
  let token = "";
  let quoted: "'" | '"' | null = null;
  let escaped = false;

  for (const character of line.value) {
    if (escaped) {
      token += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quoted) {
      if (character === quoted) quoted = null;
      else token += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quoted = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (token) tokens.push(token);
      token = "";
      continue;
    }
    token += character;
  }

  if (quoted) throw new SupplyDslError("SYNTAX_ERROR", "Unclosed quoted value.", line.number);
  if (escaped) throw new SupplyDslError("SYNTAX_ERROR", "Dangling escape character.", line.number);
  if (token) tokens.push(token);
  return tokens;
}

function assignments(tokens: string[], line: number) {
  const result: Record<string, string> = {};
  for (const token of tokens) {
    const separator = token.indexOf("=");
    if (separator < 1 || separator === token.length - 1) {
      throw new SupplyDslError("SYNTAX_ERROR", `Expected key=value, received "${token}".`, line);
    }
    const key = token.slice(0, separator);
    const value = token.slice(separator + 1);
    if (Object.hasOwn(result, key)) {
      throw new SupplyDslError("SYNTAX_ERROR", `Duplicate field "${key}".`, line);
    }
    result[key] = value;
  }
  return result;
}

function requiredValue(values: Record<string, string>, key: string, line: number) {
  const value = values[key]?.trim();
  if (!value) throw new SupplyDslError("SYNTAX_ERROR", `Missing required field "${key}".`, line);
  return value;
}

function validId(value: string, label: string, line: number) {
  if (!ID_PATTERN.test(value)) {
    throw new SupplyDslError("SYNTAX_ERROR", `${label} "${value}" is not a valid identifier.`, line);
  }
  return value;
}

function validTimestamp(value: string, label: string, line: number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new SupplyDslError("SYNTAX_ERROR", `${label} must be an ISO timestamp.`, line);
  }
  return date.toISOString();
}

function assertOnlyFields(values: Record<string, string>, allowed: string[], line: number) {
  const unexpected = Object.keys(values).filter((key) => !allowed.includes(key));
  if (unexpected.length) {
    throw new SupplyDslError(
      "SYNTAX_ERROR",
      `Unexpected field${unexpected.length === 1 ? "" : "s"}: ${unexpected.sort().join(", ")}.`,
      line,
    );
  }
}

export function parseSupplyDsl(source: string): ParsedSupplyDsl {
  const lines = logicalLines(source);
  const header = lines.shift();
  if (!header || header.value !== "supply-os/v1") {
    throw new SupplyDslError("SYNTAX_ERROR", "The first statement must be supply-os/v1.", header?.number);
  }

  let context: SupplyDslContext | null = null;
  const evidence: SupplyDslEvidence[] = [];
  const approvals: SupplyDslApproval[] = [];
  const steps: SupplyDslStep[] = [];
  const evidenceIds = new Set<string>();
  const stepIds = new Set<string>();
  const approvalStepIds = new Set<string>();

  for (const line of lines) {
    const [statement, identifier, ...remaining] = tokenize(line);
    if (statement === "context") {
      if (context) throw new SupplyDslError("DUPLICATE_ID", "Context is already declared.", line.number);
      const values = assignments([identifier, ...remaining].filter((value): value is string => Boolean(value)), line.number);
      assertOnlyFields(values, ["office", "workspace", "actor"], line.number);
      context = {
        officeId: requiredValue(values, "office", line.number),
        workspaceId: requiredValue(values, "workspace", line.number),
        actorId: requiredValue(values, "actor", line.number),
      };
      continue;
    }

    if (!identifier) {
      throw new SupplyDslError("SYNTAX_ERROR", `${statement ?? "Statement"} requires an identifier.`, line.number);
    }
    validId(identifier, "Identifier", line.number);
    const values = assignments(remaining, line.number);

    if (statement === "evidence") {
      if (evidenceIds.has(identifier)) {
        throw new SupplyDslError("DUPLICATE_ID", `Evidence "${identifier}" is already declared.`, line.number);
      }
      assertOnlyFields(values, ["type", "trust", "source", "observedAt"], line.number);
      const kind = requiredValue(values, "type", line.number);
      if (!SUPPLY_EVIDENCE_KINDS.includes(kind as SupplyEvidenceKind)) {
        throw new SupplyDslError("INVALID_EVIDENCE", `Unknown evidence type "${kind}".`, line.number);
      }
      const trust = requiredValue(values, "trust", line.number);
      if (trust !== "trusted" && trust !== "untrusted") {
        throw new SupplyDslError("INVALID_EVIDENCE", "Evidence trust must be trusted or untrusted.", line.number);
      }
      evidenceIds.add(identifier);
      evidence.push({
        id: identifier,
        kind: kind as SupplyEvidenceKind,
        trust,
        source: requiredValue(values, "source", line.number),
        observedAt: validTimestamp(requiredValue(values, "observedAt", line.number), "observedAt", line.number),
        line: line.number,
      });
      continue;
    }

    if (statement === "approval") {
      if (approvalStepIds.has(identifier)) {
        throw new SupplyDslError("DUPLICATE_ID", `Approval for "${identifier}" is already declared.`, line.number);
      }
      assertOnlyFields(values, ["by", "role", "at"], line.number);
      approvalStepIds.add(identifier);
      approvals.push({
        stepId: identifier,
        approverId: requiredValue(values, "by", line.number),
        role: requiredValue(values, "role", line.number),
        approvedAt: validTimestamp(requiredValue(values, "at", line.number), "at", line.number),
        line: line.number,
      });
      continue;
    }

    if (statement === "step") {
      if (stepIds.has(identifier)) {
        throw new SupplyDslError("DUPLICATE_ID", `Step "${identifier}" is already declared.`, line.number);
      }
      const capability = requiredValue(values, "uses", line.number);
      const dependencyValue = values.after ?? "-";
      delete values.uses;
      delete values.after;
      const dependencies = dependencyValue === "-" ? [] : dependencyValue.split(",").filter(Boolean);
      if (new Set(dependencies).size !== dependencies.length) {
        throw new SupplyDslError("INVALID_DEPENDENCY", `Step "${identifier}" repeats a dependency.`, line.number);
      }
      stepIds.add(identifier);
      steps.push({ id: identifier, capability, dependencies, inputs: values, line: line.number });
      continue;
    }

    throw new SupplyDslError("SYNTAX_ERROR", `Unknown statement "${statement}".`, line.number);
  }

  if (!context) throw new SupplyDslError("INVALID_CONTEXT", "Exactly one context statement is required.");
  if (!steps.length) throw new SupplyDslError("SYNTAX_ERROR", "At least one step is required.");
  return { version: "v1", context, evidence, approvals, steps };
}

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function failDependency(message: string, line: number): never {
  throw new SupplyDslError("INVALID_DEPENDENCY", message, line);
}

function topologicalStepIds(steps: SupplyDslStep[]) {
  const byId = new Map(steps.map((step) => [step.id, step]));
  const incoming = new Map(steps.map((step) => [step.id, step.dependencies.length]));
  const downstream = new Map<string, string[]>();

  for (const step of steps) {
    for (const dependency of step.dependencies) {
      if (!byId.has(dependency)) {
        failDependency(`Step "${step.id}" depends on unknown step "${dependency}".`, step.line);
      }
      if (dependency === step.id) {
        failDependency(`Step "${step.id}" cannot depend on itself.`, step.line);
      }
      const targets = downstream.get(dependency) ?? [];
      targets.push(step.id);
      downstream.set(dependency, targets);
    }
  }

  const ready = [...incoming.entries()]
    .filter(([, count]) => count === 0)
    .map(([id]) => id)
    .sort();
  const ordered: string[] = [];
  while (ready.length) {
    const id = ready.shift();
    if (!id) break;
    ordered.push(id);
    for (const target of (downstream.get(id) ?? []).sort()) {
      const count = (incoming.get(target) ?? 0) - 1;
      incoming.set(target, count);
      if (count === 0) {
        ready.push(target);
        ready.sort();
      }
    }
  }

  if (ordered.length !== steps.length) {
    const cycle = [...incoming.entries()]
      .filter(([, count]) => count > 0)
      .map(([id]) => id)
      .sort()
      .join(", ");
    const line = steps.find((step) => cycle.includes(step.id))?.line ?? steps[0]?.line ?? 1;
    failDependency(`Dependency cycle detected among: ${cycle}.`, line);
  }
  return ordered;
}

function validateReferences(args: {
  step: SupplyDslStep;
  allSteps: Map<string, SupplyDslStep>;
  evidence: Map<string, SupplyDslEvidence>;
}) {
  const directEvidence = new Set<string>();
  for (const value of Object.values(args.step.inputs)) {
    if (!value.startsWith("$")) continue;
    const evidenceMatch = EVIDENCE_REFERENCE_PATTERN.exec(value);
    if (evidenceMatch) {
      const evidenceId = evidenceMatch[1];
      if (!args.evidence.has(evidenceId)) {
        throw new SupplyDslError(
          "INVALID_EVIDENCE",
          `Step "${args.step.id}" references unknown evidence "${evidenceId}".`,
          args.step.line,
        );
      }
      directEvidence.add(evidenceId);
      continue;
    }

    const stepMatch = STEP_REFERENCE_PATTERN.exec(value);
    if (!stepMatch) {
      throw new SupplyDslError("INVALID_INPUT", `Invalid reference "${value}".`, args.step.line);
    }
    const [, sourceStepId, outputField] = stepMatch;
    const sourceStep = args.allSteps.get(sourceStepId);
    if (!sourceStep) {
      failDependency(`Step "${args.step.id}" references unknown step "${sourceStepId}".`, args.step.line);
    }
    if (!args.step.dependencies.includes(sourceStepId)) {
      failDependency(
        `Step "${args.step.id}" must declare "${sourceStepId}" in after before using its output.`,
        args.step.line,
      );
    }
    const sourceCapability = getSupplyCapability(sourceStep.capability);
    if (!sourceCapability) {
      throw new SupplyDslError(
        "UNKNOWN_CAPABILITY",
        `Unknown capability "${sourceStep.capability}" on step "${sourceStep.id}".`,
        sourceStep.line,
      );
    }
    if (!getCapabilityOutputFields(sourceCapability).includes(outputField)) {
      throw new SupplyDslError(
        "INVALID_INPUT",
        `Capability "${sourceStep.capability}" does not output "${outputField}".`,
        args.step.line,
      );
    }
  }
  return directEvidence;
}

export function compileSupplyDsl(source: string): CompiledSupplyPlan {
  const parsed = parseSupplyDsl(source);
  const allSteps = new Map(parsed.steps.map((step) => [step.id, step]));
  const evidence = new Map(parsed.evidence.map((item) => [item.id, item]));
  const approvals = new Map(parsed.approvals.map((approval) => [approval.stepId, approval]));
  const order = topologicalStepIds(parsed.steps);
  const compiled = new Map<string, CompiledSupplyStep>();

  for (const stepId of order) {
    const step = allSteps.get(stepId);
    if (!step) throw new SupplyDslError("INVALID_DEPENDENCY", `Step "${stepId}" disappeared during compilation.`);
    const capability = getSupplyCapability(step.capability);
    if (!capability) {
      throw new SupplyDslError(
        "UNKNOWN_CAPABILITY",
        `Unknown capability "${step.capability}" on step "${step.id}".`,
        step.line,
      );
    }

    const inputResult = capability.inputSchema.safeParse(step.inputs);
    if (!inputResult.success) {
      const problems = inputResult.error.issues
        .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
        .join("; ");
      throw new SupplyDslError(
        "INVALID_INPUT",
        `Invalid inputs for ${capability.name}: ${problems}.`,
        step.line,
      );
    }

    const evidenceIds = validateReferences({ step, allSteps, evidence });
    for (const dependencyId of step.dependencies) {
      const dependency = compiled.get(dependencyId);
      if (!dependency) {
        failDependency(`Step "${step.id}" depends on uncompiled step "${dependencyId}".`, step.line);
      }
      dependency.evidenceIds.forEach((evidenceId) => evidenceIds.add(evidenceId));
    }
    const sortedEvidenceIds = [...evidenceIds].sort();
    const evidenceKinds = new Set(sortedEvidenceIds.map((id) => evidence.get(id)?.kind));
    const missingEvidence = capability.requiredEvidence.filter((kind) => !evidenceKinds.has(kind));
    if (missingEvidence.length) {
      throw new SupplyDslError(
        "MISSING_EVIDENCE",
        `Step "${step.id}" requires evidence: ${missingEvidence.join(", ")}.`,
        step.line,
      );
    }

    const approval = approvals.get(step.id) ?? null;
    if (capability.approvalPolicy.kind === "HUMAN") {
      if (!approval) {
        throw new SupplyDslError(
          "MISSING_APPROVAL",
          `Step "${step.id}" requires human approval.`,
          step.line,
        );
      }
      if (!capability.approvalPolicy.allowedRoles.includes(approval.role)) {
        throw new SupplyDslError(
          "MISSING_APPROVAL",
          `Role "${approval.role}" cannot approve step "${step.id}".`,
          approval.line,
        );
      }
    }

    if (capability.riskClass === "EXECUTION") {
      const untrusted = sortedEvidenceIds.filter((id) => evidence.get(id)?.trust !== "trusted");
      if (untrusted.length) {
        throw new SupplyDslError(
          "UNTRUSTED_EXECUTION",
          `Step "${step.id}" cannot execute from untrusted evidence: ${untrusted.join(", ")}.`,
          step.line,
        );
      }
    }

    compiled.set(step.id, {
      id: step.id,
      capability: capability.name,
      context: { ...parsed.context },
      dependencies: [...step.dependencies].sort(),
      inputs: Object.freeze({ ...step.inputs }),
      outputFields: getCapabilityOutputFields(capability),
      evidenceIds: sortedEvidenceIds,
      riskClass: capability.riskClass,
      requiredEvidence: capability.requiredEvidence,
      approvalPolicy: capability.approvalPolicy,
      approval: approval
        ? {
            stepId: approval.stepId,
            approverId: approval.approverId,
            role: approval.role,
            approvedAt: approval.approvedAt,
          }
        : null,
    });
  }

  for (const approval of parsed.approvals) {
    if (!allSteps.has(approval.stepId)) {
      throw new SupplyDslError(
        "MISSING_APPROVAL",
        `Approval targets unknown step "${approval.stepId}".`,
        approval.line,
      );
    }
  }

  const steps = order.map((id) => compiled.get(id)).filter((step): step is CompiledSupplyStep => Boolean(step));
  const evidenceOutput = parsed.evidence
    .map(({ line: _line, ...item }) => item)
    .sort((left, right) => left.id.localeCompare(right.id));
  const canonical = JSON.stringify({ version: parsed.version, context: parsed.context, evidence: evidenceOutput, steps });
  return {
    version: "v1",
    planId: `supply-plan-${stableHash(canonical)}`,
    context: { ...parsed.context },
    evidence: evidenceOutput,
    steps,
  };
}
