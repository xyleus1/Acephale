import { copy, hash } from "../../src/lib/goalspec/canonical";
import type { ExecutionFrame } from "../../src/lib/goalspec/contracts/generated";
import type { NativeMessage, PublicBoundary } from "./actor";
import { localActorMessages } from "./local-actor";

export function infraNativePublicCheckpointInput(runId: string, boundaryId: string, boundary: PublicBoundary) {
  return { runId, boundaryId, policy: boundary.policy, messages: localActorMessages(boundary), tools: copy(boundary.tools) };
}

/** Called synchronously after model completion and before any result promotion or tool execution. */
export function infraActorGeneratedEvent(frame: ExecutionFrame, boundaryId: string, input: PublicBoundary,
  response: Pick<NativeMessage, "role" | "tool_calls"> & { raw_data?: unknown }, publicCheckpointHash?: string) {
  const raw = response.raw_data as Record<string, unknown> | null | undefined;
  const compiler = raw?.goalspecCompiler as Record<string, unknown> | undefined;
  const compiledInputHash = compiler?.inputHash;
  if (compiledInputHash !== undefined && (typeof compiledInputHash !== "string" || !/^[a-f0-9]{64}$/.test(compiledInputHash))) {
    throw new Error("Actor compiler input identity is invalid");
  }
  const publicInputHash = publicCheckpointHash ?? hash(input);
  return { type: "actor_generated", runId: frame.runId, checkpoint: frame.boundary, boundary: frame.boundary, boundaryId,
    frameHash: hash(frame), publicInputHash, actorInputHash: compiledInputHash ?? publicInputHash,
    actorInputHashKind: compiledInputHash ? "compiled_model_input" : "public_boundary_fixture",
    actorResponseHash: hash(response), toolCalls: (response.tool_calls ?? []).map(call => ({ id: call.id, name: call.name, arguments: copy(call.arguments) })) };
}
