import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DurableBudget } from "../../../../services/goalspec-runtime/durable-budget";
import { ImmutableEventLog } from "../../../../services/goalspec-runtime/artifacts";
import { maximumCost, researchProvider } from "../../../../services/goalspec-runtime/provider";
import { canonical, hash } from "../../../../src/lib/goalspec/canonical";
import { RESEARCH_MODELS, type ModelRequest, type ModelResult } from "../../../../src/lib/goalspec/model";
import { countTokens } from "../../../../src/lib/goalspec/tokens";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
type Source = { path: string; sha256: string };
type ProbeCase = {
  schemaVersion: string; id: string; sourceRunId: string; expectedStop: boolean;
  classification: string; sourceOutcomeSuccess: boolean; sourceRecord: Source;
  basePolicy: string; basePolicyHash: string; policyHash: string; protocol: string;
  boundary: { policy: string; messages: { role: string; content: string }[]; tools: unknown[] };
  boundaryHash: string;
};
type Manifest = {
  schemaVersion: string; caseCount: number; expectedContinue: number; expectedStop: number;
  casesSha256: string; casesHash: string; guidance: string; guidanceHash: string;
  helperSource: string; helperSourceHash: string; sourceInputs: Source[];
  request: { model: string; allocation: string; maxOutputTokens: number; nativeInputCap: number;
    nativeInputMargin: number; retries: number; concurrency: number };
};

function verifySource(source: Source) {
  const path = resolve(ROOT, source.path), rel = relative(ROOT, path);
  if (!rel || rel.startsWith("..") || resolve(source.path) === source.path || sha(path) !== source.sha256) {
    throw new Error("Probe source path or hash mismatch");
  }
}

export function compileProbeCase(row: ProbeCase): ModelRequest {
  const boundary = row.boundary;
  // Match the native user worker guard and payload exactly, including its 128-token margin.
  if (boundary.tools.length || countTokens(canonical(boundary)) > 8192 - 128) {
    throw new Error("User context budget or tool contract violated");
  }
  return { id: `${row.id}:user`, model: RESEARCH_MODELS.user,
    input: boundary.messages.map(m => ({ role: m.role === "assistant" ? "assistant" as const : "user" as const,
      content: m.content ?? "" })), instructions: boundary.policy, maxOutputTokens: 1024,
    allocation: "development", maximumAttemptMicrodollars: maximumCost(RESEARCH_MODELS.user, 8192, 1024), retries: 0 };
}

export function loadProbe(casesArgument: string) {
  const path = resolve(casesArgument);
  const manifest = JSON.parse(readFileSync(join(dirname(path), "manifest.json"), "utf8")) as Manifest;
  const rows = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) as ProbeCase[];
  const expectedRequest = { model: RESEARCH_MODELS.user, allocation: "development", maxOutputTokens: 1024,
    nativeInputCap: 8192, nativeInputMargin: 128, retries: 0, concurrency: 1 };
  if (manifest.schemaVersion !== "user-stop-probe-v1" || manifest.caseCount !== 6
    || manifest.expectedContinue !== 4 || manifest.expectedStop !== 2 || rows.length !== 6
    || manifest.casesSha256 !== sha(path) || manifest.casesHash !== hash(rows)
    || manifest.guidanceHash !== hash(manifest.guidance) || manifest.helperSourceHash !== hash(manifest.helperSource)
    || hash(manifest.request) !== hash(expectedRequest)
    || new Set(rows.map(row => row.id)).size !== 6 || new Set(rows.map(row => row.sourceRunId)).size !== 6
    || rows.filter(row => row.expectedStop === false).length !== 4 || rows.filter(row => row.expectedStop === true).length !== 2) {
    throw new Error("Probe manifest or fixed six-case selection mismatch");
  }
  manifest.sourceInputs.forEach(verifySource);
  for (const row of rows) {
    verifySource(row.sourceRecord);
    if (row.schemaVersion !== "user-stop-probe-v1" || !/^v2-user-stop-probe:[0-5]:[a-f0-9]{24}$/.test(row.id)
      || !row.sourceRunId.startsWith("v2-df424bd6f3-development-2-")
      || row.protocol !== "v2-user-completion-guidance-v1" || row.sourceOutcomeSuccess !== row.expectedStop
      || row.classification !== (row.expectedStop ? "completed_task_control" : "confirmation_must_continue")
      || row.basePolicyHash !== hash(row.basePolicy) || row.policyHash !== hash(row.boundary.policy)
      || row.boundaryHash !== hash(row.boundary) || row.boundary.policy !== row.basePolicy + "\n\n" + manifest.guidance
      || !Array.isArray(row.boundary.messages) || !row.boundary.messages.length
      || row.boundary.messages.some(m => !["assistant", "user"].includes(m.role) || typeof m.content !== "string")
      || row.boundary.messages.at(-1)?.role !== "user") throw new Error("Probe case provenance or user state mismatch");
  }
  const requests = rows.map(compileProbeCase);
  return { rows, requests, manifest, casesPath: path };
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", encoding: "utf8" });
}

async function main() {
  const [mode, casesArgument, budgetArgument, outputArgument] = process.argv.slice(2);
  if (!["validate", "run"].includes(mode) || !casesArgument || mode === "run" && (!budgetArgument || !outputArgument)) {
    throw new Error("Usage: run_user_stop_probe.ts validate CASES | run CASES EXISTING_BUDGET_DIRECTORY NEW_OUTPUT");
  }
  const prepared = loadProbe(casesArgument);
  const validation = { cases: prepared.rows.length, expectedContinue: 4, expectedStop: 2,
    casesHash: prepared.manifest.casesHash, nativeBoundaryTokens: prepared.rows.map(r => countTokens(canonical(r.boundary))),
    maximumReservedMicrodollars: prepared.requests.reduce((sum, r) => sum + r.maximumAttemptMicrodollars, 0),
    model: RESEARCH_MODELS.user, allocation: "development", concurrency: 1, retries: 0 };
  if (mode === "validate") { console.log(JSON.stringify({ ...validation, providerCalls: 0 })); return; }
  const budgetPath = join(resolve(budgetArgument), "budget.jsonl");
  if (!existsSync(budgetPath)) throw new Error("Existing shared budget journal is required");
  const output = resolve(outputArgument);
  if (output === dirname(prepared.casesPath) || !relative(ROOT, output) || relative(ROOT, output).startsWith("..")) {
    throw new Error("Expected a new output subdirectory within the repository");
  }
  mkdirSync(output, { recursive: false });
  writeJson(join(output, "dispatch-manifest.json"), { ...validation, casesPath: prepared.casesPath,
    casesSha256: sha(prepared.casesPath), runnerSha256: sha(fileURLToPath(import.meta.url)),
    interpretation: "Six archived development user-turn probes. Not a native cohort or native success score." });
  const budget = new DurableBudget(budgetPath);
  const events = new ImmutableEventLog(join(output, "events.jsonl"));
  const progress = new ImmutableEventLog(join(output, "progress.jsonl"));
  let knownMicrodollars = 0, failedProviderAttempts = 0;
  const results: Record<string, unknown>[] = [];
  try {
    const provider = researchProvider(budget.ledger, "development", event => {
      events.append(event);
      const e = event as Record<string, unknown>;
      if (e.type === "model_attempt" && Number.isSafeInteger(e.costMicrodollars)) knownMicrodollars += e.costMicrodollars as number;
      if (e.type === "model_attempt_failed") failedProviderAttempts++;
    });
    for (let i = 0; i < prepared.rows.length; i++) {
      const row = prepared.rows[i], request = prepared.requests[i];
      let fullResponse: ModelResult | undefined;
      let result: Record<string, unknown>;
      try {
        fullResponse = await provider.model.complete(request);
        if (fullResponse.calls.length || fullResponse.refusals.length) throw new Error("Invalid user simulator response");
        const containsStop = fullResponse.text.includes("###STOP###");
        const containsOtherTerminal = ["###TRANSFER###", "###OUT-OF-SCOPE###"].some(marker => fullResponse!.text.includes(marker));
        result = { id: row.id, sourceRunId: row.sourceRunId, status: "completed", expectedStop: row.expectedStop,
          containsStop, containsOtherTerminal,
          promptExpectationMet: row.expectedStop ? containsStop && !containsOtherTerminal : !containsStop && !containsOtherTerminal,
          userMessage: { role: "user", content: fullResponse.text, usage: fullResponse.usage }, fullResponse };
      } catch (error) {
        result = { id: row.id, sourceRunId: row.sourceRunId, status: "failed", expectedStop: row.expectedStop,
          promptExpectationMet: false, errorType: error instanceof Error ? error.constructor.name : "Error",
          ...(fullResponse ? { fullResponse } : {}) };
      }
      result.boundaryHash = row.boundaryHash;
      result.requestHash = hash(request);
      results.push(result);
      progress.append({ position: i, result });
      console.log(JSON.stringify({ completed: results.length, total: 6, status: result.status,
        promptExpectationMet: result.promptExpectationMet }));
    }
    writeFileSync(join(output, "results.jsonl"), results.map(r => JSON.stringify(r)).join("\n") + "\n", { flag: "wx", encoding: "utf8" });
    const report = { ...validation, completed: results.filter(r => r.status === "completed").length,
      failed: results.filter(r => r.status === "failed").length,
      promptExpectationsMet: results.filter(r => r.promptExpectationMet === true).length,
      knownUsageMicrodollars: knownMicrodollars, unknownProviderAttempts: failedProviderAttempts,
      isNativeCohort: false, originalOutcomesUnchanged: true, noRetriesOrSubstitutions: true,
      interpretation: "Expected termination-marker behavior on six selected archived development turns; not native task success or heldout evidence." };
    writeJson(join(output, "report.json"), report);
    console.log(JSON.stringify(report));
  } finally { progress.close(); events.close(); budget.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(JSON.stringify({ failed: true, errorType: error instanceof Error ? error.constructor.name : "Error" })); process.exitCode = 1; });
}
