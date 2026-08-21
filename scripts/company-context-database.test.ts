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

    await appendCompanyContextMessage({ context, workspaceId: workspace.id, role: "OPERATOR", body: "Use the PC-ABS specification." });
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
