import { createHash, randomUUID } from "node:crypto";

export const CONTEXT_SCOPE_TYPES = ["COMPANY", "PRODUCT", "PART", "REQUEST"] as const;
export const CONTEXT_VISIBILITIES = ["SHARED", "INTERNAL"] as const;
export type ContextScopeType = typeof CONTEXT_SCOPE_TYPES[number];
export type ContextVisibility = typeof CONTEXT_VISIBILITIES[number];

export type ContextNodeRecord = {
  id: string;
  parentId: string | null;
  scopeType: string;
  name: string;
  visibility: string;
  version: number;
};

export type ContextFactRecord = {
  id: string;
  nodeId: string;
  key: string;
  value: unknown;
  status: string;
  visibility: string;
  evidence: unknown;
  createdAt: Date | string;
};

export function cleanContextText(value: unknown, maxLength: number) {
  return typeof value === "string"
    ? value.replace(/\u2014/g, "-").replace(/\0/g, "").replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}

export function cleanContextBody(value: unknown, maxLength: number) {
  return typeof value === "string"
    ? value.replace(/\u2014/g, "-").replace(/\0/g, "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{4,}/g, "\n\n\n").trim().slice(0, maxLength)
    : "";
}

export function normalizeContextScope(value: unknown): ContextScopeType {
  const scope = String(value ?? "").trim().toUpperCase();
  if (!CONTEXT_SCOPE_TYPES.includes(scope as ContextScopeType)) {
    throw new Error("Context scope must be COMPANY, PRODUCT, PART, or REQUEST.");
  }
  return scope as ContextScopeType;
}

export function normalizeContextVisibility(value: unknown, fallback: ContextVisibility = "INTERNAL"): ContextVisibility {
  const visibility = String(value ?? fallback).trim().toUpperCase();
  if (!CONTEXT_VISIBILITIES.includes(visibility as ContextVisibility)) {
    throw new Error("Context visibility must be SHARED or INTERNAL.");
  }
  return visibility as ContextVisibility;
}

export function allowedContextChild(parent: ContextScopeType, child: ContextScopeType) {
  if (parent === "COMPANY") return child === "PRODUCT" || child === "REQUEST";
  if (parent === "PRODUCT") return child === "PART" || child === "REQUEST";
  if (parent === "PART") return child === "REQUEST";
  return false;
}

export function newContextKey(scope: ContextScopeType) {
  return `${scope.toLowerCase()}:${randomUUID()}`;
}

export function contextAncestorChain(nodes: ContextNodeRecord[], selectedNodeId: string) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const chain: ContextNodeRecord[] = [];
  const visited = new Set<string>();
  let current = byId.get(selectedNodeId);
  while (current) {
    if (visited.has(current.id)) throw new Error("Context hierarchy contains a cycle.");
    visited.add(current.id);
    chain.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  if (!chain.length || chain[0].scopeType !== "COMPANY") {
    throw new Error("Selected context is not attached to the company root.");
  }
  return chain;
}

function stableJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function resolveContextFacts(args: {
  chain: ContextNodeRecord[];
  facts: ContextFactRecord[];
  sharedOnly?: boolean;
}) {
  const precedence = new Map(args.chain.map((node, index) => [node.id, index]));
  const eligible = args.facts.filter((fact) => (
    fact.status === "CONFIRMED"
    && precedence.has(fact.nodeId)
    && (!args.sharedOnly || fact.visibility === "SHARED")
  ));
  const byKey = new Map<string, ContextFactRecord[]>();
  for (const fact of eligible) byKey.set(fact.key, [...(byKey.get(fact.key) ?? []), fact]);

  const resolved: Array<ContextFactRecord & { inherited: boolean; overridden: ContextFactRecord[] }> = [];
  const conflicts: Array<{ key: string; facts: ContextFactRecord[] }> = [];
  for (const [key, facts] of byKey) {
    const highest = Math.max(...facts.map((fact) => precedence.get(fact.nodeId) ?? -1));
    const nearest = facts.filter((fact) => precedence.get(fact.nodeId) === highest);
    const distinctValues = new Set(nearest.map((fact) => stableJson(fact.value)));
    if (distinctValues.size > 1) {
      conflicts.push({ key, facts: nearest });
      continue;
    }
    const active = [...nearest].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0];
    resolved.push({
      ...active,
      inherited: active.nodeId !== args.chain.at(-1)?.id,
      overridden: facts.filter((fact) => fact.id !== active.id),
    });
  }
  return { resolved: resolved.sort((left, right) => left.key.localeCompare(right.key)), conflicts };
}

export function contextSnapshotHash(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function contextCitation(kind: string, id: string, label: string) {
  return { id: `${kind.toLowerCase()}:${id}`, kind, sourceId: id, label };
}
