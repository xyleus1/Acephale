import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SupplyPersistenceError, type SupplyAccessContext } from "./persistence";
import { sourcingWorkspaceForTask } from "./sourcing-research-persistence";
import {
  extractSupplierQuoteTerms,
  SUPPLIER_QUOTE_EXTRACTION_CAPABILITY,
  SUPPLIER_QUOTE_EXTRACTION_PROMPT_VERSION,
  SUPPLIER_QUOTE_EXTRACTION_VERSION,
  SupplierQuoteExtractionError,
  type SupplierQuoteExtractionProposal,
  type SupplierQuoteTermExtractor,
} from "./supplier-quote-extraction";
import {
  readConnectedSupplierQuoteAttachments,
  SupplierQuoteAttachmentError,
  type SupplierQuoteAttachmentMetadata,
  type SupplierQuoteAttachmentReader,
} from "./supplier-quote-attachment-text";

const QUOTE_CYCLE_TASK_TYPE = "SUPPLIER_QUOTE_CYCLE";
const PROCUREMENT_CASE_TASK_TYPE = "PROCUREMENT_CASE";
const REPLY_EVIDENCE_KIND = "SUPPLIER_QUOTE_REPLY_EMAIL";
const PROPOSAL_EVIDENCE_KIND = "SUPPLIER_QUOTE_EXTRACTION_PROPOSAL";
const RUN_STALE_AFTER_MS = 120_000;

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function inputJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

function requiredText(value: unknown, label: string, max: number) {
  if (typeof value !== "string") throw new SupplyPersistenceError(`${label} is required.`, "invalid_input");
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > max) {
    throw new SupplyPersistenceError(`${label} must contain 1 to ${max} characters.`, "invalid_input");
  }
  return normalized;
}

function isoDate(value: unknown, label: string) {
  const text = requiredText(value, label, 10);
  const parsed = new Date(`${text}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new SupplyPersistenceError(`${label} must use YYYY-MM-DD.`, "conflict");
  }
  return text;
}

function retryableTransactionError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && (
    error.code === "P2002"
    || error.code === "P2034"
    || (error.code === "P2010" && ["40001", "40P01"].includes(String(record(error.meta).code)))
  );
}

async function withSerializableRetry<T>(operation: () => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!retryableTransactionError(error) || attempt === 2) {
        if (retryableTransactionError(error)) {
          throw new SupplyPersistenceError("Supplier quote extraction changed concurrently. Reload and retry.", "conflict");
        }
        throw error;
      }
    }
  }
  throw new SupplyPersistenceError("Supplier quote extraction could not be saved.", "conflict");
}

async function currentAccessContext(context: SupplyAccessContext): Promise<SupplyAccessContext> {
  const user = await prisma.user.findFirst({
    where: { id: context.userId, officeId: context.officeId, isActive: true },
    select: { role: true, canViewWholeOffice: true },
  });
  if (!user) throw new SupplyPersistenceError("Your current user no longer has access to this office.", "forbidden");
  return { ...context, role: user.role, canViewWholeOffice: user.canViewWholeOffice };
}

async function appendEvent(args: {
  tx: Prisma.TransactionClient;
  executionTaskId: string;
  capabilityRunId: string | null;
  officeId: string;
  workspaceId: string;
  actorUserId: string;
  status: string;
  message: string;
  payload: Prisma.InputJsonObject;
}) {
  const aggregate = await args.tx.supplyExecutionEvent.aggregate({
    where: { executionTaskId: args.executionTaskId },
    _max: { sequence: true },
  });
  const sequence = (aggregate._max.sequence ?? 0) + 1;
  await args.tx.supplyExecutionEvent.create({
    data: {
      officeId: args.officeId,
      workspaceId: args.workspaceId,
      executionTaskId: args.executionTaskId,
      capabilityRunId: args.capabilityRunId,
      actorUserId: args.actorUserId,
      sequence,
      eventType: "SUPPLIER_QUOTE_TERMS_EXTRACTED",
      status: args.status,
      message: args.message,
      payload: args.payload,
      payloadHash: digest(args.payload),
      idempotencyKey: `supplier-quote-terms-extracted:${args.capabilityRunId ?? digest(args.payload)}:${args.executionTaskId}`,
    },
  });
}

type ExtractionSnapshot = {
  quoteCycleId: string;
  procurementCaseId: string;
  sourceEvidenceId: string;
  sourceEvidenceContentHash: string;
  supplierName: string;
  subject: string | null;
  bodyText: string;
  attachmentNames: string[];
  connectedMessage: {
    accountId: string;
    gmailMessageId: string;
    attachments: SupplierQuoteAttachmentMetadata[];
  } | null;
  receivedOn: string;
  requestHash: string;
  requestedUnitOfMeasure: string;
  needBy: string;
};

function attachmentNames(value: unknown) {
  return (Array.isArray(value) ? value : []).slice(0, 25).flatMap((entry) => {
    const name = record(entry).name;
    return typeof name === "string" && name.trim() ? [name.trim().slice(0, 300)] : [];
  });
}

function attachmentMetadata(value: string | null): SupplierQuoteAttachmentMetadata[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 25).flatMap((entry) => {
      const attachment = record(entry);
      const name = typeof attachment.filename === "string"
        ? attachment.filename
        : typeof attachment.name === "string"
          ? attachment.name
          : null;
      if (!name?.trim()) return [];
      return [{
        attachmentId: typeof attachment.attachmentId === "string" && attachment.attachmentId.trim()
          ? attachment.attachmentId.trim().slice(0, 1_000)
          : null,
        name: name.trim().slice(0, 300),
        mimeType: typeof attachment.mimeType === "string" ? attachment.mimeType.trim().slice(0, 160) : null,
        size: typeof attachment.size === "number" && Number.isFinite(attachment.size) && attachment.size >= 0
          ? attachment.size
          : null,
      }];
    });
  } catch {
    return [];
  }
}

async function loadExtractionSnapshot(args: {
  context: SupplyAccessContext;
  workspaceId: string;
  quoteCycleId: string;
  sourceEvidenceId: string;
}) {
  const quoteCycle = await prisma.supplyExecutionTask.findFirst({
    where: {
      id: args.quoteCycleId,
      officeId: args.context.officeId,
      workspaceId: args.workspaceId,
      taskType: QUOTE_CYCLE_TASK_TYPE,
      status: "RUNNING",
      parentTask: { taskType: PROCUREMENT_CASE_TASK_TYPE, status: "PLANNED" },
    },
    select: { id: true, parentTaskId: true, input: true, result: true },
  });
  if (!quoteCycle?.parentTaskId) throw new SupplyPersistenceError("A released supplier quote cycle was not found.", "not_found");
  const cycleResult = record(quoteCycle.result);
  const cycleInput = record(quoteCycle.input);
  const request = record(cycleResult.request);
  const replies = Array.isArray(cycleResult.connectedReplies) ? cycleResult.connectedReplies.map((entry) => record(entry)) : [];
  if (!replies.some((reply) => reply.evidenceId === args.sourceEvidenceId)) {
    throw new SupplyPersistenceError("Connected supplier reply evidence is outside the current quote cycle.", "conflict");
  }
  const evidence = await prisma.supplyEvidence.findFirst({
    where: {
      id: args.sourceEvidenceId,
      officeId: args.context.officeId,
      workspaceId: args.workspaceId,
      executionTaskId: quoteCycle.id,
      kind: REPLY_EVIDENCE_KIND,
      sourceType: "CONNECTED_PROVIDER",
    },
    select: { id: true, sourceUri: true, contentHash: true, payload: true, observedAt: true },
  });
  if (!evidence?.sourceUri || !evidence.contentHash || !evidence.observedAt) {
    throw new SupplyPersistenceError("Connected supplier reply evidence is incomplete.", "conflict");
  }
  const payload = record(evidence.payload);
  const bodyText = typeof payload.bodyText === "string" ? payload.bodyText.slice(0, 50_000) : "";
  const subject = typeof payload.subject === "string" ? payload.subject.slice(0, 500) : null;
  const names = attachmentNames(payload.attachments);
  let connectedMessage: ExtractionSnapshot["connectedMessage"] = null;
  if (names.length) {
    const localMessageId = requiredText(payload.localMessageId, "Connected supplier reply message", 220);
    const providerMessageId = requiredText(payload.providerMessageId, "Connected supplier provider message", 220);
    const message = await prisma.emailMessage.findFirst({
      where: {
        id: localMessageId,
        gmailMessageId: providerMessageId,
        account: { officeId: args.context.officeId, provider: "GMAIL", isActive: true },
      },
      select: { accountId: true, gmailMessageId: true, attachments: true },
    });
    if (!message?.accountId || !message.gmailMessageId) {
      throw new SupplyPersistenceError("The connected supplier attachment message is unavailable or its Gmail account is inactive.", "conflict");
    }
    connectedMessage = {
      accountId: message.accountId,
      gmailMessageId: message.gmailMessageId,
      attachments: attachmentMetadata(message.attachments).filter((attachment) => names.includes(attachment.name)),
    };
  }
  const supplier = record(cycleInput.supplier);
  return {
    quoteCycleId: quoteCycle.id,
    procurementCaseId: quoteCycle.parentTaskId,
    sourceEvidenceId: evidence.id,
    sourceEvidenceContentHash: evidence.contentHash,
    supplierName: requiredText(supplier.name, "Supplier name", 300),
    subject,
    bodyText,
    attachmentNames: names,
    connectedMessage,
    receivedOn: evidence.observedAt.toISOString().slice(0, 10),
    requestHash: requiredText(cycleResult.requestHash, "Quote request hash", 128),
    requestedUnitOfMeasure: requiredText(request.unitOfMeasure, "Requested unit", 20).toUpperCase(),
    needBy: isoDate(request.needBy, "Quote request need-by date"),
  } satisfies ExtractionSnapshot;
}

function runInput(snapshot: ExtractionSnapshot) {
  return {
    quoteCycleId: snapshot.quoteCycleId,
    procurementCaseId: snapshot.procurementCaseId,
    sourceEvidenceId: snapshot.sourceEvidenceId,
    sourceEvidenceContentHash: snapshot.sourceEvidenceContentHash,
    requestHash: snapshot.requestHash,
    requestedUnitOfMeasure: snapshot.requestedUnitOfMeasure,
    needBy: snapshot.needBy,
    receivedOn: snapshot.receivedOn,
    connectedMessage: snapshot.connectedMessage ? {
      accountId: snapshot.connectedMessage.accountId,
      gmailMessageId: snapshot.connectedMessage.gmailMessageId,
      attachments: snapshot.connectedMessage.attachments,
    } : null,
    extractorVersion: SUPPLIER_QUOTE_EXTRACTION_VERSION,
    promptVersion: SUPPLIER_QUOTE_EXTRACTION_PROMPT_VERSION,
  };
}

async function claimRun(args: {
  context: SupplyAccessContext;
  workspaceId: string;
  snapshot: ExtractionSnapshot;
}) {
  const input = runInput(args.snapshot);
  const inputHash = digest(input);
  const scopeKey = `supplier-quote-extraction:${args.snapshot.sourceEvidenceId}:${inputHash}`;
  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`
      SELECT "id"
      FROM "SupplyCapabilityRun"
      WHERE "officeId" = ${args.context.officeId}
        AND "workspaceId" = ${args.workspaceId}
        AND "executionTaskId" = ${args.snapshot.quoteCycleId}
        AND "capabilityKey" = ${SUPPLIER_QUOTE_EXTRACTION_CAPABILITY}
        AND "capabilityVersion" = ${SUPPLIER_QUOTE_EXTRACTION_VERSION}
        AND "inputHash" = ${inputHash}
      ORDER BY "createdAt", "id"
      FOR UPDATE
    `);
    const existing = await tx.supplyCapabilityRun.findMany({
      where: {
        officeId: args.context.officeId,
        workspaceId: args.workspaceId,
        executionTaskId: args.snapshot.quoteCycleId,
        capabilityKey: SUPPLIER_QUOTE_EXTRACTION_CAPABILITY,
        capabilityVersion: SUPPLIER_QUOTE_EXTRACTION_VERSION,
        inputHash,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, officeId: true, executionTaskId: true, status: true, inputHash: true, output: true, startedAt: true },
    });
    const completed = existing.find((run) => run.status === "SUCCEEDED");
    if (completed) {
      if (!completed.output) throw new SupplyPersistenceError("Stored quote extraction output is incomplete.", "conflict");
      return { run: completed, claimed: false as const };
    }
    const staleStartedAt = new Date(Date.now() - RUN_STALE_AFTER_MS);
    const active = existing.find((run) => run.status === "RUNNING");
    if (active?.startedAt && active.startedAt > staleStartedAt) {
      throw new SupplyPersistenceError("Supplier quote extraction is already running for this reply.", "conflict");
    }
    if (active) {
      await tx.supplyCapabilityRun.update({
        where: { id: active.id },
        data: {
          status: "CANCELLED",
          error: inputJson({ message: "The previous extraction attempt stopped before completion." }),
          cancelledAt: new Date(),
        },
      });
    }
    const queued = existing.find((run) => run.status === "QUEUED");
    const candidate = queued ?? await tx.supplyCapabilityRun.create({
      data: {
        officeId: args.context.officeId,
        workspaceId: args.workspaceId,
        executionTaskId: args.snapshot.quoteCycleId,
        invokedByUserId: args.context.userId,
        parentRunId: existing[0]?.id ?? null,
        capabilityKey: SUPPLIER_QUOTE_EXTRACTION_CAPABILITY,
        capabilityVersion: SUPPLIER_QUOTE_EXTRACTION_VERSION,
        dslName: "supplier_quote_reply_review",
        dslVersion: "2",
        input: inputJson(input),
        inputHash,
        idempotencyKey: `${scopeKey}:attempt:${existing.length + 1}`,
      },
      select: { id: true, officeId: true, executionTaskId: true, status: true, inputHash: true, output: true, startedAt: true },
    });
    const claim = await tx.supplyCapabilityRun.updateMany({
      where: {
        id: candidate.id,
        officeId: args.context.officeId,
        workspaceId: args.workspaceId,
        status: "QUEUED",
      },
      data: {
        status: "RUNNING",
        startedAt: new Date(),
        completedAt: null,
        failedAt: null,
        cancelledAt: null,
        error: Prisma.DbNull,
      },
    });
    if (claim.count !== 1) throw new SupplyPersistenceError("Supplier quote extraction changed concurrently. Reload and retry.", "conflict");
    const run = await tx.supplyCapabilityRun.findUniqueOrThrow({
      where: { id: candidate.id },
      select: { id: true, officeId: true, executionTaskId: true, status: true, inputHash: true, output: true, startedAt: true },
    });
    return { run, claimed: true as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

async function failRun(runId: string, officeId: string, workspaceId: string, message: string) {
  await prisma.supplyCapabilityRun.updateMany({
    where: { id: runId, officeId, workspaceId, status: "RUNNING" },
    data: {
      status: "FAILED",
      error: inputJson({ message: message.replace(/\u2014/g, "-").slice(0, 300) }),
      failedAt: new Date(),
    },
  });
}

export async function extractConnectedSupplierQuoteTerms(args: {
  context: SupplyAccessContext;
  quoteCycleId: string;
  sourceEvidenceId: string;
  extractor?: SupplierQuoteTermExtractor;
  attachmentReader?: SupplierQuoteAttachmentReader;
}) {
  const accessContext = await currentAccessContext(args.context);
  const workspace = await sourcingWorkspaceForTask(accessContext, args.quoteCycleId, "edit", [QUOTE_CYCLE_TASK_TYPE]);
  const quoteCycleId = requiredText(args.quoteCycleId, "Quote cycle ID", 220);
  const sourceEvidenceId = requiredText(args.sourceEvidenceId, "Supplier reply evidence ID", 220);
  const snapshot = await loadExtractionSnapshot({ context: accessContext, workspaceId: workspace.id, quoteCycleId, sourceEvidenceId });
  const claimed = await claimRun({ context: accessContext, workspaceId: workspace.id, snapshot });
  if (!claimed.claimed) return claimed.run;

  let attachmentRead = { sources: [], warnings: [] } as Awaited<ReturnType<SupplierQuoteAttachmentReader>>;
  if (snapshot.connectedMessage?.attachments.length) {
    try {
      attachmentRead = await (args.attachmentReader ?? readConnectedSupplierQuoteAttachments)(snapshot.connectedMessage);
    } catch (error) {
      const message = error instanceof SupplierQuoteAttachmentError
        ? error.message
        : "Supplier quote attachment extraction failed. Retry or review the attachment manually.";
      await failRun(claimed.run.id, accessContext.officeId, workspace.id, message);
      throw new SupplyPersistenceError(message, "conflict");
    }
  }

  let proposal: SupplierQuoteExtractionProposal;
  try {
    proposal = await (args.extractor ?? extractSupplierQuoteTerms)({
      subject: snapshot.subject,
      bodyText: snapshot.bodyText,
      attachmentNames: snapshot.attachmentNames,
      attachmentSources: attachmentRead.sources,
      attachmentWarnings: attachmentRead.warnings,
      receivedOn: snapshot.receivedOn,
      requestedUnitOfMeasure: snapshot.requestedUnitOfMeasure,
      needBy: snapshot.needBy,
    });
  } catch (error) {
    const message = error instanceof SupplierQuoteExtractionError
      ? error.message
      : "Supplier quote extraction failed. Retry or enter the terms manually.";
    await failRun(claimed.run.id, accessContext.officeId, workspace.id, message);
    throw new SupplyPersistenceError(message, "conflict");
  }

  try {
    const completionContext = await currentAccessContext(accessContext);
    const completionWorkspace = await sourcingWorkspaceForTask(completionContext, args.quoteCycleId, "edit", [QUOTE_CYCLE_TASK_TYPE]);
    if (completionWorkspace.id !== workspace.id) {
      throw new SupplyPersistenceError("Your Supply OS workspace access changed during quote extraction.", "forbidden");
    }
  } catch (error) {
    await failRun(claimed.run.id, accessContext.officeId, workspace.id, "Supply OS access changed during supplier quote extraction.");
    if (error instanceof SupplyPersistenceError) throw error;
    throw new SupplyPersistenceError("Your Supply OS access changed during supplier quote extraction.", "forbidden");
  }

  const attachmentSourceReferences = attachmentRead.sources.map((source) => ({
    sourceId: source.sourceId,
    name: source.name,
    contentHash: source.contentHash,
  }));
  const proposalHash = digest({ inputHash: claimed.run.inputHash, proposal, attachmentSources: attachmentSourceReferences });
  const completion = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${snapshot.procurementCaseId} AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyExecutionTask" WHERE "id" = ${snapshot.quoteCycleId} AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SupplyCapabilityRun" WHERE "id" = ${claimed.run.id} AND "officeId" = ${accessContext.officeId} AND "workspaceId" = ${workspace.id} FOR UPDATE`);
    const [currentCase, currentCycle, currentEvidence, currentRun, currentConnectedMessage] = await Promise.all([
      tx.supplyExecutionTask.findFirst({ where: { id: snapshot.procurementCaseId, officeId: accessContext.officeId, workspaceId: workspace.id, taskType: PROCUREMENT_CASE_TASK_TYPE, status: "PLANNED" }, select: { id: true, result: true } }),
      tx.supplyExecutionTask.findFirst({ where: { id: snapshot.quoteCycleId, officeId: accessContext.officeId, workspaceId: workspace.id, taskType: QUOTE_CYCLE_TASK_TYPE, status: "RUNNING" }, select: { id: true, result: true } }),
      tx.supplyEvidence.findFirst({ where: { id: snapshot.sourceEvidenceId, officeId: accessContext.officeId, workspaceId: workspace.id, executionTaskId: snapshot.quoteCycleId, kind: REPLY_EVIDENCE_KIND }, select: { id: true, contentHash: true } }),
      tx.supplyCapabilityRun.findFirst({ where: { id: claimed.run.id, officeId: accessContext.officeId, workspaceId: workspace.id, executionTaskId: snapshot.quoteCycleId, status: "RUNNING" } }),
      snapshot.connectedMessage
        ? tx.emailMessage.findFirst({
            where: {
              accountId: snapshot.connectedMessage.accountId,
              gmailMessageId: snapshot.connectedMessage.gmailMessageId,
              account: { officeId: accessContext.officeId, provider: "GMAIL", isActive: true },
            },
            select: { attachments: true },
          })
        : Promise.resolve(null),
    ]);
    const currentCycleResult = record(currentCycle?.result);
    const currentReplies = Array.isArray(currentCycleResult.connectedReplies) ? currentCycleResult.connectedReplies.map((entry) => record(entry)) : [];
    if (!currentCase
      || !currentCycle
      || currentEvidence?.contentHash !== snapshot.sourceEvidenceContentHash
      || currentRun?.inputHash !== claimed.run.inputHash
      || currentCycleResult.requestHash !== snapshot.requestHash
      || (snapshot.connectedMessage && (
        !currentConnectedMessage
        || digest(attachmentMetadata(currentConnectedMessage.attachments)) !== digest(snapshot.connectedMessage.attachments)
      ))
      || !currentReplies.some((reply) => reply.evidenceId === snapshot.sourceEvidenceId)) {
      await tx.supplyCapabilityRun.updateMany({
        where: { id: claimed.run.id, status: "RUNNING" },
        data: { status: "CANCELLED", error: inputJson({ message: "Supplier reply or quote request changed during extraction." }), cancelledAt: new Date() },
      });
      return { stale: true as const, run: null };
    }
    const now = new Date();
    const evidenceKey = `supplier_quote_extraction:${claimed.run.id}:${proposalHash}`;
    const proposalEvidence = await tx.supplyEvidence.upsert({
      where: { workspaceId_evidenceKey: { workspaceId: workspace.id, evidenceKey } },
      create: {
        officeId: accessContext.officeId,
        workspaceId: workspace.id,
        capabilityRunId: claimed.run.id,
        executionTaskId: snapshot.quoteCycleId,
        createdByUserId: accessContext.userId,
        evidenceKey,
        kind: PROPOSAL_EVIDENCE_KIND,
        sourceType: "MODEL_DERIVED_PROPOSAL",
        sourceRecordId: snapshot.sourceEvidenceId,
        sourceVersion: SUPPLIER_QUOTE_EXTRACTION_VERSION,
        title: `Quote term proposal for ${snapshot.supplierName}`,
        excerpt: proposal.state === "PROPOSED" ? "Commercial terms extracted for operator review." : "No supported commercial terms were found in available connected text sources.",
        payload: inputJson({
          sourceEvidenceId: snapshot.sourceEvidenceId,
          inputHash: claimed.run.inputHash,
          proposalHash,
          proposal,
          attachmentSources: attachmentSourceReferences,
        }),
        contentHash: proposalHash,
        observedAt: now,
      },
      update: {},
      select: { id: true, officeId: true, executionTaskId: true, capabilityRunId: true, contentHash: true },
    });
    if (proposalEvidence.officeId !== accessContext.officeId
      || proposalEvidence.executionTaskId !== snapshot.quoteCycleId
      || proposalEvidence.capabilityRunId !== claimed.run.id
      || proposalEvidence.contentHash !== proposalHash) {
      throw new SupplyPersistenceError("Stored quote extraction evidence conflicts with this supplier reply.", "conflict");
    }
    const output = {
      sourceEvidenceId: snapshot.sourceEvidenceId,
      proposalEvidenceId: proposalEvidence.id,
      proposalHash,
      proposal,
      attachmentSources: attachmentSourceReferences,
      extractedByUserId: accessContext.userId,
      extractedAt: now.toISOString(),
    };
    const run = await tx.supplyCapabilityRun.update({
      where: { id: claimed.run.id },
      data: { status: "SUCCEEDED", output: inputJson(output), outputHash: digest(output), completedAt: now, error: Prisma.DbNull },
      select: { id: true, status: true, inputHash: true, output: true, outputHash: true, completedAt: true },
    });
    const caseResult = record(currentCase.result);
    const caseQuoteCycle = record(caseResult.quoteCycle);
    const nextCaseResult = {
      ...caseResult,
      quoteCycle: { ...caseQuoteCycle, lastExtractionAt: now.toISOString(), updatedAt: now.toISOString() },
      updatedAt: now.toISOString(),
    };
    await tx.supplyExecutionTask.update({ where: { id: currentCase.id }, data: { result: inputJson(nextCaseResult), resultHash: digest(nextCaseResult) } });
    const payload = inputJson({ quoteCycleId: snapshot.quoteCycleId, sourceEvidenceId: snapshot.sourceEvidenceId, proposalEvidenceId: proposalEvidence.id, proposalHash, state: proposal.state });
    await appendEvent({ tx, executionTaskId: snapshot.quoteCycleId, capabilityRunId: claimed.run.id, officeId: accessContext.officeId, workspaceId: workspace.id, actorUserId: accessContext.userId, status: "RUNNING", message: proposal.state === "PROPOSED" ? "Supplier quote terms are ready for operator review." : "No supported quote terms were found in available connected text sources.", payload });
    await appendEvent({ tx, executionTaskId: currentCase.id, capabilityRunId: null, officeId: accessContext.officeId, workspaceId: workspace.id, actorUserId: accessContext.userId, status: "PLANNED", message: proposal.state === "PROPOSED" ? "Extracted supplier quote terms require operator review." : "Supplier reply requires manual commercial review.", payload });
    return { stale: false as const, run };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  if (completion.stale || !completion.run) {
    throw new SupplyPersistenceError("Supplier reply or quote request changed during extraction. Reload and retry.", "conflict");
  }
  return completion.run;
}

export async function listSupplierQuoteExtractionRuns(args: {
  context: SupplyAccessContext;
  workspaceId: string;
  quoteCycleIds: string[];
}) {
  if (!args.quoteCycleIds.length) return [];
  return prisma.supplyCapabilityRun.findMany({
    where: {
      officeId: args.context.officeId,
      workspaceId: args.workspaceId,
      executionTaskId: { in: args.quoteCycleIds },
      capabilityKey: SUPPLIER_QUOTE_EXTRACTION_CAPABILITY,
      status: "SUCCEEDED",
    },
    orderBy: [{ completedAt: "desc" }, { id: "desc" }],
    select: { id: true, executionTaskId: true, inputHash: true, output: true, outputHash: true, completedAt: true },
  });
}
