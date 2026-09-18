import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import { coldDeryaController, deryaLiveCandidates, exactDeryaAnswer, runDeryaTask, dispatchDeryaLive, deryaFailureType, DERYA_LIVE_ARMS, DERYA_LIVE_SCHEMAS } from "./goalspec-derya-v5-live";
import { LocalControllerV5, buildSpeculationContext } from "../src/lib/goalspec/controller-v5";
import { hash } from "../src/lib/goalspec/canonical";
import type { ExecutionFrame } from "../src/lib/goalspec/contracts/generated";
import { maximumCost } from "../services/goalspec-runtime/provider";
import { RESEARCH_MODELS, type ModelPort, type ModelResult } from "../src/lib/goalspec/model";
const frame = (request: string): ExecutionFrame => ({ schemaVersion: 1, runId: "unit", scope: { tenantId: "office", principalId: "operator", authorizationVersion: "auth", environmentVersion: "test", toolSchemaHash: hash(DERYA_LIVE_SCHEMAS) }, snapshotId: "empty", boundary: 0,
  requestedObjective: request, policy: "Read only", sources: { "requirement:0": request, _binding_events: [] }, goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash([]) } });
test("deterministic read candidates use only typed public request bindings, never private truth", () => {
  const input = frame('Read job_id="job_current" with limit=3.');
  input.sources.private_truth = { job_id: "future_forbidden" };
  const candidates = deryaLiveCandidates(input);
  assert.equal(candidates.length, 5);
  assert.equal(candidates.find(c => c.invocation.tool === "get_job")!.invocation.arguments.job_id, "job_current");
  assert(candidates.every(candidate => candidate.bindings.every(ref => ref.sourceId === "requirement:0")));
  assert(!JSON.stringify(candidates).includes("future_forbidden"));
  assert(!deryaLiveCandidates(frame("My job id and other details are unknown.")).some(c => c.invocation.tool === "get_job"));
  assert.equal(deryaLiveCandidates(frame('Search q="known literal" with limit=3')).find(c => c.invocation.tool === "search_jobs")!.invocation.arguments.q, "known literal");
});
test("exact read-task verifier preserves string values and order and rejects malformed/extra fields", () => {
  assert(exactDeryaAnswer('{"values":["first","second"]}', ["first", "second"]));
  for (const answer of ['{"values":["second","first"]}', '{"values":[1]}', '{"values":["first","second"],"extra":true}', '```json\n{"values":[]}\n```', 'null']) {
    assert(!exactDeryaAnswer(answer, ["first", "second"]));
  }
  assert(exactDeryaAnswer('{"values":[]}', []));
});
test("cold business prior is uniform and uncalibrated with no native weights or fabricated training records", () => {
  const artifact = coldDeryaController();
  assert(artifact.neutralWeights.every(value => value === 0)); assert(artifact.goalWeights.every(value => value === 0));
  assert.deepEqual(artifact.lineage.sources, []); assert.equal(artifact.calibration.reliability.status, "unavailable");
  const current = frame('Read job_id="current".');
  const controller = new LocalControllerV5(artifact), candidates = deryaLiveCandidates(current);
  const neutral = controller.decide(buildSpeculationContext(current), candidates, { goalConditioning: false });
  const goal = controller.decide(buildSpeculationContext(current), candidates, { goalConditioning: true });
  assert.deepEqual(neutral.rankedCandidateIds, goal.rankedCandidateIds);
  assert(goal.candidates.every(row => row.goalCorrection === 0));
});
test("complete paired allowance covers maximum actor and predictor attempts", () => {
  const maximum = 2 * 2 * maximumCost(RESEARCH_MODELS.actor, 32768, 4096) + 2 * 2 * maximumCost(RESEARCH_MODELS.goal, 8192, 1024);
  assert(maximum < 750000); assert.equal(12 * DERYA_LIVE_ARMS.length * 750000, 27000000);
  assert.deepEqual(Object.keys(DERYA_LIVE_SCHEMAS).sort(), ["get_job", "list_open_inquiries", "search_companies", "search_inquiries", "search_jobs"]);
});
test("startup source failure retains every paired slot and never logs the error message", async () => {
  const directory = mkdtempSync(join(tmpdir(), "goalspec-derya-live-v5-"));
  try {
    assert.equal(deryaFailureType(new Error("postgresql://private:do-not-log@host/db")), "Error");
    const tasks = Array.from({ length: 12 }, (_, index) => ({ taskId: `task-${index}`, familyId: `family-${index}` }));
    const body = { version: "derya-live-read-v5.1", studyId: "synthetic", actor: RESEARCH_MODELS.actor, goal: RESEARCH_MODELS.goal,
      actorContext: "hypotheses", epochMode: "off", allowanceMicrodollars: 750000, tasks,
      trials: tasks.flatMap(task => DERYA_LIVE_ARMS.map(arm => ({ runId: `${task.taskId}-${arm}`, taskId: task.taskId, arm }))),
      sources: [{ path: join(directory, "missing-private-database-url"), sha256: "a".repeat(64) }] };
    const planPath = join(directory, "plan.json"), output = join(directory, "output");
    writeFileSync(planPath, JSON.stringify({ ...body, hash: hash(body) }));
    await assert.rejects(dispatchDeryaLive(planPath, output), /complete declared slots retained/);
    const summary = JSON.parse(readFileSync(join(output, "summary.json"), "utf8"));
    assert.equal(summary.trials.length, 36); assert(summary.trials.every((row: { success: boolean; notExecuted: boolean }) => !row.success && row.notExecuted));
    assert.equal(summary.integrityPassed, false); assert(!JSON.stringify(summary).includes("missing-private-database-url"));
  } finally {
    assert.equal(dirname(directory), resolve(tmpdir())); assert(basename(directory).startsWith("goalspec-derya-live-v5-"));
    rmSync(directory, { recursive: true });
  }
});
test("actual read loop preserves real call IDs and current-only goal context across all arms without a provider", { skip: !process.env.GOALSPEC_EPOCH_TEST_DATABASE_URL }, async () => {
  const fixture = JSON.parse(readFileSync("research/goalspec/runs/local-v5-derya-profile-20260916/fixtures.jsonl", "utf8").split(/\r?\n/)[0]);
  const request = `Read job_id="${fixture.ids.Job}" and return document id values.`;
  const usage = { input_tokens: 0, input_tokens_details: { cached_tokens: 0 }, output_tokens: 0, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 0 };
  for (const arm of DERYA_LIVE_ARMS) {
    let actorCalls = 0; const instructions: string[] = [];
    const model: ModelPort = { complete: async input => {
      const base: ModelResult = { model: input.model, continuation: [], calls: [], text: "", status: "completed", refusals: [], usage };
      if (input.model === RESEARCH_MODELS.goal) return { ...base, text: '{"set_active_goals":[],"unknownWeight":1,"factDeltas":[]}' };
      instructions.push(input.instructions);
      if (actorCalls++ === 0) {
        const args = { job_id: fixture.ids.Job };
        return { ...base, calls: [{ id: "real-fixture-call", name: "get_job", arguments: args }], continuation: [{ type: "function_call", call_id: "real-fixture-call", name: "get_job", arguments: JSON.stringify(args) }] };
      }
      const observation = input.input.find(item => item.type === "function_call_output");
      assert(observation && observation.type === "function_call_output"); assert.equal(observation.call_id, "real-fixture-call");
      assert.equal(typeof observation.output, "string");
      const parsed = JSON.parse(observation.output as string);
      return { ...base, text: JSON.stringify({ values: parsed.result.documents.map((document: { id: string }) => document.id) }) };
    } };
    const task = { taskId: "fixture", familyId: "fixture", request, scope: { ...fixture.invocation.scope, toolSchemaHash: hash(DERYA_LIVE_SCHEMAS) }, principal: fixture.principal };
    const result = await runDeryaTask(task, arm, model, () => {}, { coldController: coldDeryaController(), estimate: { toolMs: 10, validationMs: 10, schedulingMs: 1, predictionMs: 0, contentionMs: 0, contextMs: 0, measuredExposureBenefitMs: 0 } }, `no-provider-${arm}`);
    assert.equal(result.failure, null); assert.equal(result.completed, true); assert.equal(result.actorRequests, 2);
    assert.equal(result.authoritativeReads, 1); assert.equal(result.speculativeReads, 0); assert.equal(result.revalidationCalls, 0);
    assert(result.physicalSqlStatements > 1); assert.equal(instructions.length, 2);
    if (arm === "goal54") assert(instructions[0].includes(JSON.stringify(request)));
    else assert(!instructions[0].includes(fixture.ids.Job));
  }
});
