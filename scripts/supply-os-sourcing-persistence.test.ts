import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { createSupplyWorkspace, listSupplyWorkspaces, type SupplyAccessContext } from "../src/lib/supply-os/persistence";
import {
  listProcurementCases,
  saveProcurementSelection,
} from "../src/lib/supply-os/procurement-case-persistence";
import {
  completeSourcingResearchRun,
  listSourcingResearchRuns,
  startSourcingResearchRun,
} from "../src/lib/supply-os/sourcing-research-persistence";

const suffix = randomUUID().slice(0, 8);
let officeId = "";
let foreignOfficeId = "";

async function cleanup() {
  const ids = [officeId, foreignOfficeId].filter(Boolean);
  if (ids.length) await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL derya.allow_supply_provenance_mutation = 'on'");
    await tx.office.deleteMany({ where: { id: { in: ids } } });
  }).catch(() => undefined);
}

async function makeContext(label: string) {
  const office = await prisma.office.create({ data: { name: `Sourcing ${label} ${suffix}` } });
  const user = await prisma.user.create({
    data: {
      officeId: office.id,
      email: `sourcing-${label}-${suffix}@example.test`,
      passwordHash: "verification-only",
      fullName: `${label} operator`,
      role: "ADMIN",
      canViewWholeOffice: true,
    },
  });
  return {
    officeId: office.id,
    userId: user.id,
    role: user.role,
    canViewWholeOffice: user.canViewWholeOffice,
  } satisfies SupplyAccessContext;
}

async function main() {
  try {
    const context = await makeContext("owner");
    officeId = context.officeId;
    const visibleWorkspace = await createSupplyWorkspace(context, { name: "Visible robotics workspace" });
    const input = {
      componentItemKey: "VIS-DPT-410",
      componentName: "Stereo depth camera",
      manufacturer: null,
      mpn: null,
      specification: "Industrial stereo depth camera",
      targetCountry: "United States",
      requestText: "Find four stereo depth cameras",
    };
    const started = await startSourcingResearchRun(context, input);
    const observedAt = new Date().toISOString();
    const source = { url: "https://example.com/product", sourceType: "OFFICIAL" };
    const supported = <T>(value: T) => ({
      value,
      state: "SUPPORTED",
      confidence: 0.9,
      sources: [source],
      observedAt,
      freshness: "FRESH",
    });
    await completeSourcingResearchRun({
      context,
      runId: started.id,
      workspaceId: started.workspaceId,
      output: {
        candidates: [{
          id: "candidate-1",
          companyName: "Example supplier",
          website: "https://example.com/",
          sourceUrls: ["https://example.com/product"],
          price: supported(125),
          currency: supported("USD"),
          minimumOrderQuantity: supported(4),
          leadTimeDays: supported(14),
          status: "REVIEW_REQUIRED",
        }, {
          id: "candidate-2",
          companyName: "Weak evidence supplier",
          website: null,
          sourceUrls: ["https://example.com/weak"],
          price: { ...supported(99), state: "PARTIAL" },
          currency: supported("USD"),
          minimumOrderQuantity: supported(2),
          leadTimeDays: { ...supported(7), freshness: "STALE" },
          status: "UNSUPPORTED",
        }],
        degraded: false,
        warnings: [],
      },
    });

    const stale = await startSourcingResearchRun(context, { ...input, componentItemKey: "STALE-1" });
    await prisma.supplyCapabilityRun.update({
      where: { id: stale.id },
      data: { updatedAt: new Date(Date.now() - 10 * 60 * 1_000) },
    });
    const runs = await listSourcingResearchRuns(context);
    assert.equal(runs.length, 2);
    const completed = runs.find((run) => run.id === started.id);
    assert.equal((completed?.input as typeof input).componentItemKey, "VIS-DPT-410");
    assert.equal(completed?.status, "SUCCEEDED");
    assert.equal(((completed?.output as { candidates?: unknown[] })?.candidates ?? []).length, 2);
    assert.equal(runs.find((run) => run.id === stale.id)?.status, "FAILED", "stale research must become retryable");
    const stored = await prisma.supplyCapabilityRun.findUniqueOrThrow({ where: { id: started.id } });
    assert.ok(stored.inputHash);
    assert.ok(stored.outputHash);

    const procurementCase = await saveProcurementSelection({
      context,
      researchRunId: started.id,
      selection: {
        id: "public:candidate-1",
        name: "Client-authored name",
        sourceClass: "New",
        sourceUrl: "https://untrusted.example/",
        price: 999,
        currency: "EUR",
        minimumOrderQuantity: 999,
        priceType: "Sourced",
        deliveryDate: "Aug 23",
        deliveryType: "Sourced",
        quality: "Strong",
      },
    });
    const procurementResult = procurementCase.result as {
      stage: string;
      selectedOption: { name: string; sourceClass: string; sourceUrl: string; price: number; currency: string; minimumOrderQuantity: number; deliveryDate: string; quality: string };
      gates: { commercialTerms: string; purchaseApproval: string };
    };
    assert.equal(procurementResult.selectedOption.name, "Example supplier", "persisted evidence must override client-authored supplier identity");
    assert.equal(procurementResult.selectedOption.sourceClass, "Official");
    assert.equal(procurementResult.selectedOption.sourceUrl, "https://example.com/");
    assert.equal(procurementResult.selectedOption.price, 125);
    assert.equal(procurementResult.selectedOption.currency, "USD");
    assert.equal(procurementResult.selectedOption.minimumOrderQuantity, 4);
    assert.notEqual(procurementResult.selectedOption.deliveryDate, "Aug 23", "sourced delivery must not trust a browser-authored date");
    assert.match(procurementResult.selectedOption.deliveryDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(procurementResult.selectedOption.quality, "Conditional");
    assert.equal(procurementResult.gates.commercialTerms, "EVIDENCE_COMPLETE");
    assert.equal(procurementResult.gates.purchaseApproval, "BLOCKED");

    const weakEvidenceCase = await saveProcurementSelection({
      context,
      researchRunId: started.id,
      selection: {
        id: "public:candidate-2",
        name: "Client tries to promote weak evidence",
        sourceClass: "Official",
        sourceUrl: "https://example.com/weak",
        price: 99,
        currency: "USD",
        minimumOrderQuantity: 2,
        priceType: "Sourced",
        deliveryDate: "Aug 16",
        deliveryType: "Sourced",
        quality: "Strong",
      },
    });
    const weakEvidenceResult = weakEvidenceCase.result as {
      selectedOption: { price: number | null; deliveryDate: string | null; priceType: string; deliveryType: string };
      gates: { commercialTerms: string; purchaseApproval: string };
    };
    assert.equal(weakEvidenceResult.selectedOption.price, null, "partial price evidence must remain unknown");
    assert.equal(weakEvidenceResult.selectedOption.deliveryDate, null, "stale lead-time evidence must remain unknown");
    assert.equal(weakEvidenceResult.selectedOption.priceType, "Unknown");
    assert.equal(weakEvidenceResult.selectedOption.deliveryType, "Unknown");
    assert.equal(weakEvidenceResult.gates.commercialTerms, "REVIEW_REQUIRED");
    assert.equal(weakEvidenceResult.gates.purchaseApproval, "BLOCKED");
    await assert.rejects(() => saveProcurementSelection({
      context,
      researchRunId: started.id,
      selection: {
        id: "public:not-in-research",
        name: "Invented supplier",
        sourceClass: "New",
        sourceUrl: null,
        price: 100,
        currency: "USD",
        minimumOrderQuantity: 1,
        priceType: "Modeled",
        deliveryDate: "Aug 20",
        deliveryType: "Modeled",
        quality: "Unverified",
      },
    }), /not present in the research run/);

    const updatedCase = await saveProcurementSelection({
      context,
      researchRunId: started.id,
      selection: {
        id: "modeled-option",
        name: "Modeled alternative",
        sourceClass: "Trusted",
        sourceUrl: null,
        price: 110,
        currency: "USD",
        minimumOrderQuantity: 2,
        priceType: "Modeled",
        deliveryDate: "Aug 20",
        deliveryType: "Modeled",
        quality: "Strong",
      },
    });
    const updatedResult = updatedCase.result as {
      selectedOption: { sourceClass: string; quality: string };
      gates: { sourceEvidence: string; commercialTerms: string; purchaseApproval: string };
    };
    assert.equal(updatedCase.id, procurementCase.id, "one research run must resume one procurement case");
    assert.equal(updatedResult.selectedOption.sourceClass, "New", "client-modeled suppliers cannot become trusted records");
    assert.equal(updatedResult.selectedOption.quality, "Unverified", "client-modeled quality cannot become evidence");
    assert.equal(updatedResult.gates.sourceEvidence, "BLOCKED");
    assert.equal(updatedResult.gates.commercialTerms, "REVIEW_REQUIRED");
    assert.equal(updatedResult.gates.purchaseApproval, "BLOCKED");
    const replayedCase = await saveProcurementSelection({
      context,
      researchRunId: started.id,
      selection: {
        id: "modeled-option",
        name: "Modeled alternative",
        sourceClass: "Trusted",
        sourceUrl: null,
        price: 110,
        currency: "USD",
        minimumOrderQuantity: 2,
        priceType: "Modeled",
        deliveryDate: "Aug 20",
        deliveryType: "Modeled",
        quality: "Strong",
      },
    });
    assert.equal(replayedCase.id, updatedCase.id);
    const returnedCase = await saveProcurementSelection({
      context,
      researchRunId: started.id,
      selection: {
        id: "public:candidate-1",
        name: "Client-authored name again",
        sourceClass: "New",
        sourceUrl: "https://untrusted.example/again",
        price: 888,
        currency: "EUR",
        minimumOrderQuantity: 888,
        priceType: "Sourced",
        deliveryDate: "Sep 30",
        deliveryType: "Sourced",
        quality: "Strong",
      },
    });
    assert.equal((returnedCase.result as { selectedOption: { name: string } }).selectedOption.name, "Example supplier", "operators must be able to return to a prior supplier safely");
    assert.equal((await listProcurementCases(context)).length, 1);
    const events = await prisma.supplyExecutionEvent.findMany({
      where: { executionTaskId: procurementCase.id },
      orderBy: { sequence: "asc" },
    });
    assert.equal(events.length, 4, "identical retries must not append fake history while A-B-A remains valid");
    assert.equal(events[0]?.eventType, "PROCUREMENT_CASE_CREATED");
    assert.equal(events[1]?.eventType, "SUPPLIER_SELECTION_UPDATED");
    assert.equal(events[2]?.eventType, "SUPPLIER_SELECTION_UPDATED");
    assert.equal(events[3]?.eventType, "SUPPLIER_SELECTION_UPDATED");
    assert.ok(events.every((event) => Boolean(event.payloadHash)));

    const duplicateRun = await startSourcingResearchRun(context, { ...input, componentItemKey: "DUPLICATE-ID" });
    await completeSourcingResearchRun({
      context,
      runId: duplicateRun.id,
      workspaceId: duplicateRun.workspaceId,
      output: {
        candidates: ["First supplier", "Second supplier"].map((companyName) => ({
          id: "duplicate",
          companyName,
          website: "https://example.com/",
          sourceUrls: ["https://example.com/product"],
          price: supported(125),
          currency: supported("USD"),
          minimumOrderQuantity: supported(4),
          leadTimeDays: supported(14),
          status: "REVIEW_REQUIRED",
        })),
        degraded: false,
        warnings: [],
      },
    });
    await assert.rejects(() => saveProcurementSelection({
      context,
      researchRunId: duplicateRun.id,
      selection: {
        id: "public:duplicate",
        name: "Ambiguous supplier",
        sourceClass: "Official",
        sourceUrl: "https://example.com/",
        price: 125,
        currency: "USD",
        minimumOrderQuantity: 4,
        priceType: "Sourced",
        deliveryDate: "Aug 23",
        deliveryType: "Sourced",
        quality: "Conditional",
      },
    }), /ambiguous candidate identifier/, "duplicate research IDs must never select the wrong supplier");

    const listed = await listSupplyWorkspaces(context);
    assert.ok(listed.some((workspace) => workspace.id === visibleWorkspace.id), "ordinary null-key workspaces must remain visible");
    assert.ok(listed.every((workspace) => !workspace.externalKey?.startsWith("system:")), "the system procurement workspace must stay out of the company directory");

    const restrictedUser = await prisma.user.create({
      data: {
        officeId: context.officeId,
        email: `sourcing-restricted-${suffix}@example.test`,
        passwordHash: "verification-only",
        fullName: "Restricted operator",
        role: "EMPLOYEE",
        canViewWholeOffice: false,
      },
    });
    const restrictedContext = { ...context, userId: restrictedUser.id, role: restrictedUser.role, canViewWholeOffice: false };
    await assert.rejects(() => listProcurementCases(restrictedContext), /not found|cannot edit/i, "unassigned employees must not read office procurement cases");
    await assert.rejects(() => saveProcurementSelection({
      context: restrictedContext,
      researchRunId: started.id,
      selection: {
        id: "modeled-option",
        name: "Restricted write",
        sourceClass: "New",
        sourceUrl: null,
        price: 110,
        currency: "USD",
        minimumOrderQuantity: 2,
        priceType: "Modeled",
        deliveryDate: "Aug 20",
        deliveryType: "Modeled",
        quality: "Unverified",
      },
    }), /not found|cannot edit/i, "unassigned employees must not change office procurement cases");

    const foreign = await makeContext("foreign");
    foreignOfficeId = foreign.officeId;
    assert.equal((await listSourcingResearchRuns(foreign)).length, 0, "another office must not see sourcing research runs");
    assert.equal((await listProcurementCases(foreign)).length, 0, "another office must not see procurement cases");

    console.log("Supply OS sourcing persistence checks passed.");
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
