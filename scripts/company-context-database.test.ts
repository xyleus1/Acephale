import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import {
  appendCompanyContextMessage,
  assembleCompanyContextForAgent,
  loadCompanyContext,
  readCompanyContextDocument,
  uploadCompanyContextDocument,
  uploadCompanyContextDocumentChunk,
} from "../src/lib/company-context";
import type { ProcurementRequestInput } from "../src/lib/procurement-contract";
import {
  confirmCompanyContextProcurementAction,
  createCompanyContextProcurementAction,
  dismissCompanyContextProcurementAction,
  listCompanyContextProcurementActions,
} from "../src/lib/supply-os/context-procurement";
import { createSupplyWorkspace, type SupplyAccessContext } from "../src/lib/supply-os/persistence";

const suffix = randomUUID().slice(0, 8);
let officeId = "";
let foreignOfficeId = "";

async function cleanup() {
  const ids = [officeId, foreignOfficeId].filter(Boolean);
  if (ids.length) await prisma.office.deleteMany({ where: { id: { in: ids } } }).catch(() => undefined);
}

async function main() {
  const previousApiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const office = await prisma.office.create({ data: { name: `Context test ${suffix}` } });
    officeId = office.id;
    const admin = await prisma.user.create({
      data: {
        officeId,
        email: `admin-${suffix}@example.test`,
        passwordHash: "test",
        fullName: "Context Admin",
        role: "ADMIN",
        canViewWholeOffice: true,
      },
    });
    const context: SupplyAccessContext = {
      officeId,
      userId: admin.id,
      role: admin.role,
      canViewWholeOffice: true,
    };
    const company = await prisma.company.create({ data: { officeId, name: `HypnoDreamz ${suffix}` } });
    const workspace = await createSupplyWorkspace(context, { name: company.name, companyId: company.id });

    const uploaded = await uploadCompanyContextDocument({
      context,
      workspaceId: workspace.id,
      file: new File(["part,material\nboard,PC-ABS\n"], "parts.csv", { type: "text/csv" }),
    });
    assert.equal(uploaded.processingState, "READY");
    assert.match(uploaded.summary ?? "", /part,material/);

    const loaded = await loadCompanyContext(context, workspace.id);
    assert.equal(loaded.documents.length, 1);
    assert.equal(loaded.documents[0].name, "parts.csv");
    assert.equal(loaded.documents[0].processingState, "READY");
    assert.equal(loaded.messages.length, 0);

    const operatorMessage = await appendCompanyContextMessage({
      context,
      workspaceId: workspace.id,
      role: "OPERATOR",
      body: "Use the PC-ABS specification.",
    });
    await appendCompanyContextMessage({
      context,
      workspaceId: workspace.id,
      role: "AGENT",
      body: "The document lists PC-ABS.",
      citations: [{ id: `document:${uploaded.id}`, label: "parts.csv" }],
    });
    const reloaded = await loadCompanyContext(context, workspace.id);
    assert.deepEqual(reloaded.messages.map((message) => message.role), ["OPERATOR", "AGENT"]);
    assert.deepEqual(reloaded.messages[1].citations, [{ id: `document:${uploaded.id}`, label: "parts.csv" }]);

    const assembled = await assembleCompanyContextForAgent(context, workspace.id);
    assert.equal(assembled.documents.length, 1);
    assert.match(assembled.documents[0].markdown, /PC-ABS/);
    assert.equal(assembled.messages.length, 2);

    const procurementAction = await createCompanyContextProcurementAction({
      context,
      workspaceId: workspace.id,
      draft: {
        material: "PC-ABS enclosure",
        specification: "Use the attached material requirement.",
        manufacturer: null,
        partNumber: "HD-ENC-01",
        quantity: 100,
        unit: "units",
        neededBy: "2026-09-15",
        deliveryLocation: "Los Angeles, CA",
        notes: "Find qualified suppliers.",
      },
      citations: [
        { id: `message:${operatorMessage.id}`, label: "Operator request" },
        { id: `document:${uploaded.id}`, label: "parts.csv" },
      ],
      requestMessageId: operatorMessage.id,
      requestBody: operatorMessage.body,
      requestCreatedAt: operatorMessage.createdAt,
    });
    assert.equal(procurementAction.status, "PENDING");
    assert.equal((await listCompanyContextProcurementActions(context, workspace.id)).length, 1);

    let submitted: ProcurementRequestInput | null = null;
    let submitCount = 0;
    const confirmationDependencies = {
      assemble: assembleCompanyContextForAgent,
      contextualize: async ({ input }: { session: { userId: string; officeId: string }; input: ProcurementRequestInput }) => ({
        ...input,
        requestContext: { ...input.requestContext, company_context: { version: "company-context-test" } },
      }),
      resolveCustomerId: async () => "11111111-1111-4111-8111-111111111111",
      submit: async (_customerId: string, input: ProcurementRequestInput) => {
        submitCount += 1;
        submitted = input;
        return {
          orderId: "22222222-2222-4222-8222-222222222222",
          status: "new",
          created: true,
          retryWake: false,
          workflowWakeRequested: true,
        };
      },
    };
    const confirmed = await confirmCompanyContextProcurementAction({
      context,
      workspaceId: workspace.id,
      actionId: procurementAction.id,
    }, confirmationDependencies);
    assert.equal(confirmed.status, "CREATED");
    assert.equal(confirmed.order?.id, "22222222-2222-4222-8222-222222222222");
    assert(submitted);
    assert.match(submitted.specification ?? "", /^\[Request-specific procurement context/);
    const specificContext = submitted.requestContext.procurement_context as {
      priority: string;
      documents: Array<{ citation_id: string; markdown: string }>;
      operator_messages: Array<{ citation_id: string; body: string }>;
    };
    assert.equal(specificContext.priority, "request_specific");
    assert.match(specificContext.documents[0]?.markdown ?? "", /PC-ABS/);
    assert.equal(specificContext.operator_messages[0]?.citation_id, `message:${operatorMessage.id}`);
    assert.equal((submitted.requestContext.company_context as { version: string }).version, "company-context-test");
    await confirmCompanyContextProcurementAction({
      context,
      workspaceId: workspace.id,
      actionId: procurementAction.id,
    }, confirmationDependencies);
    assert.equal(submitCount, 1, "A confirmed Context action must not create a second order.");

    const racingAction = await createCompanyContextProcurementAction({
      context,
      workspaceId: workspace.id,
      draft: { ...procurementAction.draft, material: "Race-safe request" },
      citations: [{ id: `message:${operatorMessage.id}`, label: "Operator request" }],
      requestMessageId: operatorMessage.id,
      requestBody: operatorMessage.body,
      requestCreatedAt: operatorMessage.createdAt,
    });
    let releaseSubmit!: () => void;
    let markSubmitStarted!: () => void;
    const submitStarted = new Promise<void>((resolve) => { markSubmitStarted = resolve; });
    const submitRelease = new Promise<void>((resolve) => { releaseSubmit = resolve; });
    const racingConfirmation = confirmCompanyContextProcurementAction({
      context,
      workspaceId: workspace.id,
      actionId: racingAction.id,
    }, {
      ...confirmationDependencies,
      submit: async () => {
        markSubmitStarted();
        await submitRelease;
        return {
          orderId: "33333333-3333-4333-8333-333333333333",
          status: "new",
          created: true,
          retryWake: false,
          workflowWakeRequested: true,
        };
      },
    });
    await submitStarted;
    try {
      await assert.rejects(
        () => dismissCompanyContextProcurementAction({
          context,
          workspaceId: workspace.id,
          actionId: racingAction.id,
        }),
        /being created cannot be dismissed/i,
      );
    } finally {
      releaseSubmit();
    }
    assert.equal((await racingConfirmation).status, "CREATED");

    const dismissibleAction = await createCompanyContextProcurementAction({
      context,
      workspaceId: workspace.id,
      draft: { ...procurementAction.draft, material: "Dismissed request" },
      citations: [{ id: `message:${operatorMessage.id}`, label: "Operator request" }],
      requestMessageId: operatorMessage.id,
      requestBody: operatorMessage.body,
      requestCreatedAt: operatorMessage.createdAt,
    });
    const dismissed = await dismissCompanyContextProcurementAction({
      context,
      workspaceId: workspace.id,
      actionId: dismissibleAction.id,
    });
    assert.equal(dismissed.status, "DISMISSED");

    const original = await readCompanyContextDocument({ context, workspaceId: workspace.id, documentId: uploaded.id });
    assert.equal(original.bytes.toString("utf8"), "part,material\nboard,PC-ABS\n");
    await assert.rejects(
      () => uploadCompanyContextDocument({
        context,
        workspaceId: workspace.id,
        file: new File(["part,material\nboard,PC-ABS\n"], "copy.csv", { type: "text/csv" }),
      }),
      /already attached/i,
    );

    const uploadId = `upload_${randomUUID().replaceAll("-", "")}`;
    const firstChunk = await uploadCompanyContextDocumentChunk({
      context,
      workspaceId: workspace.id,
      uploadId,
      chunkIndex: 0,
      chunkCount: 2,
      fileName: "notes.txt",
      fileType: "text/plain",
      fileSize: 11,
      chunk: new File(["hello "], "notes.txt"),
    });
    assert.equal(firstChunk.complete, false);
    const secondChunk = await uploadCompanyContextDocumentChunk({
      context,
      workspaceId: workspace.id,
      uploadId,
      chunkIndex: 1,
      chunkCount: 2,
      fileName: "notes.txt",
      fileType: "text/plain",
      fileSize: 11,
      chunk: new File(["world"], "notes.txt"),
    });
    assert.equal(secondChunk.complete, true);
    if (!secondChunk.complete) throw new Error("Chunked upload did not finish.");
    const chunkedOriginal = await readCompanyContextDocument({
      context,
      workspaceId: workspace.id,
      documentId: secondChunk.document.id,
    });
    assert.equal(chunkedOriginal.bytes.toString("utf8"), "hello world");
    assert.equal(await prisma.companyDocument.count({
      where: { officeId, companyId: company.id, docType: { startsWith: "company_context_upload_chunk:" } },
    }), 0);

    const foreignOffice = await prisma.office.create({ data: { name: `Foreign context ${suffix}` } });
    foreignOfficeId = foreignOffice.id;
    const foreignUser = await prisma.user.create({
      data: {
        officeId: foreignOffice.id,
        email: `foreign-${suffix}@example.test`,
        passwordHash: "test",
        fullName: "Foreign Admin",
        role: "ADMIN",
        canViewWholeOffice: true,
      },
    });
    const foreignContext: SupplyAccessContext = {
      officeId: foreignOffice.id,
      userId: foreignUser.id,
      role: foreignUser.role,
      canViewWholeOffice: true,
    };
    await assert.rejects(() => loadCompanyContext(foreignContext, workspace.id), /not found/i);
    await assert.rejects(() => listCompanyContextProcurementActions(foreignContext, workspace.id), /not found/i);

    console.log("Company Context database checks passed.");
  } finally {
    if (previousApiKey) process.env.OPENAI_API_KEY = previousApiKey;
    await cleanup();
    await prisma.$disconnect();
  }
}

void main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
