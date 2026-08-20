import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { storeContextDocumentFile } from "@/lib/document-storage";
import { ingestKnowledgeObject } from "@/lib/memory/ingest-object";
import { recordMemoryEvent } from "@/lib/memory/record-event";
import type { CustomerPortalPrincipal } from "@/lib/customer-portal-data";
import {
  allowedContextChild,
  cleanContextBody,
  cleanContextText,
  contextAncestorChain,
  contextCitation,
  contextSnapshotHash,
  newContextKey,
  normalizeContextScope,
  normalizeContextVisibility,
  resolveContextFacts,
  type ContextScopeType,
  type ContextVisibility,
} from "./context-contract";
import {
  contextDocumentHash,
  extractContextDocumentText,
  validateContextDocumentUpload,
} from "./context-documents";
import {
  requireSupplyWorkspace,
  SupplyPersistenceError,
  type SupplyAccessContext,
} from "./persistence";
import { supplyContextEnabled } from "./context-feature";

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function contextDocumentMetadata(file: File) {
  try {
    return validateContextDocumentUpload(file);
  } catch (error) {
    throw new SupplyPersistenceError(
      error instanceof Error ? error.message : "The document is invalid.",
      "invalid_input",
    );
  }
}

async function bumpContextVersion(workspaceId: string, nodeId: string) {
  await prisma.$transaction([
    prisma.supplyContextNode.update({ where: { id: nodeId }, data: { version: { increment: 1 } } }),
    prisma.supplyWorkspace.update({ where: { id: workspaceId }, data: { version: { increment: 1 } } }),
  ]);
}

export async function emitContextMemory(args: {
  officeId: string;
  companyId: string | null;
  nodeId: string;
  recordId: string;
  kind: "node" | "message" | "document" | "fact" | "draft" | "send";
  title: string;
  text?: string | null;
  visibility: string;
  actorType: string;
  actorId?: string | null;
  payload: Record<string, unknown>;
}) {
  const canonicalType = args.kind === "document" ? "company_document" : "context_node";
  const sourceType = args.kind === "document" ? "DOCUMENT" : args.kind === "message" ? "AGENT" : "SYSTEM";
  const provenance = {
    source: "supply_context",
    operation: args.kind,
    path: "src/lib/supply-os/context-persistence.ts",
    function: "emitContextMemory",
    sourceRecordId: args.recordId,
    actorType: args.actorType,
    actorId: args.actorId ?? null,
  };
  await Promise.all([
    ingestKnowledgeObject({
      officeId: args.officeId,
      sourceType,
      sourceExternalId: `supply_context:${args.kind}:${args.recordId}`,
      canonicalType,
      title: args.title,
      text: args.text ?? null,
      rawRef: `context_node:${args.nodeId}`,
      visibility: args.visibility,
      entityType: "context_node",
      entityId: args.nodeId,
      companyId: args.companyId,
      payload: args.payload,
      provenance,
      mentions: [{ entityType: "context_node", entityId: args.nodeId }],
    }).catch(() => null),
    recordMemoryEvent({
      officeId: args.officeId,
      sourceType,
      sourceExternalId: `supply_context:${args.kind}:${args.recordId}`,
      eventType: `supply_context.${args.kind}`,
      entityType: "context_node",
      entityId: args.nodeId,
      actorType: args.actorType,
      actorId: args.actorId ?? null,
      payload: args.payload,
      provenance,
      idempotencyKey: `supply_context:${args.kind}:${args.recordId}`,
    }).catch(() => null),
  ]);
}

export async function ensureSupplyContextRoot(context: SupplyAccessContext, workspaceId: string) {
  if (!supplyContextEnabled(context.officeId)) throw new SupplyPersistenceError("Context is not enabled for this office.", "forbidden");
  const workspace = await requireSupplyWorkspace(context, workspaceId, "view");
  if (!workspace.companyId) {
    throw new SupplyPersistenceError("Context requires a company-linked workspace.", "invalid_input");
  }
  await prisma.supplyContextNode.createMany({
    data: [{
      officeId: context.officeId,
      workspaceId,
      contextKey: "company",
      scopeType: "COMPANY",
      name: workspace.name,
      visibility: "SHARED",
      createdByUserId: workspace.createdByUserId,
    }],
    skipDuplicates: true,
  });
  const root = await prisma.supplyContextNode.findFirst({
    where: { officeId: context.officeId, workspaceId, contextKey: "company", archivedAt: null },
  });
  if (!root) throw new SupplyPersistenceError("Company context could not be created.", "conflict");
  return { workspace, root };
}

async function contextNode(context: SupplyAccessContext, workspaceId: string, nodeId: string, mode: "view" | "edit") {
  if (!supplyContextEnabled(context.officeId)) throw new SupplyPersistenceError("Context is not enabled for this office.", "forbidden");
  await requireSupplyWorkspace(context, workspaceId, mode);
  const node = await prisma.supplyContextNode.findFirst({
    where: { id: nodeId, officeId: context.officeId, workspaceId, archivedAt: null },
  });
  if (!node) throw new SupplyPersistenceError("Context scope not found.", "not_found");
  return node;
}

export async function createSupplyContextNode(args: {
  context: SupplyAccessContext;
  workspaceId: string;
  parentId: string;
  scopeType: unknown;
  name: unknown;
  description?: unknown;
  visibility?: unknown;
}) {
  await requireSupplyWorkspace(args.context, args.workspaceId, "edit");
  const parent = await contextNode(args.context, args.workspaceId, args.parentId, "view");
  const scopeType = normalizeContextScope(args.scopeType);
  const parentScope = normalizeContextScope(parent.scopeType);
  if (!allowedContextChild(parentScope, scopeType)) {
    throw new SupplyPersistenceError(`${scopeType} cannot be created under ${parentScope}.`, "invalid_input");
  }
  const name = cleanContextText(args.name, 160);
  if (name.length < 2) throw new SupplyPersistenceError("Context name must contain at least 2 characters.", "invalid_input");
  const visibility = normalizeContextVisibility(args.visibility);
  if (parent.visibility === "INTERNAL" && visibility === "SHARED") {
    throw new SupplyPersistenceError("A shared scope cannot be created under an internal scope.", "invalid_input");
  }
  const node = await prisma.supplyContextNode.create({
    data: {
      officeId: args.context.officeId,
      workspaceId: args.workspaceId,
      parentId: parent.id,
      contextKey: newContextKey(scopeType),
      scopeType,
      name,
      description: cleanContextText(args.description, 1_000) || null,
      visibility,
      createdByUserId: args.context.userId,
    },
  });
  await bumpContextVersion(args.workspaceId, parent.id);
  await emitContextMemory({
    officeId: args.context.officeId,
    companyId: (await requireSupplyWorkspace(args.context, args.workspaceId, "view")).companyId,
    nodeId: node.id,
    recordId: node.id,
    kind: "node",
    title: node.name,
    visibility,
    actorType: "user",
    actorId: args.context.userId,
    payload: { workspaceId: args.workspaceId, nodeId: node.id, parentId: parent.id, scopeType },
  });
  return node;
}

export async function appendSupplyContextMessage(args: {
  context: SupplyAccessContext;
  workspaceId: string;
  nodeId: string;
  body: unknown;
  visibility?: unknown;
  role?: "OPERATOR" | "SYSTEM" | "AGENT";
  publish?: boolean;
}) {
  const node = await contextNode(args.context, args.workspaceId, args.nodeId, "edit");
  const body = cleanContextBody(args.body, 12_000);
  if (!body) throw new SupplyPersistenceError("Message is required.", "invalid_input");
  const visibility = normalizeContextVisibility(args.visibility);
  if (node.visibility === "INTERNAL" && visibility === "SHARED") {
    throw new SupplyPersistenceError("A message in an internal scope cannot be shared.", "invalid_input");
  }
  const role = args.role ?? "OPERATOR";
  const message = await prisma.supplyContextMessage.create({
    data: {
      officeId: args.context.officeId,
      workspaceId: args.workspaceId,
      nodeId: node.id,
      role,
      body,
      visibility,
      createdByUserId: args.context.userId,
      ...(args.publish && visibility === "SHARED" ? {
        publishedByUserId: args.context.userId,
        publishedAt: new Date(),
      } : {}),
    },
  });
  await bumpContextVersion(args.workspaceId, node.id);
  const workspace = await requireSupplyWorkspace(args.context, args.workspaceId, "view");
  await emitContextMemory({
    officeId: args.context.officeId,
    companyId: workspace.companyId,
    nodeId: node.id,
    recordId: message.id,
    kind: "message",
    title: `${role.toLowerCase()} context message`,
    text: body,
    visibility,
    actorType: "user",
    actorId: args.context.userId,
    payload: { workspaceId: args.workspaceId, nodeId: node.id, messageId: message.id, role, visibility },
  });
  return message;
}

export async function saveSupplyContextAgentMessage(args: {
  context: SupplyAccessContext;
  workspaceId: string;
  nodeId: string;
  body: string;
  citations: Array<{ id: string; kind: string; sourceId: string; label: string }>;
}) {
  const node = await contextNode(args.context, args.workspaceId, args.nodeId, "edit");
  const body = cleanContextBody(args.body, 12_000);
  if (!body) throw new SupplyPersistenceError("Agent response is empty.", "invalid_input");
  const message = await prisma.supplyContextMessage.create({
    data: {
      officeId: args.context.officeId,
      workspaceId: args.workspaceId,
      nodeId: node.id,
      role: "AGENT",
      body,
      citations: json(args.citations),
      visibility: "INTERNAL",
      createdByUserId: args.context.userId,
    },
  });
  await bumpContextVersion(args.workspaceId, node.id);
  const workspace = await requireSupplyWorkspace(args.context, args.workspaceId, "view");
  await emitContextMemory({
    officeId: args.context.officeId,
    companyId: workspace.companyId,
    nodeId: node.id,
    recordId: message.id,
    kind: "message",
    title: "grounded context reply",
    text: body,
    visibility: "INTERNAL",
    actorType: "agent",
    actorId: args.context.userId,
    payload: { workspaceId: args.workspaceId, nodeId: node.id, messageId: message.id, citations: args.citations },
  });
  return message;
}

export async function uploadSupplyContextDocument(args: {
  context: SupplyAccessContext;
  workspaceId: string;
  nodeId: string;
  file: File;
  visibility?: unknown;
}) {
  const node = await contextNode(args.context, args.workspaceId, args.nodeId, "edit");
  const metadata = contextDocumentMetadata(args.file);
  const visibility = normalizeContextVisibility(args.visibility);
  if (node.visibility === "INTERNAL" && visibility === "SHARED") {
    throw new SupplyPersistenceError("A document in an internal scope cannot be shared.", "invalid_input");
  }
  const bytes = Buffer.from(await args.file.arrayBuffer());
  const contentHash = contextDocumentHash(bytes);
  const duplicate = await prisma.supplyContextDocument.findUnique({
    where: { workspaceId_contentHash: { workspaceId: args.workspaceId, contentHash } },
  });
  if (duplicate) throw new SupplyPersistenceError("This document is already attached to the company context.", "conflict");
  const stored = await storeContextDocumentFile({
    officeId: args.context.officeId,
    workspaceId: args.workspaceId,
    preferredName: metadata.name,
    bytes,
    contentType: metadata.mimeType,
  });
  const extraction = await extractContextDocumentText(bytes, metadata.mimeType, metadata.name);
  const document = await prisma.supplyContextDocument.create({
    data: {
      officeId: args.context.officeId,
      workspaceId: args.workspaceId,
      nodeId: node.id,
      name: metadata.name,
      storageUrl: stored.url,
      mimeType: metadata.mimeType,
      sizeBytes: metadata.sizeBytes,
      contentHash,
      processingState: extraction.state,
      extractionText: extraction.text,
      extractionError: extraction.error,
      visibility,
      uploadedByUserId: args.context.userId,
    },
  });
  await bumpContextVersion(args.workspaceId, node.id);
  const workspace = await requireSupplyWorkspace(args.context, args.workspaceId, "view");
  await emitContextMemory({
    officeId: args.context.officeId,
    companyId: workspace.companyId,
    nodeId: node.id,
    recordId: document.id,
    kind: "document",
    title: document.name,
    text: document.extractionText,
    visibility,
    actorType: "user",
    actorId: args.context.userId,
    payload: {
      workspaceId: args.workspaceId,
      nodeId: node.id,
      documentId: document.id,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      contentHash,
      processingState: document.processingState,
    },
  });
  return document;
}

export async function createSupplyContextFactProposal(args: {
  context: SupplyAccessContext;
  workspaceId: string;
  nodeId: string;
  key: unknown;
  value: unknown;
  evidence: unknown;
  visibility?: unknown;
  proposedBy?: string;
  supersedesFactId?: string | null;
  additionalEvidenceFactIds?: string[];
}) {
  const node = await contextNode(args.context, args.workspaceId, args.nodeId, "edit");
  const key = cleanContextText(args.key, 120).toLowerCase();
  if (!key) throw new SupplyPersistenceError("Fact key is required.", "invalid_input");
  const visibility = normalizeContextVisibility(args.visibility);
  if (node.visibility === "INTERNAL" && visibility === "SHARED") {
    throw new SupplyPersistenceError("A fact in an internal scope cannot be shared.", "invalid_input");
  }
  if (args.value === undefined) throw new SupplyPersistenceError("Fact value is required.", "invalid_input");
  const evidence = Array.isArray(args.evidence)
    ? [...new Set(args.evidence.map((entry) => cleanContextText(entry, 260)).filter(Boolean))].slice(0, 30)
    : [];
  if (!evidence.length) throw new SupplyPersistenceError("Fact evidence is required.", "invalid_input");
  const assembled = await assembleSupplyContext({ context: args.context, workspaceId: args.workspaceId, nodeId: node.id });
  const allowedEvidence = new Set([
    ...assembled.citations.map((citation) => citation.id),
    ...(args.additionalEvidenceFactIds ?? []).map((id) => `fact:${id}`),
  ]);
  if (evidence.some((entry) => !allowedEvidence.has(entry))) {
    throw new SupplyPersistenceError("Fact evidence must be visible in the selected context or explicitly promoted from a child.", "invalid_input");
  }
  const proposedBy = cleanContextText(args.proposedBy, 30).toUpperCase() || "OPERATOR";
  if (!["CUSTOMER", "OPERATOR", "AGENT", "SYSTEM"].includes(proposedBy)) {
    throw new SupplyPersistenceError("Invalid fact proposer.", "invalid_input");
  }
  let supersedesFactId: string | null = null;
  if (args.supersedesFactId) {
    const previous = await prisma.supplyContextFact.findFirst({
      where: {
        id: args.supersedesFactId,
        officeId: args.context.officeId,
        workspaceId: args.workspaceId,
        nodeId: node.id,
        key,
        status: "CONFIRMED",
        supersededBy: null,
      },
      select: { id: true },
    });
    if (!previous) throw new SupplyPersistenceError("The fact being replaced is not current.", "conflict");
    supersedesFactId = previous.id;
  }
  const fact = await prisma.supplyContextFact.create({
    data: {
      officeId: args.context.officeId,
      workspaceId: args.workspaceId,
      nodeId: node.id,
      key,
      value: json(args.value),
      evidence: json(evidence),
      proposedBy,
      visibility,
      supersedesFactId,
    },
  });
  await bumpContextVersion(args.workspaceId, node.id);
  return fact;
}

export async function reviewSupplyContextFact(args: {
  context: SupplyAccessContext;
  workspaceId: string;
  factId: string;
  decision: unknown;
}) {
  await requireSupplyWorkspace(args.context, args.workspaceId, "edit");
  const fact = await prisma.supplyContextFact.findFirst({
    where: { id: args.factId, officeId: args.context.officeId, workspaceId: args.workspaceId, status: "PROPOSED" },
  });
  if (!fact) throw new SupplyPersistenceError("Pending context fact not found.", "not_found");
  const decision = cleanContextText(args.decision, 20).toUpperCase();
  if (!['CONFIRMED', 'REJECTED'].includes(decision)) {
    throw new SupplyPersistenceError("Fact decision must be CONFIRMED or REJECTED.", "invalid_input");
  }
  const updated = await prisma.$transaction(async (tx) => {
    const reviewed = await tx.supplyContextFact.update({
      where: { id: fact.id },
      data: { status: decision, reviewedByUserId: args.context.userId, reviewedAt: new Date() },
    });
    if (decision === "CONFIRMED" && fact.supersedesFactId) {
      const superseded = await tx.supplyContextFact.updateMany({
        where: { id: fact.supersedesFactId, officeId: args.context.officeId, workspaceId: args.workspaceId, status: "CONFIRMED" },
        data: { status: "SUPERSEDED" },
      });
      if (superseded.count !== 1) throw new SupplyPersistenceError("The fact being replaced changed during review.", "conflict");
    }
    return reviewed;
  });
  await bumpContextVersion(args.workspaceId, fact.nodeId);
  if (decision === "CONFIRMED") {
    const workspace = await requireSupplyWorkspace(args.context, args.workspaceId, "view");
    await emitContextMemory({
      officeId: args.context.officeId,
      companyId: workspace.companyId,
      nodeId: fact.nodeId,
      recordId: fact.id,
      kind: "fact",
      title: fact.key,
      text: JSON.stringify(fact.value),
      visibility: fact.visibility,
      actorType: "user",
      actorId: args.context.userId,
      payload: { workspaceId: args.workspaceId, nodeId: fact.nodeId, factId: fact.id, key: fact.key, evidence: fact.evidence },
    });
  }
  return updated;
}

export async function promoteSupplyContextFact(args: {
  context: SupplyAccessContext;
  workspaceId: string;
  factId: string;
  targetNodeId: string;
}) {
  await requireSupplyWorkspace(args.context, args.workspaceId, "edit");
  const fact = await prisma.supplyContextFact.findFirst({
    where: { id: args.factId, officeId: args.context.officeId, workspaceId: args.workspaceId, status: "CONFIRMED" },
  });
  if (!fact) throw new SupplyPersistenceError("Confirmed context fact not found.", "not_found");
  const nodes = await prisma.supplyContextNode.findMany({
    where: { officeId: args.context.officeId, workspaceId: args.workspaceId, archivedAt: null },
  });
  const chain = contextAncestorChain(nodes, fact.nodeId);
  if (!chain.slice(0, -1).some((node) => node.id === args.targetNodeId)) {
    throw new SupplyPersistenceError("Facts can only be promoted to an ancestor scope.", "invalid_input");
  }
  return createSupplyContextFactProposal({
    context: args.context,
    workspaceId: args.workspaceId,
    nodeId: args.targetNodeId,
    key: fact.key,
    value: fact.value,
    evidence: [`fact:${fact.id}`],
    visibility: fact.visibility,
    proposedBy: "OPERATOR",
    additionalEvidenceFactIds: [fact.id],
  });
}

export async function publishSupplyContextAgentMessage(args: {
  context: SupplyAccessContext;
  workspaceId: string;
  messageId: string;
}) {
  await requireSupplyWorkspace(args.context, args.workspaceId, "edit");
  const message = await prisma.supplyContextMessage.findFirst({
    where: { id: args.messageId, officeId: args.context.officeId, workspaceId: args.workspaceId, role: "AGENT" },
    include: { node: { select: { visibility: true } } },
  });
  if (!message) throw new SupplyPersistenceError("Agent reply not found.", "not_found");
  if (message.node.visibility !== "SHARED") {
    throw new SupplyPersistenceError("Replies in an internal scope cannot be published.", "conflict");
  }
  if (message.publishedAt) return message;
  const published = await prisma.supplyContextMessage.update({
    where: { id: message.id },
    data: { visibility: "SHARED", publishedByUserId: args.context.userId, publishedAt: new Date() },
  });
  await bumpContextVersion(args.workspaceId, message.nodeId);
  return published;
}

async function validateSource(args: { officeId: string; workspaceId: string; companyId: string; sourceType: string; sourceId: string }) {
  if (args.sourceType === "MESSAGE") {
    return prisma.supplyContextMessage.findFirst({
      where: { id: args.sourceId, officeId: args.officeId, workspaceId: args.workspaceId },
      select: { id: true, role: true, visibility: true },
    });
  }
  if (args.sourceType === "DOCUMENT") {
    return prisma.supplyContextDocument.findFirst({
      where: { id: args.sourceId, officeId: args.officeId, workspaceId: args.workspaceId },
      select: { id: true, name: true, visibility: true },
    });
  }
  if (args.sourceType === "GMAIL_THREAD") {
    return prisma.emailThread.findFirst({
      where: { id: args.sourceId, officeId: args.officeId, companyId: args.companyId, messages: { some: { account: { provider: "GMAIL" } } } },
      select: { id: true, subject: true },
    });
  }
  if (args.sourceType === "WHATSAPP") {
    return prisma.emailThread.findFirst({
      where: { id: args.sourceId, officeId: args.officeId, companyId: args.companyId, messages: { some: { account: { provider: "WHATSAPP" } } } },
      select: { id: true, subject: true },
    });
  }
  if (args.sourceType === "JOB") {
    return prisma.job.findFirst({ where: { id: args.sourceId, officeId: args.officeId, companyId: args.companyId }, select: { id: true, title: true, reference: true } });
  }
  if (args.sourceType === "INQUIRY") {
    return prisma.inquiry.findFirst({ where: { id: args.sourceId, officeId: args.officeId, companyId: args.companyId }, select: { id: true, subject: true, reference: true } });
  }
  if (args.sourceType === "KNOWLEDGE_OBJECT") {
    return prisma.knowledgeObject.findFirst({ where: { id: args.sourceId, officeId: args.officeId, companyId: args.companyId }, select: { id: true, title: true } });
  }
  throw new SupplyPersistenceError("Unsupported context source type.", "invalid_input");
}

export async function linkSupplyContextSource(args: {
  context: SupplyAccessContext;
  workspaceId: string;
  nodeId: string;
  sourceType: unknown;
  sourceId: unknown;
  label?: unknown;
  visibility?: unknown;
}) {
  const node = await contextNode(args.context, args.workspaceId, args.nodeId, "edit");
  const workspace = await requireSupplyWorkspace(args.context, args.workspaceId, "view");
  if (!workspace.companyId) throw new SupplyPersistenceError("Context requires a company-linked workspace.", "invalid_input");
  const sourceType = cleanContextText(args.sourceType, 40).toUpperCase();
  const sourceId = cleanContextText(args.sourceId, 220);
  const source = await validateSource({ officeId: args.context.officeId, workspaceId: args.workspaceId, companyId: workspace.companyId, sourceType, sourceId });
  if (!source) throw new SupplyPersistenceError("Source record not found in this company workspace.", "not_found");
  const visibility = normalizeContextVisibility(args.visibility);
  if (["GMAIL_THREAD", "WHATSAPP"].includes(sourceType) && visibility === "SHARED") {
    throw new SupplyPersistenceError("Supplier conversations cannot be customer-visible.", "invalid_input");
  }
  if ((source as { visibility?: string }).visibility === "INTERNAL" && visibility === "SHARED") {
    throw new SupplyPersistenceError("Internal context evidence cannot be linked as shared.", "invalid_input");
  }
  const link = await prisma.supplyContextSourceLink.upsert({
    where: { workspaceId_nodeId_sourceType_sourceId: { workspaceId: args.workspaceId, nodeId: node.id, sourceType, sourceId } },
    update: { label: cleanContextText(args.label, 180) || null, visibility },
    create: {
      officeId: args.context.officeId,
      workspaceId: args.workspaceId,
      nodeId: node.id,
      sourceType,
      sourceId,
      label: cleanContextText(args.label, 180) || null,
      visibility,
      linkedByUserId: args.context.userId,
    },
  });
  await bumpContextVersion(args.workspaceId, node.id);
  return link;
}

export async function assembleSupplyContext(args: {
  context: SupplyAccessContext;
  workspaceId: string;
  nodeId?: string | null;
  sharedOnly?: boolean;
}) {
  const { workspace, root } = await ensureSupplyContextRoot(args.context, args.workspaceId);
  const nodes = await prisma.supplyContextNode.findMany({
    where: {
      officeId: args.context.officeId,
      workspaceId: args.workspaceId,
      archivedAt: null,
      ...(args.sharedOnly ? { visibility: "SHARED" } : {}),
    },
    orderBy: [{ createdAt: "asc" }, { name: "asc" }],
  });
  const selectedId = args.nodeId && nodes.some((node) => node.id === args.nodeId) ? args.nodeId : root.id;
  const chain = contextAncestorChain(nodes, selectedId);
  const nodeIds = chain.map((node) => node.id);
  const visibility = args.sharedOnly ? { visibility: "SHARED" } : {};
  const [messages, documents, facts, sourceLinks, drafts] = await Promise.all([
    prisma.supplyContextMessage.findMany({
      where: {
        officeId: args.context.officeId,
        workspaceId: args.workspaceId,
        nodeId: { in: nodeIds },
        ...visibility,
        ...(args.sharedOnly ? { OR: [{ role: { not: "AGENT" } }, { publishedAt: { not: null } }] } : {}),
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.supplyContextDocument.findMany({
      where: { officeId: args.context.officeId, workspaceId: args.workspaceId, nodeId: { in: nodeIds }, ...visibility },
      orderBy: { createdAt: "desc" },
    }),
    prisma.supplyContextFact.findMany({
      where: { officeId: args.context.officeId, workspaceId: args.workspaceId, nodeId: { in: nodeIds }, ...visibility },
      orderBy: { createdAt: "desc" },
    }),
    args.sharedOnly ? Promise.resolve([]) : prisma.supplyContextSourceLink.findMany({
      where: { officeId: args.context.officeId, workspaceId: args.workspaceId, nodeId: { in: nodeIds } },
      orderBy: { createdAt: "desc" },
    }),
    args.sharedOnly ? Promise.resolve([]) : prisma.supplyContextOutboundDraft.findMany({
      where: { officeId: args.context.officeId, workspaceId: args.workspaceId, nodeId: { in: nodeIds } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const factResolution = resolveContextFacts({ chain, facts, sharedOnly: args.sharedOnly });
  const threadLinks = sourceLinks.filter((link) => ["GMAIL_THREAD", "WHATSAPP"].includes(link.sourceType));
  const threadIds = threadLinks.map((link) => link.sourceId);
  const threadType = new Map(threadLinks.map((link) => [link.sourceId, link.sourceType]));
  const linkedThreadsRaw = threadIds.length && workspace.companyId ? await prisma.emailThread.findMany({
    where: { id: { in: threadIds }, officeId: args.context.officeId, companyId: workspace.companyId },
    select: {
      id: true,
      subject: true,
      lastMessageAt: true,
      messages: {
        orderBy: { sentAt: "asc" },
        select: { id: true, direction: true, fromEmail: true, subject: true, bodyText: true, sentAt: true },
      },
    },
  }) : [];
  const linkedThreads = linkedThreadsRaw.map((thread) => ({ ...thread, sourceType: threadType.get(thread.id) ?? "GMAIL_THREAD" }));
  const jobIds = sourceLinks.filter((link) => link.sourceType === "JOB").map((link) => link.sourceId);
  const inquiryIds = sourceLinks.filter((link) => link.sourceType === "INQUIRY").map((link) => link.sourceId);
  const knowledgeIds = sourceLinks.filter((link) => link.sourceType === "KNOWLEDGE_OBJECT").map((link) => link.sourceId);
  const messageIds = sourceLinks.filter((link) => link.sourceType === "MESSAGE").map((link) => link.sourceId);
  const documentIds = sourceLinks.filter((link) => link.sourceType === "DOCUMENT").map((link) => link.sourceId);
  const [linkedJobs, linkedInquiries, linkedKnowledge, linkedMessages, linkedDocuments] = await Promise.all([
    jobIds.length && workspace.companyId ? prisma.job.findMany({
      where: { id: { in: jobIds }, officeId: args.context.officeId, companyId: workspace.companyId },
      select: { id: true, reference: true, title: true, status: true, type: true, mode: true, origin: true, destination: true, commodity: true, incoterms: true, notes: true, updatedAt: true },
    }) : Promise.resolve([]),
    inquiryIds.length && workspace.companyId ? prisma.inquiry.findMany({
      where: { id: { in: inquiryIds }, officeId: args.context.officeId, companyId: workspace.companyId },
      select: { id: true, reference: true, subject: true, status: true, type: true, mode: true, origin: true, destination: true, commodity: true, incoterms: true, notes: true, updatedAt: true },
    }) : Promise.resolve([]),
    knowledgeIds.length && workspace.companyId ? prisma.knowledgeObject.findMany({
      where: { id: { in: knowledgeIds }, officeId: args.context.officeId, companyId: workspace.companyId },
      select: { id: true, title: true, canonicalType: true, occurredAt: true, updatedAt: true, chunks: { orderBy: { ordinal: "asc" }, take: 20, select: { text: true } } },
    }) : Promise.resolve([]),
    messageIds.length ? prisma.supplyContextMessage.findMany({
      where: { id: { in: messageIds }, officeId: args.context.officeId, workspaceId: args.workspaceId, role: { not: "AGENT" } },
      select: { id: true, role: true, body: true, citations: true, visibility: true, createdAt: true },
    }) : Promise.resolve([]),
    documentIds.length ? prisma.supplyContextDocument.findMany({
      where: { id: { in: documentIds }, officeId: args.context.officeId, workspaceId: args.workspaceId },
      select: { id: true, name: true, mimeType: true, contentHash: true, processingState: true, extractionText: true, visibility: true, updatedAt: true },
    }) : Promise.resolve([]),
  ]);
  const linkedRecords = [
    ...linkedJobs.map((record) => ({ sourceType: "JOB", id: record.id, label: record.title || record.reference, updatedAt: record.updatedAt, content: record })),
    ...linkedInquiries.map((record) => ({ sourceType: "INQUIRY", id: record.id, label: record.subject, updatedAt: record.updatedAt, content: record })),
    ...linkedKnowledge.map((record) => ({ sourceType: "KNOWLEDGE_OBJECT", id: record.id, label: record.title || record.canonicalType, updatedAt: record.updatedAt, content: { ...record, chunks: record.chunks.map((chunk) => chunk.text).join("\n").slice(0, 60_000) } })),
    ...linkedMessages.map((record) => ({ sourceType: "MESSAGE", id: record.id, label: `${record.role.toLowerCase()} message`, updatedAt: record.createdAt, content: record })),
    ...linkedDocuments.map((record) => ({ sourceType: "DOCUMENT", id: record.id, label: record.name, updatedAt: record.updatedAt, content: { ...record, extractionText: record.extractionText?.slice(0, 60_000) ?? null } })),
  ];
  const citations = [
    ...messages.filter((message) => message.role !== "AGENT").map((message) => contextCitation("MESSAGE", message.id, `${message.role.toLowerCase()} message`)),
    ...documents.map((document) => contextCitation("DOCUMENT", document.id, document.name)),
    ...factResolution.resolved.map((fact) => contextCitation("FACT", fact.id, fact.key)),
    ...linkedThreads.map((thread) => contextCitation(thread.sourceType, thread.id, thread.subject)),
    ...linkedRecords.map((record) => contextCitation(record.sourceType, record.id, record.label)),
  ].filter((citation, index, all) => all.findIndex((candidate) => candidate.id === citation.id) === index);
  const snapshot = {
    selectedNodeId: selectedId,
    chain: chain.map((node) => ({ id: node.id, version: node.version, scopeType: node.scopeType, name: node.name })),
    messages: messages.map((message) => ({ id: message.id, role: message.role, body: message.body, citations: message.citations, visibility: message.visibility, createdAt: message.createdAt })),
    documents: documents.map((document) => ({ id: document.id, name: document.name, contentHash: document.contentHash, processingState: document.processingState, updatedAt: document.updatedAt })),
    facts: factResolution.resolved.map((fact) => ({ id: fact.id, key: fact.key, value: fact.value, evidence: fact.evidence, visibility: fact.visibility })),
    sourceLinks: sourceLinks.map((link) => ({ id: link.id, sourceType: link.sourceType, sourceId: link.sourceId })),
    linkedThreads: linkedThreads.map((thread) => ({ id: thread.id, sourceType: thread.sourceType, subject: thread.subject, messages: thread.messages })),
    linkedRecords,
  };
  return {
    workspace: { id: workspace.id, name: workspace.name, companyId: workspace.companyId, version: workspace.version },
    nodes,
    selectedNodeId: selectedId,
    chain,
    messages,
    documents: documents.map(({ extractionText: _text, storageUrl: _url, ...document }) => document),
    facts,
    resolvedFacts: factResolution.resolved,
    conflicts: factResolution.conflicts,
    sourceLinks,
    linkedThreads,
    linkedRecords,
    drafts,
    citations,
    contextVersion: workspace.version,
    contextHash: contextSnapshotHash(snapshot),
    blocked: factResolution.conflicts.length > 0,
    snapshot,
  };
}

async function portalWorkspace(principal: CustomerPortalPrincipal, companyId: string, edit: boolean) {
  if (!supplyContextEnabled(principal.officeId)) throw new SupplyPersistenceError("Context is not enabled for this office.", "forbidden");
  const membership = principal.memberships.find((item) => item.companyId === companyId);
  if (!membership) throw new SupplyPersistenceError("Customer workspace not found.", "not_found");
  if (edit && membership.role === "VIEWER") {
    throw new SupplyPersistenceError("Viewers cannot change company context.", "forbidden");
  }
  const workspace = await prisma.supplyWorkspace.findFirst({
    where: { officeId: principal.officeId, companyId, status: "ACTIVE" },
  });
  if (!workspace) throw new SupplyPersistenceError("Customer context is not available yet.", "not_found");
  return { membership, workspace };
}

export async function loadCustomerSupplyContext(principal: CustomerPortalPrincipal, companyId: string, nodeId?: string | null) {
  const { workspace } = await portalWorkspace(principal, companyId, false);
  const root = await prisma.supplyContextNode.upsert({
    where: { workspaceId_contextKey: { workspaceId: workspace.id, contextKey: "company" } },
    update: {},
    create: {
      officeId: principal.officeId,
      workspaceId: workspace.id,
      contextKey: "company",
      scopeType: "COMPANY",
      name: workspace.name,
      visibility: "SHARED",
    },
  });
  const nodes = await prisma.supplyContextNode.findMany({
    where: { officeId: principal.officeId, workspaceId: workspace.id, visibility: "SHARED", archivedAt: null },
    select: { id: true, parentId: true, scopeType: true, name: true, description: true, visibility: true, version: true, createdAt: true, updatedAt: true },
  });
  const selectedId = nodeId && nodes.some((node) => node.id === nodeId) ? nodeId : root.id;
  const chain = contextAncestorChain(nodes, selectedId);
  const nodeIds = chain.map((node) => node.id);
  const [messages, documents, facts] = await Promise.all([
    prisma.supplyContextMessage.findMany({
      where: {
        officeId: principal.officeId,
        workspaceId: workspace.id,
        nodeId: { in: nodeIds },
        visibility: "SHARED",
        OR: [{ role: { not: "AGENT" } }, { publishedAt: { not: null } }],
      },
      select: { id: true, nodeId: true, role: true, body: true, citations: true, visibility: true, publishedAt: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.supplyContextDocument.findMany({
      where: { officeId: principal.officeId, workspaceId: workspace.id, nodeId: { in: nodeIds }, visibility: "SHARED" },
      select: { id: true, nodeId: true, name: true, mimeType: true, sizeBytes: true, contentHash: true, processingState: true, extractionError: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.supplyContextFact.findMany({
      where: { officeId: principal.officeId, workspaceId: workspace.id, nodeId: { in: nodeIds }, visibility: "SHARED", status: "CONFIRMED" },
      select: { id: true, nodeId: true, key: true, value: true, status: true, visibility: true, evidence: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const resolution = resolveContextFacts({ chain, facts, sharedOnly: true });
  const allowedCitationIds = new Set([
    ...messages.filter((message) => message.role !== "AGENT").map((message) => `message:${message.id}`),
    ...documents.map((document) => `document:${document.id}`),
    ...facts.map((fact) => `fact:${fact.id}`),
  ]);
  const portalMessages = messages.map((message) => ({
    ...message,
    citations: Array.isArray(message.citations)
      ? message.citations.filter((citation) => {
        if (!citation || typeof citation !== "object" || Array.isArray(citation)) return false;
        const id = (citation as Record<string, unknown>).id;
        return typeof id === "string" && allowedCitationIds.has(id);
      })
      : null,
  }));
  const portalFact = <T extends { evidence: unknown }>(fact: T) => {
    const { evidence: _evidence, ...safe } = fact;
    return safe;
  };
  return {
    workspace: { id: workspace.id, name: workspace.name, companyId },
    membership: principal.memberships.find((item) => item.companyId === companyId),
    nodes,
    selectedNodeId: selectedId,
    chain,
    messages: portalMessages,
    documents,
    facts: facts.map(portalFact),
    resolvedFacts: resolution.resolved.map(({ overridden: _overridden, ...fact }) => portalFact(fact)),
    conflicts: resolution.conflicts.map((conflict) => ({ key: conflict.key, facts: conflict.facts.map(portalFact) })),
  };
}

export async function createCustomerSupplyContextNode(args: {
  principal: CustomerPortalPrincipal;
  companyId: string;
  parentId: string;
  scopeType: unknown;
  name: unknown;
  description?: unknown;
}) {
  const { workspace } = await portalWorkspace(args.principal, args.companyId, true);
  const scopeType = normalizeContextScope(args.scopeType);
  if (!(["PRODUCT", "REQUEST"] as ContextScopeType[]).includes(scopeType)) {
    throw new SupplyPersistenceError("Customers can create product or request scopes.", "forbidden");
  }
  const parent = await prisma.supplyContextNode.findFirst({
    where: { id: args.parentId, officeId: args.principal.officeId, workspaceId: workspace.id, visibility: "SHARED", archivedAt: null },
  });
  if (!parent || !allowedContextChild(normalizeContextScope(parent.scopeType), scopeType)) {
    throw new SupplyPersistenceError("Invalid parent scope.", "invalid_input");
  }
  const name = cleanContextText(args.name, 160);
  if (name.length < 2) throw new SupplyPersistenceError("Context name must contain at least 2 characters.", "invalid_input");
  const node = await prisma.supplyContextNode.create({
    data: {
      officeId: args.principal.officeId,
      workspaceId: workspace.id,
      parentId: parent.id,
      contextKey: newContextKey(scopeType),
      scopeType,
      name,
      description: cleanContextText(args.description, 1_000) || null,
      visibility: "SHARED",
      createdByPortalUserId: args.principal.id,
    },
  });
  await bumpContextVersion(workspace.id, parent.id);
  return node;
}

export async function appendCustomerSupplyContextMessage(args: {
  principal: CustomerPortalPrincipal;
  companyId: string;
  nodeId: string;
  body: unknown;
}) {
  const { workspace } = await portalWorkspace(args.principal, args.companyId, true);
  const node = await prisma.supplyContextNode.findFirst({
    where: { id: args.nodeId, officeId: args.principal.officeId, workspaceId: workspace.id, visibility: "SHARED", archivedAt: null },
  });
  if (!node) throw new SupplyPersistenceError("Context scope not found.", "not_found");
  const body = cleanContextBody(args.body, 12_000);
  if (!body) throw new SupplyPersistenceError("Message is required.", "invalid_input");
  const message = await prisma.supplyContextMessage.create({
    data: {
      officeId: args.principal.officeId,
      workspaceId: workspace.id,
      nodeId: node.id,
      role: "CUSTOMER",
      body,
      visibility: "SHARED",
      createdByPortalUserId: args.principal.id,
    },
  });
  await bumpContextVersion(workspace.id, node.id);
  await emitContextMemory({
    officeId: args.principal.officeId,
    companyId: args.companyId,
    nodeId: node.id,
    recordId: message.id,
    kind: "message",
    title: "customer context message",
    text: body,
    visibility: "SHARED",
    actorType: "customer_portal_user",
    actorId: args.principal.id,
    payload: { workspaceId: workspace.id, nodeId: node.id, messageId: message.id, role: "CUSTOMER" },
  });
  return message;
}

export async function uploadCustomerSupplyContextDocument(args: {
  principal: CustomerPortalPrincipal;
  companyId: string;
  nodeId: string;
  file: File;
}) {
  const { workspace } = await portalWorkspace(args.principal, args.companyId, true);
  const node = await prisma.supplyContextNode.findFirst({
    where: { id: args.nodeId, officeId: args.principal.officeId, workspaceId: workspace.id, visibility: "SHARED", archivedAt: null },
  });
  if (!node) throw new SupplyPersistenceError("Context scope not found.", "not_found");
  const metadata = contextDocumentMetadata(args.file);
  const bytes = Buffer.from(await args.file.arrayBuffer());
  const contentHash = contextDocumentHash(bytes);
  const duplicate = await prisma.supplyContextDocument.findUnique({ where: { workspaceId_contentHash: { workspaceId: workspace.id, contentHash } } });
  if (duplicate) throw new SupplyPersistenceError("This document is already attached to the company context.", "conflict");
  const stored = await storeContextDocumentFile({ officeId: args.principal.officeId, workspaceId: workspace.id, preferredName: metadata.name, bytes, contentType: metadata.mimeType });
  const extraction = await extractContextDocumentText(bytes, metadata.mimeType, metadata.name);
  const document = await prisma.supplyContextDocument.create({
    data: {
      officeId: args.principal.officeId,
      workspaceId: workspace.id,
      nodeId: node.id,
      name: metadata.name,
      storageUrl: stored.url,
      mimeType: metadata.mimeType,
      sizeBytes: metadata.sizeBytes,
      contentHash,
      processingState: extraction.state,
      extractionText: extraction.text,
      extractionError: extraction.error,
      visibility: "SHARED",
      uploadedByPortalUserId: args.principal.id,
    },
  });
  await bumpContextVersion(workspace.id, node.id);
  await emitContextMemory({
    officeId: args.principal.officeId,
    companyId: args.companyId,
    nodeId: node.id,
    recordId: document.id,
    kind: "document",
    title: document.name,
    text: document.extractionText,
    visibility: "SHARED",
    actorType: "customer_portal_user",
    actorId: args.principal.id,
    payload: { workspaceId: workspace.id, nodeId: node.id, documentId: document.id, contentHash, processingState: document.processingState },
  });
  return document;
}
