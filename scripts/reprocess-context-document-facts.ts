import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { readStoredDocument } from "../src/lib/document-storage";
import {
  CONTEXT_DOCUMENT_PROCESSING_VERSION,
  ingestContextDocument,
} from "../src/lib/supply-os/context-documents";
import { invalidateCompanyContextDocumentStateProjections } from "../src/lib/supply-os/state-runtime/projections/invalidate";

// Re-run document extraction for context files whose stored markdown predates
// the derived-facts pass, so bills of materials and STL meshes carry their
// manufacturability drivers (package sizes, fine pitch families, bounding box)
// instead of raw rows a drafting prompt can skip.
//
// Office scoped and idempotent: only rows whose extraction version is older
// than the current one are rewritten, and the source file is never touched.
//
// Usage: tsx scripts/reprocess-context-document-facts.ts --office=<id> [--apply]

const REPROCESSED_MIME_TYPES = ["text/csv", "model/stl"];

function decodeDataUrl(value: string) {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(value);
  if (!match) return null;
  return {
    contentType: match[1],
    bytes: Buffer.from(decodeURIComponent(match[3]), match[2] ? "base64" : "utf8"),
  };
}

function storedVersion(payload: unknown) {
  if (!payload || typeof payload !== "object") return 0;
  const value = (payload as Record<string, unknown>).extractionVersion;
  return typeof value === "number" ? value : 0;
}

async function documentBytes(storageUrl: string | null) {
  if (!storageUrl) return null;
  const embedded = decodeDataUrl(storageUrl);
  if (embedded) return embedded.bytes;
  const stored = await readStoredDocument(storageUrl).catch(() => null);
  return stored?.bytes ?? null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const officeId = process.argv.find((arg) => arg.startsWith("--office="))?.slice("--office=".length);
  if (!officeId) throw new Error("Pass --office=<officeId>. This script never runs across offices.");

  const rows = await prisma.companyContext.findMany({
    where: { officeId, kind: "DOCUMENT", mimeType: { in: REPROCESSED_MIME_TYPES } },
    select: { id: true, companyId: true, name: true, mimeType: true, storageUrl: true, payload: true },
    orderBy: { createdAt: "asc" },
  });

  let rewritten = 0;
  let skipped = 0;

  for (const row of rows) {
    if (storedVersion(row.payload) >= CONTEXT_DOCUMENT_PROCESSING_VERSION) {
      skipped += 1;
      continue;
    }
    const bytes = await documentBytes(row.storageUrl);
    if (!bytes) {
      console.log(`skip ${row.name}: source file unavailable`);
      skipped += 1;
      continue;
    }
    const result = await ingestContextDocument(bytes, row.mimeType ?? "text/csv", row.name);
    if (result.state !== "READY" || !result.markdown) {
      console.log(`skip ${row.name}: extraction returned ${result.state}`);
      skipped += 1;
      continue;
    }
    console.log(`${apply ? "rewrite" : "would rewrite"} ${row.name} (${result.markdown.length} chars)`);
    if (apply) {
      const payload = row.payload && typeof row.payload === "object"
        ? { ...(row.payload as Record<string, unknown>) }
        : {};
      payload.extractionVersion = result.version;
      await prisma.companyContext.update({
        where: { id: row.id },
        data: {
          markdown: result.markdown,
          description: result.summary ?? undefined,
          processingState: "READY",
          processingError: null,
          payload,
        },
      });
      await invalidateCompanyContextDocumentStateProjections({
        officeId,
        companyId: row.companyId,
        documentId: row.id,
      }).catch(() => undefined);
      const workspace = await prisma.supplyWorkspace.findFirst({
        where: { officeId, companyId: row.companyId, status: "ACTIVE" },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        select: { id: true },
      }).catch(() => null);
      if (workspace) {
        await import("../src/lib/supply-os/state-runtime/projections/worker")
          .then(({ enqueueSupplyStateProjectionRebuildIfEnabled }) => (
            enqueueSupplyStateProjectionRebuildIfEnabled({
              scope: {
                type: "company",
                officeId,
                companyId: row.companyId,
                workspaceId: workspace.id,
              },
            })
          ))
          .catch(() => undefined);
      }
    }
    rewritten += 1;
  }

  console.log(`${apply ? "Rewrote" : "Would rewrite"} ${rewritten} document(s); skipped ${skipped}.`);
  if (!apply) console.log("Dry run. Pass --apply to persist.");
}

void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
