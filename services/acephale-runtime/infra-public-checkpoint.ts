import { copy, hash } from "../../src/lib/acephale/canonical";
import type { ExecutionFrame, Json } from "../../src/lib/acephale/contracts/generated";
import { validateContract } from "../../src/lib/acephale/contracts/validate";
import { documentPublicInput } from "../../scripts/acephale-infra-document-data";
import { documentFrame } from "./infra-document-runner";
import { DOCUMENT_TOOLS } from "./document-adapter";
import type { PublicBoundary } from "./actor";

export interface PublicRow {
  checkpoint_id: string; input_hash: string; episode_id: string; family_id: string; split: string; domain: string; through_seq: number;
  environment_version: string; tool_schema_hash: string; runtime_tool_schema_hash?: string;
  request_revision?: string;
  checkpoint_number?: number;
  document_boundary?: PublicBoundary;
  scope: { tenant_id: string; principal_id: string; authorization_revision: string };
  input: { policy: string; sources: { id: string; kind: string; value: Json }[];
    events: { kind: string; seq: number; role?: string; content?: string; tool?: string; status?: string; [key: string]: unknown }[];
    tools: { name: string; parameters: Record<string, unknown> }[] };
}
export function publicInfraFrame(row: PublicRow, snapshotId: string): ExecutionFrame {
  if (row.domain === "documents") {
    if (hash(row.input) !== row.input_hash || !["train", "development", "test"].includes(row.split) || !row.document_boundary
      || !Number.isSafeInteger(row.checkpoint_number) || row.checkpoint_number! < 0
      || hash(row.document_boundary.tools) !== hash(DOCUMENT_TOOLS) || row.runtime_tool_schema_hash !== hash(DOCUMENT_TOOLS)) throw new Error("Invalid document replay provenance");
    const frame = documentFrame(row.document_boundary, `replay:${row.episode_id}`, row.checkpoint_number!, {
      tenantId: row.scope.tenant_id, principalId: row.scope.principal_id, authorizationVersion: row.scope.authorization_revision,
      environmentVersion: row.environment_version, toolSchemaHash: row.runtime_tool_schema_hash }, snapshotId);
    if (hash(documentPublicInput(row.document_boundary, frame)) !== row.input_hash) throw new Error("Document replay prefix differs from declared public input");
    validateContract("ExecutionFrame", frame); return frame;
  }
  if (hash(row.input) !== row.input_hash || !["train", "development", "test"].includes(row.split)
    || row.runtime_tool_schema_hash !== undefined && !/^[a-f0-9]{64}$/.test(row.runtime_tool_schema_hash)
    || !["retail", "airline"].includes(row.domain) || !Array.isArray(row.input.sources) || row.input.events.some(event => event.seq > row.through_seq)) throw new Error("Invalid public checkpoint provenance");
  const sources: Record<string, Json> = Object.fromEntries(row.input.sources.map(source => [source.id, copy(source.value)]));
  const requirements = row.input.events.filter(event => event.kind === "message" && event.role === "user" && typeof event.content === "string");
  for (const event of requirements) {
    const id = `requirement:${event.seq}`;
    if (Object.hasOwn(sources, id) && sources[id] !== event.content) throw new Error("Conflicting public requirement provenance");
    sources[id] = event.content!;
  }
  sources._binding_events = copy(row.input.events.filter(event => ["tool_request", "tool_result"].includes(event.kind))) as Json;
  sources._signatures = row.input.events.filter(event => event.kind === "tool_result").map(event => `${event.tool}:${event.status}`);
  const frame: ExecutionFrame = { schemaVersion: 1, runId: `replay:${row.episode_id}`, boundary: row.through_seq + 1,
    scope: { tenantId: row.scope.tenant_id, principalId: row.scope.principal_id, authorizationVersion: row.scope.authorization_revision,
      environmentVersion: row.environment_version, toolSchemaHash: row.runtime_tool_schema_hash ?? row.tool_schema_hash }, snapshotId,
    requestedObjective: requirements.map(event => event.content).join("\n") || "No requested objective is visible at this checkpoint.",
    policy: row.input.policy, sources, goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash({}) } };
  validateContract("ExecutionFrame", frame); return frame;
}
