import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hash } from "../../src/lib/goalspec/canonical";
import { NativeGateway, NativeReadExecutor } from "../../services/goalspec-runtime/gateway-client";
import { NativeReadPolicy } from "../../services/goalspec-runtime/native-read-policy";
import { nativeCandidateGraphV5 } from "../../services/goalspec-runtime/native-candidate-graph";
import { compileActorInput } from "../../services/goalspec-runtime/actor";
import { publicPrefixSources, publicReplayMessages } from "../../scripts/goalspec-prediction-v3";
import { LocalControllerV5, buildSpeculationContext } from "../../src/lib/goalspec/controller-v5";
import { buildObligationLedger, obligationLedgerContext } from "../../src/lib/goalspec/obligation-ledger";
import { SpeculationScheduler, SpeculativeCapacity } from "../../src/lib/goalspec/scheduler";
import type { Candidate, ExecutionFrame } from "../../src/lib/goalspec/contracts/generated";

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const plan = JSON.parse(input), gateway = new NativeGateway(plan.url, plan.token);
  const controller = new LocalControllerV5(JSON.parse(readFileSync(plan.controllerPath, "utf8")));
  const samples: Record<string, unknown>[] = [];
  for (const item of plan.cases) {
    const prefix = publicReplayMessages(item.prefix);
    const scope = { tenantId: `custom-tau-${item.domain}`, principalId: "native-actor", authorizationVersion: "native-v1",
      environmentVersion: "2174a603f6d014ef94473ffa95957f6ce27100db", toolSchemaHash: hash(item.tools) };
    const frame: ExecutionFrame = { schemaVersion: 1, runId: item.id, boundary: 0, scope,
      requestedObjective: prefix.filter(row => row.role === "user").map(row => row.content ?? "").join("\n"),
      policy: item.policy, sources: publicPrefixSources(prefix), snapshotId: plan.snapshotId,
      goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash({}) } };
    const tools = Object.fromEntries(item.tools.filter((tool: any) => plan.allowed[item.domain].includes(tool.function.name))
      .map((tool: any) => [tool.function.name, tool.function.parameters]));
    const invocation = { tool: item.tool, arguments: item.arguments, scope };
    for (let repeat = -1; repeat < plan.repetitions; repeat++) {
      const policy = new NativeReadPolicy(item.domain, scope);
      policy.updateFrame(frame);
      if (!policy.eligible(invocation)) {
        if (repeat >= 0) samples.push({ id: item.id, familyId: item.familyId, domain: item.domain, tool: item.tool, repeat,
          policyEligible: false, status: "policy_rejected_before_dispatch", gatewayReadMs: null, gatewayRefreshMs: null,
          schedulerTotalMs: null, schedulerOverheadMs: null, diagnosticConsumeRpcMs: null, localGraphControllerMs: null,
          controllerOnlyMs: null, poolSize: null, literalContextMs: null, actorCompilerMs: null, actorInputTokens: null });
        continue;
      }
      const readExecutor = new NativeReadExecutor(gateway, item.id, scope, new Set<string>(plan.allowed[item.domain]), policy);
      readExecutor.updateFrame(frame);
      const component: Record<string, number> = {};
      const executor = { eligible: (i: any) => readExecutor.eligible(i),
        read: async (i: any, signal: AbortSignal) => { const at = performance.now(); try { return await readExecutor.read(i, signal); }
          finally { component.gatewayReadMs = performance.now() - at; } },
        validate: async (i: any, previous: any, signal: AbortSignal) => { const at = performance.now(); try { return await readExecutor.validate(i, previous, signal); }
          finally { component.gatewayRefreshMs = performance.now() - at; } } };
      const events: any[] = [], scheduler = new SpeculationScheduler(item.id, executor, event => events.push(event), new SpeculativeCapacity(4));
      const candidate: Candidate = { schemaVersion: 1, id: hash(invocation), invocation, probability: 1, hop: 1, patternId: null, bindings: [] };
      const started = performance.now();
      assert.equal(scheduler.admit([candidate]).length, 1);
      const observation = await scheduler.authoritative(invocation, async () => { throw new Error("Unexpected native fallback"); });
      const schedulerTotalMs = performance.now() - started;
      const lease = readExecutor.takeLease(invocation);
      assert.ok(lease);
      // Extra RPC isolates transport cost; real native consumption is measured
      // locally in Python and does not require this diagnostic validation RPC.
      const validationStarted = performance.now();
      const consumed = await gateway.request<any>("/validate", { runId: item.id, lease, tool: item.tool, arguments: item.arguments });
      const diagnosticConsumeRpcMs = performance.now() - validationStarted;
      assert.equal(consumed.error, false);
      let decoded: unknown;
      try { decoded = JSON.parse(consumed.content); } catch { decoded = consumed.content; }
      assert.deepEqual(observation, decoded);
      assert.deepEqual(consumed, item.observation);
      assert.equal(events.filter(event => event.type === "useful").length, 1);
      await scheduler.close();
      const predictedAt = performance.now();
      const pool = nativeCandidateGraphV5(frame, tools, () => true);
      const decision = controller.decide(buildSpeculationContext(frame), pool, { goalConditioning: false });
      const localGraphControllerMs = performance.now() - predictedAt;
      const contextAt = performance.now();
      const context = obligationLedgerContext(buildObligationLedger(frame));
      const literalContextMs = performance.now() - contextAt;
      const compilerAt = performance.now();
      const compiled = compileActorInput({ messages: item.prefix, policy: item.policy, tools: item.tools }, context, 32640, "current-only");
      const actorCompilerMs = performance.now() - compilerAt;
      if (repeat >= 0) samples.push({ id: item.id, familyId: item.familyId, domain: item.domain, tool: item.tool, repeat,
        ...component, schedulerTotalMs, schedulerOverheadMs: Math.max(0, schedulerTotalMs - component.gatewayReadMs! - component.gatewayRefreshMs!),
        diagnosticConsumeRpcMs, localGraphControllerMs, controllerOnlyMs: decision.elapsedMs, poolSize: pool.length,
        literalContextMs, actorCompilerMs, actorInputTokens: compiled.metadata.tokens, observationEqual: true, policyEligible: true });
    }
  }
  process.stdout.write(JSON.stringify({ version: "native-component-profile-node-v5", samples, providerCalls: 0, allEligibleMatchingPromotions: true }) + "\n");
}
void main().catch(error => { process.stderr.write(String(error.stack ?? error) + "\n"); process.exitCode = 1; });
