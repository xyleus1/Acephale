import type { GoalSpecSession } from "../goalspec/session";
import type { EvidenceEnvelope, ExecutionFrame } from "../goalspec/contracts/generated";
import { copy, hash } from "../goalspec/canonical";
import { addEvidenceSources } from "../goalspec/evidence-sources";
import { DERYA_READ_TOOLS } from "./derya-read-executor";
import type { BindingEvent } from "../goalspec/patterns";

export type ChatIdentity = { userId: string; officeId: string; accessKind?: string; canViewWholeOffice: boolean };
export type DeryaManagedRuntime = Pick<GoalSpecSession, "boundary" | "scheduler" | "close" | "settlePredictions"> & { actorContextMode?: "legacy" | "current-only" };
export type DeryaRuntimeFactory = (identity: ChatIdentity) => Promise<{ runtime: DeryaManagedRuntime; frame: ExecutionFrame } | undefined>;
let factory: DeryaRuntimeFactory | undefined;

// Server bootstrap supplies a tested repository, predictors and audited executor.
// No user-controlled mode or authorization is accepted through chat arguments.
export function installDeryaGoalSpec(value: DeryaRuntimeFactory) {
  factory = value;
  return () => { if (factory === value) factory = undefined; };
}

export async function createDeryaChatRuntime(identity: ChatIdentity, request: string, policy: string) {
  if (!factory || identity.accessKind !== "operator" || !identity.canViewWholeOffice) return;
  const configured = await factory(identity);
  if (!configured) return;
  const { runtime } = configured;
  const frame = configured.frame;
  if (frame.scope.tenantId !== identity.officeId || frame.scope.principalId !== identity.userId) {
    await runtime.close(); throw new Error("Runtime identity mismatch");
  }
  frame.requestedObjective = request; frame.policy = policy;
  frame.sources = { ...frame.sources, current_user_request: request };
  let bindingEvents = copy(frame.sources._binding_events ?? []) as unknown as BindingEvent[];
  let signatures = copy(frame.sources._signatures ?? []) as string[];
  let observation: { context: string; evidence: EvidenceEnvelope[] } | undefined;
  return {
    actorContextMode: runtime.actorContextMode ?? "legacy",
    async boundary() {
      observation = undefined;
      frame.boundary++;
      const result = await runtime.boundary(frame, ["current_user_request"]);
      frame.goals = copy(result.frame.goals);
      // Carry actual verified reads forward as their own typed sources. These
      // are historical observations, never fabricated actor tool responses.
      if (!result.actorContext) return "";
      addEvidenceSources(frame, result.evidence);
      bindingEvents = copy(frame.sources._binding_events) as unknown as BindingEvent[];
      signatures = copy(frame.sources._signatures) as string[];
      const context = `[RUNTIME OBSERVATION AT BOUNDARY ${frame.boundary}]\n`
        + "This observation was verified at this boundary. When replayed later it is historical evidence, not fresh state or authorization. Revalidate before consequential action.\n"
        + result.actorContext;
      observation = { context, evidence: copy(result.evidence) };
      return context;
    },
    observation: () => observation ? copy(observation) : undefined,
    async batch<T>(calls: { id: string; name: string; input: Record<string, unknown> }[], execute: (index: number) => Promise<T>) {
      const allReads = calls.every(c => (DERYA_READ_TOOLS as readonly string[]).includes(c.name));
      const native = async () => {
        // A rejected sibling cannot release mutation suspension while another
        // physical action is still running. Preserve parallel dispatch/order.
        const settled = await Promise.allSettled(calls.map((_, index) => Promise.resolve().then(() => execute(index))));
        const failure = settled.find(result => result.status === "rejected");
        if (failure?.status === "rejected") throw failure.reason;
        return settled.map(result => (result as PromiseFulfilledResult<T>).value);
      };
      const results = allReads
        ? await Promise.all(calls.map((call, index) => runtime.scheduler.authoritative({ tool: call.name, arguments: JSON.parse(JSON.stringify(call.input)), scope: frame.scope }, async () => JSON.parse(JSON.stringify(await execute(index)))))) as T[]
        : await runtime.scheduler.mutationBatch(native);
      calls.forEach((call, index) => {
        frame.sources[`tool:${frame.boundary}:${index}:${hash(call).slice(0, 12)}`] = JSON.parse(JSON.stringify(results[index]));
      });
      for (const call of calls) bindingEvents.push({ seq: bindingEvents.length, kind: "tool_request", call_id: call.id, tool: call.name, arguments: call.input });
      const completed: string[] = [];
      calls.forEach((call, index) => {
        const value = results[index] as { ok?: boolean };
        const status = value?.ok ? "success" : "error";
        bindingEvents.push({ seq: bindingEvents.length, kind: "tool_result", call_id: call.id, tool: call.name, status, result: results[index] });
        completed.push(`${call.name}:${status}`);
      });
      signatures.push(completed.length === 1 ? completed[0] : `batch[${completed.sort().join("|")}]`);
      frame.sources._binding_events = JSON.parse(JSON.stringify(bindingEvents));
      frame.sources._signatures = [...signatures];
      return results;
    },
    close: () => runtime.close(),
  };
}
