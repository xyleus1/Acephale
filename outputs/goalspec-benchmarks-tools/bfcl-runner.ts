import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { canonical, hash } from "../../src/lib/goalspec/canonical";
import { RESEARCH_MODELS, providerFailure, type ModelRequest, type ModelResult } from "../../src/lib/goalspec/model";
import { countTokens } from "../../src/lib/goalspec/predictors";
import { DurableBudget } from "../../services/goalspec-runtime/durable-budget";
import { ImmutableEventLog } from "../../services/goalspec-runtime/artifacts";
import { maximumCost, researchProvider, TrialLedger } from "../../services/goalspec-runtime/provider";
import { orderedConcurrentMap } from "../../scripts/goalspec-replay-concurrency";

const ROOT = resolve("."), DATASET = join(ROOT, "research/goalspec/runs/local-bfcl-v4-dataset-20260916");
const LEDGER = join(ROOT, "research/goalspec/runs/local-evaluation-20260914/budget.jsonl");
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const write = (path: string, value: unknown) => writeFileSync(path, canonical(value) + "\n", { flag: "wx" });
const SOURCE = ["outputs/goalspec-benchmarks-tools/bfcl-runner.ts", "outputs/goalspec-benchmarks-tools/bfcl_subset.py",
  "package.json", "package-lock.json", "scripts/goalspec-replay-concurrency.ts",
  ...["provider", "durable-budget", "artifacts"].map(name => `services/goalspec-runtime/${name}.ts`),
  ...["model", "budget", "canonical", "predictors", "tokens", "compiler", "evidence-sources", "compact-goals", "compact-candidates", "patterns", "repository", "current-bindings", "experience-memory", "contracts/generated", "contracts/validate"].map(name => `src/lib/goalspec/${name}.ts`),
  "src/lib/goalspec/contracts/v1.schema.json"];
type Case = { id: string; category: string; input: ModelRequest["input"]; tools: ModelRequest["tools"] };

export function compileCase(row: Case): ModelRequest {
  const serialized = canonical({ instructions: "", input: row.input, tools: row.tools });
  if (countTokens(serialized) > 32768 - 128) throw new Error("BFCL mandatory input exceeds actor budget");
  // UTF-8 byte count plus framing allowance conservatively bounds input tokens.
  const upper = Buffer.byteLength(serialized, "utf8") + 2048;
  if (upper > 32768) throw new Error("BFCL token-cost upper bound exceeds predeclared cap");
  return { id: `bfcl-v4:${row.id}`, model: RESEARCH_MODELS.actor, reasoning: "medium", instructions: "",
    input: row.input, tools: row.tools, maxOutputTokens: 4096, allocation: "replay",
    maximumAttemptMicrodollars: maximumCost(RESEARCH_MODELS.actor, upper, 4096), retries: 1,
    retryableCauseCodes: ["UND_ERR_SOCKET"] };
}

export function makePlan(output: string) {
  if (existsSync(output) || dirname(resolve(output)) !== join(ROOT, "research/goalspec/runs")) throw new Error("New direct run directory required");
  const manifestPath = join(DATASET, "dataset-manifest.json"), casePath = join(DATASET, "public-cases.json");
  const manifest = read(manifestPath), cases: Case[] = read(casePath).entries;
  if (cases.length !== 64 || new Set(cases.map(row => row.id)).size !== cases.length || sha(readFileSync(casePath)) !== manifest.publicCasesSha256) throw new Error("Frozen BFCL cohort changed");
  for (const file of manifest.sources) if (sha(readFileSync(file.path)) !== file.sha256) throw new Error("Pinned BFCL source changed");
  const requests = cases.map(compileCase);
  const maximumMicrodollars = requests.reduce((total, row) => total + row.maximumAttemptMicrodollars * (row.retries + 1), 0);
  if (maximumMicrodollars > 19_000_000) throw new Error("BFCL phase exceeds remaining replay allowance");
  return { version: "goalspec-bfcl-component-v1", output: resolve(output), dataset: DATASET, allocation: "replay", concurrency: 4,
    label: manifest.label, caseIds: cases.map(row => row.id), requestsHash: hash(requests), maximumMicrodollars,
    inputs: [{ path: manifestPath, sha256: sha(readFileSync(manifestPath)) }, { path: casePath, sha256: sha(readFileSync(casePath)) }],
    code: SOURCE.map(path => ({ path, sha256: sha(readFileSync(path)) })),
    noToolExecution: true, goalSpecBehaviorClaim: false, retries: "One pre-reserved UND_ERR_SOCKET retry, no completed-case replacement" };
}

export async function dispatch(path: string, expected: string, factory = researchProvider) {
  const bytes = readFileSync(path), plan = read(path) as ReturnType<typeof makePlan>;
  if (sha(bytes) !== expected || hash(makePlan(plan.output)) !== hash(plan) || !existsSync(LEDGER)) throw new Error("Exact immutable plan and existing ledger required");
  mkdirSync(plan.output);
  write(join(plan.output, "dispatch-plan.json"), plan);
  for (const source of plan.code) {
    const destination = join(plan.output, "source", source.path), captured = readFileSync(source.path);
    if (sha(captured) !== source.sha256) throw new Error("Source changed during capture");
    mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, captured, { flag: "wx" });
  }
  const cases: Case[] = read(join(DATASET, "public-cases.json")).entries;
  const durable = new DurableBudget(LEDGER), parent = `bfcl-component:${expected}`;
  const events = new ImmutableEventLog(join(plan.output, "provider-events.jsonl"));
  const started = performance.now(), rows: any[] = [], attemptEvents: any[] = [];
  let reserved = false;
  try {
    durable.ledger.reserve(parent, "replay", plan.maximumMicrodollars); reserved = true;
    const scoped = new TrialLedger(durable.ledger, parent, "replay");
    const model = factory(scoped, "replay", event => { events.append(event); attemptEvents.push(event); }).model;
    await orderedConcurrentMap(cases, plan.concurrency, async row => {
      const request = compileCase(row), begin = performance.now();
      let result: ModelResult | null = null, error: unknown = null;
      try {
        result = await model.complete(request);
        if (result.status !== "completed" || result.refusals.length) throw new Error("Refused or incomplete BFCL prediction");
      } catch (failure) { error = providerFailure(failure); }
      const record = { id: row.id, category: row.category, status: error ? "failed" : "completed", result, error,
        inputHash: hash({ input: request.input, tools: request.tools, instructions: request.instructions }),
        maximumMicrodollars: request.maximumAttemptMicrodollars * (request.retries + 1), latencyMs: performance.now() - begin };
      rows.push(record); appendFileSync(join(plan.output, "predictions.jsonl"), canonical(record) + "\n");
      process.stdout.write(JSON.stringify({ benchmark: "BFCL-component", completed: rows.length, total: cases.length, status: record.status }) + "\n");
    });
    const ledgerRows = scoped.snapshot(), unknown = ledgerRows.filter(row => row.actual === undefined);
    write(join(plan.output, "summary.json"), { version: plan.version, closed: rows.length === cases.length, declared: cases.length,
      completed: rows.filter(row => row.status === "completed").length, failed: rows.filter(row => row.status !== "completed").length,
      model: RESEARCH_MODELS.actor, reasoning: "medium", maxOutputTokens: 4096, concurrency: plan.concurrency,
      totalDispatchSeconds: (performance.now() - started) / 1000, startupExcludedFromDispatch: true,
      knownResponseUsageUsd: attemptEvents.filter(event => event.type === "model_attempt").reduce((n, event) => n + event.costMicrodollars, 0) / 1e6,
      settledLogicalRequestUsageUsd: ledgerRows.reduce((n, row) => n + (row.actual ?? 0), 0) / 1e6,
      unresolvedLogicalRequests: unknown.length, maximumReservedUsd: plan.maximumMicrodollars / 1e6,
      requests: ledgerRows.length, providerAttempts: attemptEvents.filter(event => ["model_attempt", "model_attempt_failed"].includes(event.type)).length,
      noToolExecution: true, goalSpecBehaviorClaim: false });
  } finally {
    if (reserved) durable.ledger.finishParent(parent);
    events.close(); durable.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, path, extra] = process.argv.slice(2);
  if (mode === "plan") { const plan = makePlan(path); write(extra, plan); console.log(JSON.stringify({ plan: extra, sha256: sha(readFileSync(extra)), maximumUsd: plan.maximumMicrodollars / 1e6, cases: plan.caseIds.length })); }
  else if (mode === "run") void dispatch(path, extra).catch(error => { console.error(JSON.stringify(providerFailure(error))); process.exitCode = 1; });
  else throw new Error("Use plan OUTPUT PLAN or run PLAN SHA");
}
