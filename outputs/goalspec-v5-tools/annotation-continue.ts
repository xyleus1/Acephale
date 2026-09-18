import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { annotateRow, VERSION as ORIGINAL_VERSION, type AnnotationInput } from "../../scripts/goalspec-annotation-v5";
import { canonical, hash } from "../../src/lib/goalspec/canonical";
import { RESEARCH_MODELS, type ModelPort } from "../../src/lib/goalspec/model";
import { maximumCost, researchProvider, TrialLedger } from "../../services/goalspec-runtime/provider";
import { DurableBudget } from "../../services/goalspec-runtime/durable-budget";
import { ImmutableEventLog } from "../../services/goalspec-runtime/artifacts";

const ROOT = resolve(__dirname, "../.."), VERSION = "goalspec-v5-never-dispatched-annotation-continuation-v2";
const PER_ROW = maximumCost(RESEARCH_MODELS.goal, 8192, 1024) + 2 * maximumCost(RESEARCH_MODELS.teacher, 8192, 4096);
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const write = (path: string, value: unknown) => writeFileSync(path, canonical(value) + "\n", { flag: "wx" });
const jsonl = (path: string) => readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
type Input = AnnotationInput & { reliabilitySplit: string };
type Result = Awaited<ReturnType<typeof annotateRow>>;
type Source = { path: string; sha256: string };

export function checkEventChain(records: any[], allowBoundedUnknown = false) {
  let previous = "0".repeat(64), knownCost = 0;
  const attempts = new Set<string>(), requestIds = new Set<string>();
  const uncertainRequests: { id: string; model: string; maximumMicrodollars: number }[] = [];
  for (const [sequence, record] of records.entries()) {
    if (record.body.sequence !== sequence || record.body.previousHash !== previous || hash(record.body) !== record.hash)
      throw new Error("Original provider event chain mismatch");
    previous = record.hash;
    const event = record.body.event;
    if (typeof event.type !== "string" || typeof event.id !== "string") throw new Error("Unclassified provider event");
    if (event.type.startsWith("model_attempt")) {
      const match = /^v5-annotation:([a-f0-9]{64}):(blind|prediction|agreement)$/.exec(event.id);
      if (!match) throw new Error("Unrecognized annotation provider attempt");
      if (requestIds.has(event.id)) throw new Error("Duplicate physical request across original no-retry annotation events");
      requestIds.add(event.id);
      attempts.add(match[1]!);
      if (event.type !== "model_attempt" || !Number.isSafeInteger(event.costMicrodollars) || event.costMicrodollars < 0) {
        if (!allowBoundedUnknown || event.type !== "model_attempt_failed" || event.reservationRetained !== true
          || ![RESEARCH_MODELS.goal, RESEARCH_MODELS.teacher].includes(event.model))
          throw new Error("Unknown previous provider charge requires reconciliation");
        uncertainRequests.push({ id: event.id, model: event.model, maximumMicrodollars: maximumCost(event.model, 8192,
          event.model === RESEARCH_MODELS.teacher ? 4096 : 1024) });
      } else knownCost += event.costMicrodollars;
    }
  }
  return { attemptedGroupIds: [...attempts], knownCostMicrodollars: knownCost, finalHash: previous, events: records.length,
    physicalRequestIds: [...requestIds], uncertainRequests,
    unknownMaximumMicrodollars: uncertainRequests.reduce((sum, item) => sum + item.maximumMicrodollars, 0) };
}

export function neverDispatched(selected: Input[], previous: Result[], attemptedIds: string[]) {
  if (selected.length !== previous.length || new Set(selected.map(row => row.groupId)).size !== selected.length
    || new Set(previous.map(row => row.groupId)).size !== previous.length) throw new Error("Original cohort denominator mismatch");
  const attempted = new Set(attemptedIds), known = new Set(selected.map(row => row.groupId));
  if (attemptedIds.some(id => !known.has(id))) throw new Error("Provider attempt outside selected cohort");
  return selected.flatMap((row, ordinal) => {
    const result = previous[ordinal]!;
    for (const key of ["groupId", "familyId", "frameHash", "prefixHash", "publicInputHash", "sourceRevisionHash", "reliabilitySplit"] as const)
      if (row[key] !== result[key]) throw new Error("Original row order or identity changed");
    if (attempted.has(row.groupId)) return [];
    if (result.goals !== null || result.prediction.status !== "failed" || result.annotation.status !== "failed"
      || result.annotation.value !== null || result.agreement.label !== null)
      throw new Error("A completed row cannot be classified never dispatched");
    return [{ ordinal, groupId: row.groupId }];
  });
}

export function makeContinuationPlan(previousDirectory: string, output: string) {
  const directories: string[] = [], seenDirectories = new Set<string>();
  let cursor = resolve(previousDirectory);
  for (;;) {
    if (seenDirectories.has(cursor)) throw new Error("Continuation history cycle"); seenDirectories.add(cursor);
    directories.unshift(cursor);
    const step = read(join(cursor, "plan.json"));
    if (step.version === ORIGINAL_VERSION) break;
    if (!["goalspec-v5-never-dispatched-annotation-continuation-v1", VERSION].includes(step.version)) throw new Error("Unsupported continuation history");
    cursor = resolve(step.previousDirectory ?? step.original);
    if (directories.length > 8) throw new Error("Bounded continuation history exceeded");
  }
  const original = directories[0]!, originalPlan = read(join(original, "plan.json")), originalSummary = read(join(original, "summary.json"));
  if (originalPlan.version !== ORIGINAL_VERSION || originalPlan.count !== 100 || originalSummary.planned !== 100) throw new Error("Original frozen hundred required");
  const selected: Input[] = read(join(original, "selected-public-inputs.json"));
  if (selected.length !== 100 || originalPlan.selected.length !== 100) throw new Error("Original frozen hundred required");
  for (const [index, row] of selected.entries()) for (const [key, value] of Object.entries(originalPlan.selected[index]))
    if ((row as any)[key] !== value) throw new Error("Original selection changed");
  const history: { directory: string; parentId: string; planSha256: string; annotationsSha256: string; audit: ReturnType<typeof checkEventChain> }[] = [];
  const attempted = new Set<string>(), physical = new Set<string>(), inputs: Source[] = [];
  let previous: Result[] = [];
  for (const directory of directories) {
    const step = read(join(directory, "plan.json")), summary = read(join(directory, "summary.json"));
    const planSha256 = sha(readFileSync(join(directory, "plan.json"))), annotationSha = sha(readFileSync(join(directory, "annotations.jsonl")));
    if (summary.version !== step.version || summary.retained !== 100 || summary.planSha256 !== planSha256 || summary.outputSha256 !== annotationSha
      || resolve(step.output) !== directory || hash(read(join(directory, "selected-public-inputs.json"))) !== hash(selected))
      throw new Error("Every continuation must be closed and retain the frozen hundred");
    const current: Result[] = jsonl(join(directory, "annotations.jsonl"));
    if (previous.length) {
      if (step.originalPlanSha256 !== originalSummary.planSha256
        || hash(step.continuation) !== hash(neverDispatched(selected, previous, [...attempted]))) throw new Error("Historical continuation selection changed");
      if (sha(readFileSync(join(directory, "prior-annotations.jsonl"))) !== history.at(-1)!.annotationsSha256) throw new Error("Prior output history changed");
      for (const [ordinal, row] of previous.entries()) if (attempted.has(row.groupId) && canonical(current[ordinal]) !== canonical(row))
        throw new Error("A previously attempted row was changed by a continuation");
    }
    const eventAudit = checkEventChain(jsonl(join(directory, "provider-events.jsonl")), true);
    if (eventAudit.attemptedGroupIds.some(id => attempted.has(id))) throw new Error("A previously attempted checkpoint was called again");
    for (const id of eventAudit.physicalRequestIds) { if (physical.has(id)) throw new Error("Repeated original request ID"); physical.add(id); }
    eventAudit.attemptedGroupIds.forEach(id => attempted.add(id));
    neverDispatched(selected, current, [...attempted]);
    for (const entry of step.code as Source[]) if (sha(readFileSync(join(directory, "source", entry.path))) !== entry.sha256)
      throw new Error("Historical executable archive changed");
    history.push({ directory, parentId: `${step.version}:${planSha256}`, planSha256, annotationsSha256: annotationSha, audit: eventAudit });
    for (const name of ["plan.json", "summary.json", "provider-events.jsonl", "annotations.jsonl", "selected-public-inputs.json",
      ...(previous.length ? ["prior-annotations.jsonl", "continuation-annotations.jsonl"] : [])])
      inputs.push({ path: join(directory, name), sha256: sha(readFileSync(join(directory, name))) });
    previous = current;
  }
  const audit = { attemptedGroupIds: [...attempted], knownCostMicrodollars: history.reduce((sum, entry) => sum + entry.audit.knownCostMicrodollars, 0),
    unknownMaximumMicrodollars: history.reduce((sum, entry) => sum + entry.audit.unknownMaximumMicrodollars, 0),
    uncertainRequests: history.flatMap(entry => entry.audit.uncertainRequests), physicalRequests: physical.size };
  const continuation = neverDispatched(selected, previous, [...attempted]);
  const maximumMicrodollars = continuation.length * PER_ROW;
  if (!continuation.length || maximumMicrodollars + audit.knownCostMicrodollars + audit.unknownMaximumMicrodollars > 18_000_000)
    throw new Error("Continuation exceeds original18USD pilot ceiling");
  if (existsSync(output) || dirname(resolve(output)) !== join(ROOT, "research/goalspec/runs")) throw new Error("New direct research output required");
  const code: Source[] = [...originalPlan.code, { path: "outputs/goalspec-v5-tools/annotation-continue.ts", sha256: sha(readFileSync(__filename)) }];
  for (const source of originalPlan.code as Source[]) {
    if (sha(readFileSync(resolve(ROOT, source.path))) !== source.sha256
      || sha(readFileSync(join(original, "source", source.path))) !== source.sha256) throw new Error("Original annotation dependency changed");
  }
  return { version: VERSION, original, previousDirectory: resolve(previousDirectory), output: resolve(output), originalPlanSha256: originalSummary.planSha256,
    originalParentId: `${ORIGINAL_VERSION}:${originalSummary.planSha256}`, originalCount: 100, inputs, code, history,
    originalLineageSources: [...originalPlan.inputs, ...originalPlan.lineageSources] as Source[], audit,
    continuation, retainedAttemptedOrdinals: selected.map((_, i) => i).filter(i => !continuation.some(row => row.ordinal === i)),
    maximumMicrodollars, maximumRequests: continuation.length * 3, allocation: "preparation" as const, concurrency: 2, retries: 0,
    reason: "Resume only original preselected rows with no physical provider attempt; preserve all previously attempted rows including incomplete failures",
    selection: "Original groupIDs, family splits, ordinals, public prefixes, prompts and model identities are unchanged",
    models: originalPlan.models, sourcePlan: originalPlan.inputPath };
}

export async function runContinuation(planPath: string, expectedSha: string, factory = researchProvider) {
  const bytes = readFileSync(planPath), plan: ReturnType<typeof makeContinuationPlan> = JSON.parse(bytes.toString("utf8"));
  if (sha(bytes) !== expectedSha || hash(plan) !== hash(makeContinuationPlan(plan.previousDirectory, plan.output))) throw new Error("Continuation plan changed");
  const verify = () => { for (const source of [...plan.inputs, ...plan.code, ...plan.originalLineageSources])
    if (sha(readFileSync(resolve(ROOT, source.path))) !== source.sha256) throw new Error("Frozen continuation input changed"); };
  verify();
  const selected: Input[] = read(join(plan.original, "selected-public-inputs.json")), prior: Result[] = jsonl(join(plan.previousDirectory, "annotations.jsonl"));
  const budget = join(ROOT, "research/goalspec/runs/local-evaluation-20260914/budget.jsonl");
  if (!existsSync(budget)) throw new Error("Existing shared budget required");
  const durable = new DurableBudget(budget);
  let log: ImmutableEventLog | undefined, reserved = false, requests = 0;
  const parent = `${VERSION}:${expectedSha}`, resumed = new Map<string, Result>();
  try {
    const entries = durable.ledger.snapshot();
    for (const step of plan.history) {
      const oldParent = entries.find(row => row.id === step.parentId), children = entries.filter(row => row.parentId === step.parentId);
      if (!oldParent || children.filter(row => row.actual !== undefined).reduce((sum, row) => sum + row.actual!, 0) !== step.audit.knownCostMicrodollars)
        throw new Error("Historical annotation ledger differs from known provider charges");
      const unknown = children.filter(row => row.actual === undefined);
      if (unknown.length !== step.audit.uncertainRequests.length || unknown.some(row => !step.audit.uncertainRequests.some(request =>
        row.id === `${step.parentId}/${request.id}` && row.maximum === request.maximumMicrodollars))) throw new Error("Unclassified historical reservation");
      if (!unknown.length && oldParent.actual !== step.audit.knownCostMicrodollars || unknown.length && oldParent.actual !== undefined)
        throw new Error("Historical unknown reservation must remain untouched");
    }
    for (const row of plan.continuation) if (entries.some(entry => entry.id.includes(`v5-annotation:${row.groupId}:`)))
      throw new Error("Never-dispatched request already has a budget reservation");
    mkdirSync(plan.output); write(join(plan.output, "plan.json"), plan);
    for (const source of plan.code) { const path = join(plan.output, "source", source.path); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, readFileSync(source.path), { flag: "wx" }); }
    write(join(plan.output, "selected-public-inputs.json"), selected);
    write(join(plan.output, "continuation-public-inputs.json"), plan.continuation.map(item => ({ ordinal: item.ordinal, row: selected[item.ordinal] })));
    writeFileSync(join(plan.output, "prior-annotations.jsonl"), readFileSync(join(plan.previousDirectory, "annotations.jsonl")), { flag: "wx" });
    durable.ledger.reserve(parent, "preparation", plan.maximumMicrodollars); reserved = true;
    log = new ImmutableEventLog(join(plan.output, "provider-events.jsonl"));
    const raw = factory(new TrialLedger(durable.ledger, parent, "preparation"), "preparation", event => log!.append(event)).model;
    const allowed = new Set(plan.continuation.map(row => row.groupId));
    const model: ModelPort = { complete: request => {
      const match = /^v5-annotation:([a-f0-9]{64}):(blind|prediction|agreement)$/.exec(request.id);
      if (!match || !allowed.has(match[1]!) || request.retries !== 0 || request.allocation !== "preparation"
        || ++requests > plan.maximumRequests || ![RESEARCH_MODELS.goal, RESEARCH_MODELS.teacher].includes(request.model as typeof RESEARCH_MODELS.goal))
        throw new Error("Continuation request bound violated");
      // Recheck the small executable closure before each request; the large
      // immutable lineage/input closure is verified at setup and completion.
      for (const source of plan.code) if (sha(readFileSync(resolve(ROOT, source.path))) !== source.sha256)
        throw new Error("Frozen annotation executable changed");
      return raw.complete(request);
    } };
    for (let start = 0; start < plan.continuation.length; start += plan.concurrency) {
      const batch = await Promise.all(plan.continuation.slice(start, start + plan.concurrency).map(async item => {
        const row = selected[item.ordinal]!;
        try { return await annotateRow(row, model, event => appendFileSync(join(plan.output, "annotation-events.jsonl"), canonical({ groupId: row.groupId, event }) + "\n")); }
        catch { return { ...prior[item.ordinal]!, continuationContextFailure: true }; }
      }));
      for (const result of batch) {
        resumed.set(result.groupId, result);
        appendFileSync(join(plan.output, "continuation-annotations.jsonl"), canonical(result) + "\n");
        console.log(JSON.stringify({ completed: resumed.size, total: plan.continuation.length, annotation: result.annotation.status, prediction: result.prediction.status }));
      }
    }
    verify();
    const combined = prior.map(row => resumed.get(row.groupId) ?? row);
    for (const ordinal of plan.retainedAttemptedOrdinals) if (canonical(combined[ordinal]) !== canonical(prior[ordinal])) throw new Error("Attempted historical row changed");
    writeFileSync(join(plan.output, "annotations.jsonl"), combined.map(row => canonical(row) + "\n").join(""), { flag: "wx" });
    write(join(plan.output, "summary.json"), { version: VERSION, originalCount: 100, retained: combined.length,
      originalAttemptedRowsRetained: plan.retainedAttemptedOrdinals.length, originallyNeverDispatched: plan.continuation.length, resumed: resumed.size,
      requests, predicted: combined.filter(row => row.goals).length, annotated: combined.filter(row => row.annotation.status === "completed").length,
      graded: combined.filter(row => row.agreement.status === "completed").length,
      agreementLabels: { yes: combined.filter(row => row.agreement.label === 1).length, no: combined.filter(row => row.agreement.label === 0).length,
        missing: combined.filter(row => row.agreement.label === null).length }, maximumMicrodollars: plan.maximumMicrodollars,
      originalKnownCostMicrodollars: plan.audit.knownCostMicrodollars, originalUnknownMaximumMicrodollars: plan.audit.unknownMaximumMicrodollars,
      previousDirectory: plan.previousDirectory, historyDirectories: plan.history.map(step => step.directory),
      outputSha256: sha(readFileSync(join(plan.output, "annotations.jsonl"))),
      planSha256: expectedSha, originalPlanSha256: plan.originalPlanSha256, historyPreserved: true, heldoutClaim: false, annotationTruthClaim: false });
  } finally { if (reserved) durable.ledger.finishParent(parent); log?.close(); durable.close(); }
}

async function main() {
  const [mode, first, second, third] = process.argv.slice(2);
  if (mode === "plan") { const plan = makeContinuationPlan(first!, second!); write(third!, plan);
    console.log(JSON.stringify({ path: third, sha256: sha(readFileSync(third!)), continuationRows: plan.continuation.length,
      attemptedRowsPreserved: plan.retainedAttemptedOrdinals.length, maximumUsd: plan.maximumMicrodollars / 1e6 })); }
  else if (mode === "run") await runContinuation(first!, second!);
  else throw new Error("Use plan ORIGINAL_DIRECTORY NEW_OUTPUT PLAN_FILE or run PLAN_FILE SHA256");
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
