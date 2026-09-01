import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import {
  appendCompanyContextMessage,
  assembleCompanyContextForAgent,
  createCompanyContextChatThread,
  deleteCompanyContextChatThread,
  deleteCompanyContextMemory,
  renameDefaultCompanyContextChatThread,
  saveCompanyContextMemory,
  loadCompanyContext,
  loadCompanyContextActivity,
  readCompanyContextDocument,
  uploadCompanyContextDocument,
  uploadCompanyContextDocumentChunk,
} from "../src/lib/company-context";
import type { ProcurementRequestInput } from "../src/lib/procurement-contract";
import { contextDocumentHash } from "../src/lib/supply-os/context-documents";
import { loadInquiryStrategyInput } from "../src/lib/commercial-strategy-persistence";
import { getCustomerDossier } from "../src/lib/memory/customer-dossier";
import {
  confirmCompanyContextProcurementAction,
  createCompanyContextProcurementAction,
  createCompanyContextProcurementActions,
  dismissCompanyContextProcurementAction,
  hideCompanyContextProcurementAction,
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
    const office = await prisma.office.create({
      data: { name: `Context test ${suffix}`, pricingTargetMarginPct: 12.5 },
    });
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
    const inquiry = await prisma.inquiry.create({
      data: { officeId, companyId: company.id, subject: "Pricing policy runtime check" },
    });
    const strategyInput = await loadInquiryStrategyInput(officeId, inquiry.id);
    assert.deepEqual(strategyInput?.marginPolicy, {
      targetMarginPct: 12.5,
      minMarginPct: 10,
      stretchMarginPct: 19.5,
    });
    const workspace = await createSupplyWorkspace(context, { name: company.name, companyId: company.id });
    const item = await prisma.item.create({
      data: { officeId, companyId: company.id, name: "PC-ABS enclosure", sku: `ENC-${suffix}` },
    });

    const uploaded = await uploadCompanyContextDocument({
      context,
      workspaceId: workspace.id,
      itemId: item.id,
      file: new File(["part,material\nboard,PC-ABS\n"], "parts.csv", { type: "text/csv" }),
    });
    assert.equal(uploaded.processingState, "READY");
    assert.match(uploaded.summary ?? "", /part,material/);

    const loaded = await loadCompanyContext(context, workspace.id);
    assert.equal(loaded.documents.length, 1);
    assert.equal(loaded.documents[0].name, "parts.csv");
    assert.equal(loaded.documents[0].itemId, item.id);
    assert.equal(loaded.documents[0].itemName, item.name);
    assert.equal(loaded.documents[0].processingState, "READY");
    assert.equal(loaded.messages.length, 0);
    const dossier = await getCustomerDossier({ officeId, companyId: company.id, limit: 10 });
    assert.equal(dossier.found, true);
    if (!dossier.found) throw new Error("Customer dossier was not found.");
    assert.ok(dossier.recent_documents.company_documents.some((document) => (
      document.id === uploaded.id
        && document.itemId === item.id
        && document.kind === "DOCUMENT"
    )));

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

    const savedMemory = await saveCompanyContextMemory({
      context,
      workspaceId: workspace.id,
      notes: ["Prefers replies in Turkish.", "Prefers replies in Turkish.", "", 42],
    });
    assert.equal(savedMemory.saved.length, 1);
    assert.equal(savedMemory.skippedExisting, 1);
    assert.equal(savedMemory.droppedForCapacity, 0);
    assert.equal(savedMemory.saved[0].note, "Prefers replies in Turkish.");
    const duplicateMemory = await saveCompanyContextMemory({
      context,
      workspaceId: workspace.id,
      notes: ["prefers replies in turkish."],
    });
    assert.equal(duplicateMemory.saved.length, 0);
    assert.equal(duplicateMemory.skippedExisting, 1);
    const memoryLoaded = await loadCompanyContext(context, workspace.id);
    assert.deepEqual(memoryLoaded.memory.map((entry) => entry.note), ["Prefers replies in Turkish."]);
    const memoryAssembled = await assembleCompanyContextForAgent(context, workspace.id);
    assert.deepEqual(memoryAssembled.memory.map((entry) => entry.note), ["Prefers replies in Turkish."]);
    await deleteCompanyContextMemory({ context, workspaceId: workspace.id, memoryId: savedMemory.saved[0].id });
    const memoryCleared = await loadCompanyContext(context, workspace.id);
    assert.equal(memoryCleared.memory.length, 0);
    await assert.rejects(
      () => deleteCompanyContextMemory({ context, workspaceId: workspace.id, memoryId: savedMemory.saved[0].id }),
      /not found/i,
    );
    const keptMemory = await saveCompanyContextMemory({
      context,
      workspaceId: workspace.id,
      notes: ["Ships only via sea freight."],
    });
    assert.equal(keptMemory.saved.length, 1);

    const defaultThread = await createCompanyContextChatThread({ context, workspaceId: workspace.id, title: "" });
    assert.equal(defaultThread.title, "New chat");
    await renameDefaultCompanyContextChatThread({
      context,
      workspaceId: workspace.id,
      threadId: defaultThread.id,
      title: "PC-ABS enclosure sourcing",
    });
    await renameDefaultCompanyContextChatThread({
      context,
      workspaceId: workspace.id,
      threadId: defaultThread.id,
      title: "Should not overwrite",
    });
    const renamedThread = await prisma.companyContext.findUnique({ where: { id: defaultThread.id }, select: { name: true } });
    assert.equal(renamedThread?.name, "PC-ABS enclosure sourcing", "Rename applies once, only while the title is still New chat.");

    const disposableThread = await createCompanyContextChatThread({ context, workspaceId: workspace.id, title: "Disposable" });
    await appendCompanyContextMessage({
      context,
      workspaceId: workspace.id,
      role: "OPERATOR",
      body: "Message inside disposable thread.",
      threadId: disposableThread.id,
    });
    const keptMessage = await appendCompanyContextMessage({
      context,
      workspaceId: workspace.id,
      role: "OPERATOR",
      body: "Message inside kept thread.",
      threadId: defaultThread.id,
    });
    await deleteCompanyContextChatThread({ context, workspaceId: workspace.id, threadId: disposableThread.id });
    const afterThreadDelete = await loadCompanyContext(context, workspace.id);
    assert.ok(!afterThreadDelete.threads.some((thread) => thread.id === disposableThread.id), "Deleted thread must disappear.");
    assert.ok(afterThreadDelete.threads.some((thread) => thread.id === defaultThread.id), "Other threads must remain.");
    assert.ok(
      !afterThreadDelete.messages.some((entry) => entry.threadId === disposableThread.id),
      "Messages of a deleted thread must be removed.",
    );
    assert.ok(
      afterThreadDelete.messages.some((entry) => entry.id === keptMessage.id),
      "Messages in other threads must be kept.",
    );
    assert.equal(afterThreadDelete.documents.length, 1, "Deleting a chat must not delete documents.");
    await assert.rejects(
      () => deleteCompanyContextChatThread({ context, workspaceId: workspace.id, threadId: disposableThread.id }),
      /not found/i,
    );
    await assert.rejects(
      () => deleteCompanyContextChatThread({ context, workspaceId: workspace.id, threadId: "" }),
      /invalid/i,
    );
    await assert.rejects(
      () => appendCompanyContextMessage({
        context,
        workspaceId: workspace.id,
        role: "OPERATOR",
        body: "Late reply after deletion.",
        threadId: disposableThread.id,
      }),
      /not found/i,
      "A deleted thread must not accept new messages.",
    );

    const threadA = await createCompanyContextChatThread({ context, workspaceId: workspace.id, title: "Thread A" });
    const threadB = await createCompanyContextChatThread({ context, workspaceId: workspace.id, title: "Thread B" });

    const firstQuestion = await appendCompanyContextMessage({
      context,
      workspaceId: workspace.id,
      role: "AGENT",
      body: "Which grade of PC-ABS?",
      threadId: threadA.id,
      questions: [{ question: "Which grade of PC-ABS?", kind: "options", options: ["FR40", "FR60"] }],
    });
    await appendCompanyContextMessage({
      context,
      workspaceId: workspace.id,
      role: "AGENT",
      body: "Which port should the foam ship from?",
      threadId: threadB.id,
      questions: [{ question: "Which port should the foam ship from?", kind: "yes_no", options: [] }],
    });
    assert.deepEqual(
      await loadCompanyContextActivity(context, workspace.id).then((activity) => activity.openQuestions),
      2,
      "An unanswered question in an older thread must still count.",
    );
    await prisma.companyContext.createMany({
      data: Array.from({ length: 210 }, (_, index) => ({
        officeId,
        companyId: company.id,
        kind: "MESSAGE",
        name: `Chat message ${index}`,
        markdown: `Noise ${index}`,
        payload: { role: "OPERATOR", citations: [], threadId: "thread-c", questions: [] },
        createdByUserId: admin.id,
      })),
    });
    assert.deepEqual(
      await loadCompanyContextActivity(context, workspace.id).then((activity) => activity.openQuestions),
      2,
      "Newer traffic in another thread must not push older questions out of the count.",
    );
    await appendCompanyContextMessage({
      context,
      workspaceId: workspace.id,
      role: "OPERATOR",
      body: "FR60.",
      threadId: threadA.id,
    });
    const afterAnswer = await loadCompanyContextActivity(context, workspace.id);
    assert.equal(afterAnswer.openQuestions, 1, "Answering one thread must not clear the other thread's question.");
    assert.ok(afterAnswer.lastAgentMessageAt && afterAnswer.lastAgentMessageAt >= firstQuestion.createdAt);

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

    assert.deepEqual(await createCompanyContextProcurementActions({
      context,
      workspaceId: workspace.id,
      items: [],
      requestMessageId: operatorMessage.id,
      requestBody: operatorMessage.body,
      requestCreatedAt: operatorMessage.createdAt,
    }), []);
    const separateActions = await createCompanyContextProcurementActions({
      context,
      workspaceId: workspace.id,
      items: [{
        draft: { ...procurementAction.draft, material: "Rigid PCBA", specification: "Four-layer board" },
        citations: [{ id: `document:${uploaded.id}`, label: "parts.csv" }],
      }, {
        draft: { ...procurementAction.draft, material: "Memory foam casting", specification: "Mold and cast foam" },
        citations: [{ id: `message:${operatorMessage.id}`, label: "Operator request" }],
      }],
      requestMessageId: operatorMessage.id,
      requestBody: operatorMessage.body,
      requestCreatedAt: operatorMessage.createdAt,
    });
    assert.equal(separateActions.length, 2);
    assert.deepEqual(separateActions.map((action) => action.draft.material), ["Rigid PCBA", "Memory foam casting"]);
    assert.deepEqual(separateActions[0]?.citations, [{ id: `document:${uploaded.id}`, label: "parts.csv" }]);
    assert.deepEqual(separateActions[1]?.citations, [{ id: `message:${operatorMessage.id}`, label: "Operator request" }]);
    assert.equal((await listCompanyContextProcurementActions(context, workspace.id)).length, 3);

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

    await assert.rejects(
      () => hideCompanyContextProcurementAction({
        context,
        workspaceId: workspace.id,
        actionId: dismissibleAction.id,
      }),
      /Only a created procurement request can be hidden/i,
    );
    const hidden = await hideCompanyContextProcurementAction({
      context,
      workspaceId: workspace.id,
      actionId: procurementAction.id,
    });
    assert.equal(hidden.status, "CREATED");
    assert(hidden.hiddenAt, "Hiding a created procurement request must record hiddenAt.");
    const hiddenAgain = await hideCompanyContextProcurementAction({
      context,
      workspaceId: workspace.id,
      actionId: procurementAction.id,
    });
    assert.equal(hiddenAgain.hiddenAt, hidden.hiddenAt, "Hiding twice must be idempotent.");
    const listedActions = await listCompanyContextProcurementActions(context, workspace.id);
    const hiddenListed = listedActions.find((entry) => entry.id === procurementAction.id);
    assert.equal(hiddenListed?.status, "CREATED", "A hidden request must stay listed with its status.");
    assert(hiddenListed?.hiddenAt, "A hidden request must persist hiddenAt across reads.");

    const concurrentHideAction = await createCompanyContextProcurementAction({
      context,
      workspaceId: workspace.id,
      draft: { ...procurementAction.draft, material: "Concurrent hide request" },
      citations: [{ id: `message:${operatorMessage.id}`, label: "Operator request" }],
      requestMessageId: operatorMessage.id,
      requestBody: operatorMessage.body,
      requestCreatedAt: operatorMessage.createdAt,
    });
    await confirmCompanyContextProcurementAction({
      context,
      workspaceId: workspace.id,
      actionId: concurrentHideAction.id,
    }, confirmationDependencies);
    const concurrentHides = await Promise.all([
      hideCompanyContextProcurementAction({ context, workspaceId: workspace.id, actionId: concurrentHideAction.id }),
      hideCompanyContextProcurementAction({ context, workspaceId: workspace.id, actionId: concurrentHideAction.id }),
    ]);
    assert(concurrentHides[0].hiddenAt, "Concurrent hides must record hiddenAt.");
    assert.equal(
      concurrentHides[0].hiddenAt,
      concurrentHides[1].hiddenAt,
      "Concurrent hides must return one identical hiddenAt timestamp.",
    );
    const concurrentListed = await listCompanyContextProcurementActions(context, workspace.id);
    assert.equal(
      concurrentListed.find((entry) => entry.id === concurrentHideAction.id)?.hiddenAt,
      concurrentHides[0].hiddenAt,
      "Persistence must retain the single hiddenAt from concurrent hides.",
    );

    const newerDismissedActions = await createCompanyContextProcurementActions({
      context,
      workspaceId: workspace.id,
      items: Array.from({ length: 55 }, (_, index) => ({
        draft: { ...procurementAction.draft, material: `Bulk dismissed request ${index + 1}` },
        citations: [{ id: `message:${operatorMessage.id}`, label: "Operator request" }],
      })),
      requestMessageId: operatorMessage.id,
      requestBody: operatorMessage.body,
      requestCreatedAt: operatorMessage.createdAt,
    });
    for (const bulkAction of newerDismissedActions) {
      await dismissCompanyContextProcurementAction({
        context,
        workspaceId: workspace.id,
        actionId: bulkAction.id,
      });
    }
    const listAfterBulkDismiss = await listCompanyContextProcurementActions(context, workspace.id);
    assert(
      listAfterBulkDismiss.some((entry) => entry.id === separateActions[0]?.id),
      "Older visible requests must stay listed when newer dismissed rows exceed the page size.",
    );

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
    assert.equal(await prisma.companyContext.count({
      where: { officeId, companyId: company.id, kind: "UPLOAD_CHUNK" },
    }), 0);

    const restoredBytes = Buffer.from("part,material\ninsert,memory foam\n");
    const restoredHash = contextDocumentHash(restoredBytes);
    const placeholder = await prisma.companyContext.create({
      data: {
        officeId,
        companyId: company.id,
        itemId: item.id,
        kind: "DOCUMENT",
        name: "restored.csv",
        storageUrl: "metadata-only://company-context/source-restored-document",
        mimeType: "text/csv",
        contentHash: null,
        markdown: "# Restored placeholder",
        processingState: "READY",
        payload: {
          importSource: {
            id: "source-restored-document",
            contentHash: restoredHash,
            storageState: "metadata_only",
          },
        },
      },
    });
    const hydrated = await uploadCompanyContextDocument({
      context,
      workspaceId: workspace.id,
      file: new File([new Uint8Array(restoredBytes)], "restored.csv", { type: "text/csv" }),
    });
    assert.equal(hydrated.id, placeholder.id, "A real upload must hydrate its imported metadata placeholder.");
    assert.equal(hydrated.itemId, item.id, "Hydration without an item field must preserve the imported item scope.");
    assert.equal(hydrated.itemName, item.name);
    const hydratedRow = await prisma.companyContext.findUniqueOrThrow({ where: { id: placeholder.id } });
    assert.equal(hydratedRow.contentHash, restoredHash);
    assert.equal(hydratedRow.itemId, item.id);
    assert.match(hydratedRow.storageUrl ?? "", /^data:text\/csv;base64,/);
    assert.equal(await prisma.companyContext.count({ where: { officeId, companyId: company.id, contentHash: restoredHash } }), 1);

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
    const fallbackCompany = await prisma.company.create({
      data: { officeId: foreignOffice.id, name: `Fallback pricing ${suffix}` },
    });
    const fallbackInquiry = await prisma.inquiry.create({
      data: {
        officeId: foreignOffice.id,
        companyId: fallbackCompany.id,
        subject: "Default pricing policy runtime check",
      },
    });
    const fallbackStrategyInput = await loadInquiryStrategyInput(foreignOffice.id, fallbackInquiry.id);
    assert.deepEqual(fallbackStrategyInput?.marginPolicy, {
      targetMarginPct: 18,
      minMarginPct: 12.6,
      stretchMarginPct: 25,
    });
    await assert.rejects(() => loadCompanyContext(foreignContext, workspace.id), /not found/i);
    await assert.rejects(() => listCompanyContextProcurementActions(foreignContext, workspace.id), /not found/i);
    await assert.rejects(
      () => saveCompanyContextMemory({ context: foreignContext, workspaceId: workspace.id, notes: ["leak"] }),
      /not found/i,
    );
    await assert.rejects(
      () => deleteCompanyContextMemory({ context: foreignContext, workspaceId: workspace.id, memoryId: keptMemory.saved[0].id }),
      /not found/i,
    );
    await assert.rejects(
      () => deleteCompanyContextChatThread({ context: foreignContext, workspaceId: workspace.id, threadId: defaultThread.id }),
      /not found/i,
    );

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
