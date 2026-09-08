import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { normalizeCanonicalType } from "../src/lib/memory/canonical-types";
import { formatEvidenceForAgent, formatEvidenceForUser } from "../src/lib/memory/evidence";
import { hybridSearchMemory } from "../src/lib/memory/hybrid-search";
import { ingestKnowledgeObjectStrict } from "../src/lib/memory/ingest-object";
import { recordMemoryEventStrict } from "../src/lib/memory/record-event";
import { searchCustomerMemory, searchJobMemory } from "../src/lib/memory/search-memory";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function memoryCounts(officeId: string) {
  const [objects, chunks, events, mentions] = await Promise.all([
    prisma.knowledgeObject.count({ where: { officeId } }),
    prisma.knowledgeChunk.count({ where: { officeId } }),
    prisma.memoryEvent.count({ where: { officeId } }),
    prisma.entityMention.count({ where: { officeId } }),
  ]);
  return { objects, chunks, events, mentions };
}

async function main() {
  const runId = `memory-search-${Date.now()}`;
  const office = await prisma.office.create({ data: { name: runId } });

  try {
    const company = await prisma.company.create({
      data: {
        officeId: office.id,
        name: `${runId} Customer`,
        status: "IN_PROGRESS",
        lane: "Istanbul-Hamburg",
      },
    });
    const inquiry = await prisma.inquiry.create({
      data: {
        officeId: office.id,
        companyId: company.id,
        subject: `${runId} customs RFQ`,
        fromEmail: "ops@example.com",
        fromCompany: company.name,
        origin: "Istanbul",
        destination: "Hamburg",
        mode: "SEA-FCL",
        commodity: "Machinery",
        targetPriceStatus: "PROVIDED",
        targetPrice: 4200,
        targetCurrency: "USD",
      },
    });
    const job = await prisma.job.create({
      data: {
        officeId: office.id,
        companyId: company.id,
        inquiryId: inquiry.id,
        reference: `${runId}-JOB`,
        title: `${runId} Istanbul to Hamburg machinery`,
        status: "INQUIRY",
        mode: "SEA-FCL",
        origin: "Istanbul",
        destination: "Hamburg",
        commodity: "Machinery",
        targetPrice: 4200,
        targetCurrency: "USD",
      },
    });
    const emailAccount = await prisma.emailAccount.create({
      data: {
        officeId: office.id,
        email: `${runId}@example.com`,
        provider: "GMAIL",
      },
    });
    const emailThread = await prisma.emailThread.create({
      data: {
        officeId: office.id,
        companyId: company.id,
        inquiryId: inquiry.id,
        jobId: job.id,
        subject: `${runId} customs documents`,
        participants: JSON.stringify(["ops@example.com", emailAccount.email]),
        externalThreadId: `gmail-thread-${runId}`,
      },
    });
    const emailMessage = await prisma.emailMessage.create({
      data: {
        threadId: emailThread.id,
        accountId: emailAccount.id,
        externalId: `gmail-external-${runId}`,
        gmailMessageId: `gmail-message-${runId}`,
        direction: "INBOUND",
        fromEmail: "ops@example.com",
        toEmails: JSON.stringify([emailAccount.email]),
        subject: `${runId} customs documents`,
        bodyText: "Delayed customs docs for German exports from Istanbul to Hamburg. Customer asked whether target price 4200 still works.",
      },
    });
    const strategy = await prisma.strategyAssessment.create({
      data: {
        officeId: office.id,
        inquiryId: inquiry.id,
        jobId: job.id,
        entityType: "JOB",
        subject: job.title,
        recommendation: "REQUEST_RATES",
        recommendationLabel: "Get carrier rates before quoting",
        strategyMemo: "Use target price as a ceiling. Customs document delay is the key risk before quoting Hamburg lane.",
        score: 66,
        band: "B",
        confidence: "medium",
        components: {},
        evidence: {},
        decisionBrief: {},
        inputHash: runId,
      },
    });

    await ingestKnowledgeObjectStrict({
      officeId: office.id,
      sourceType: "gmail",
      sourceExternalId: `gmail:message:${emailMessage.id}`,
      canonicalType: "email_message",
      title: emailMessage.subject,
      text: emailMessage.bodyText,
      entityType: "email_message",
      entityId: emailMessage.id,
      companyId: company.id,
      inquiryId: inquiry.id,
      jobId: job.id,
      emailThreadId: emailThread.id,
      emailMessageId: emailMessage.id,
      occurredAt: emailMessage.sentAt,
      payload: { emailMessageId: emailMessage.id, subject: emailMessage.subject },
      provenance: {
        source: "memory_search_test",
        operation: "ingest_email_message",
        path: "scripts/memory-search.test.ts",
        function: "main",
        sourceRecordId: emailMessage.id,
      },
    });

    await ingestKnowledgeObjectStrict({
      officeId: office.id,
      sourceType: "JOB",
      sourceExternalId: `job:${job.id}`,
      canonicalType: "job",
      title: job.title,
      text: `${job.reference} ${job.origin} ${job.destination} ${job.commodity} target price ${job.targetPrice}`,
      entityType: "job",
      entityId: job.id,
      companyId: company.id,
      inquiryId: inquiry.id,
      jobId: job.id,
      occurredAt: job.updatedAt,
      payload: { jobId: job.id, reference: job.reference },
      provenance: {
        source: "memory_search_test",
        operation: "ingest_job",
        path: "scripts/memory-search.test.ts",
        function: "main",
        sourceRecordId: job.id,
      },
    });

    await ingestKnowledgeObjectStrict({
      officeId: office.id,
      sourceType: "STRATEGY",
      sourceExternalId: `strategy:assessment:${strategy.id}`,
      canonicalType: "strategy_decision",
      title: strategy.subject,
      text: strategy.strategyMemo,
      entityType: "strategy_assessment",
      entityId: strategy.id,
      companyId: company.id,
      inquiryId: inquiry.id,
      jobId: job.id,
      strategyAssessmentId: strategy.id,
      occurredAt: strategy.updatedAt,
      payload: { assessmentId: strategy.id, recommendation: strategy.recommendation },
      provenance: {
        source: "memory_search_test",
        operation: "ingest_legacy_strategy_type",
        path: "scripts/memory-search.test.ts",
        function: "main",
        sourceRecordId: strategy.id,
      },
    });

    await recordMemoryEventStrict({
      officeId: office.id,
      sourceType: "GMAIL",
      sourceExternalId: `gmail:message:${emailMessage.id}`,
      eventType: "gmail.message.ingested",
      entityType: "email_message",
      entityId: emailMessage.id,
      payloadVersion: 1,
      payload: { emailMessageId: emailMessage.id, companyId: company.id, inquiryId: inquiry.id, jobId: job.id },
      provenance: {
        source: "memory_search_test",
        operation: "record_email_event",
        path: "scripts/memory-search.test.ts",
        function: "main",
        sourceRecordId: emailMessage.id,
      },
      idempotencyKey: `${runId}:gmail.message.ingested`,
    });

    await recordMemoryEventStrict({
      officeId: office.id,
      sourceType: "STRATEGY",
      sourceExternalId: `strategy:assessment:${strategy.id}`,
      eventType: "strategy.assessment.created",
      entityType: "strategy_assessment",
      entityId: strategy.id,
      payloadVersion: 1,
      payload: { assessmentId: strategy.id, recommendation: strategy.recommendation, jobId: job.id, inquiryId: inquiry.id },
      provenance: {
        source: "memory_search_test",
        operation: "record_strategy_event",
        path: "scripts/memory-search.test.ts",
        function: "main",
        sourceRecordId: strategy.id,
      },
      idempotencyKey: `${runId}:strategy.assessment.created`,
    });

    assert(normalizeCanonicalType("strategy_decision") === "strategy_assessment", "Legacy strategy_decision did not normalize.");

    const strategyObject = await prisma.knowledgeObject.findFirst({
      where: { officeId: office.id, sourceExternalId: `strategy:assessment:${strategy.id}` },
      select: { canonicalType: true },
    });
    assert(strategyObject?.canonicalType === "strategy_assessment", `Legacy canonical type was not stored normalized: ${strategyObject?.canonicalType}`);

    const beforeSearch = await memoryCounts(office.id);
    const companySearch = await searchCustomerMemory({
      officeId: office.id,
      companyId: company.id,
      query: "customs Hamburg target price",
      limit: 10,
    });
    const jobSearch = await searchJobMemory({
      officeId: office.id,
      jobId: job.id,
      query: "customs risk quote",
      limit: 10,
    });
    const hybrid = await hybridSearchMemory({
      officeId: office.id,
      companyId: company.id,
      jobId: job.id,
      canonicalTypes: ["email_message", "strategy_decision", "job"],
      query: "customs Hamburg",
      limit: 10,
      includeEvents: true,
      includeChunks: true,
    });
    const afterSearch = await memoryCounts(office.id);

    assert(JSON.stringify(afterSearch) === JSON.stringify(beforeSearch), `Search mutated memory rows: before=${JSON.stringify(beforeSearch)} after=${JSON.stringify(afterSearch)}`);
    assert(companySearch.results.length > 0, "Customer scoped memory search returned no results.");
    assert(
      companySearch.results.some((result) =>
        result.canonicalType === "email_message" && result.entityId === emailMessage.id),
      "Customer scoped memory search lost currently routed email evidence.",
    );
    assert(jobSearch.results.length > 0, "Job scoped memory search returned no results.");
    assert(hybrid.results.some((result) => result.objectId && result.evidence.some((ref) => ref.knowledgeObjectId === result.objectId)), "Hybrid search results are missing object evidence.");
    assert(hybrid.results.some((result) => result.companyId === company.id || result.jobId === job.id), "Hybrid search did not preserve entity scope.");
    assert(formatEvidenceForAgent(hybrid.results).includes("KnowledgeObject:"), "Agent evidence formatter did not include object refs.");
    assert(formatEvidenceForUser(hybrid.results).length > 0, "User evidence formatter returned no readable refs.");

    console.log(JSON.stringify({
      ok: true,
      officeId: office.id,
      canonicalNormalization: {
        input: "strategy_decision",
        normalized: normalizeCanonicalType("strategy_decision"),
        stored: strategyObject.canonicalType,
      },
      counts: afterSearch,
      companySearch: companySearch.results.slice(0, 3).map((result) => ({
        kind: result.kind,
        canonicalType: result.canonicalType,
        sourceType: result.sourceType,
        title: result.title,
        score: Math.round(result.score),
        evidenceRefs: result.evidence.length,
      })),
      jobSearch: jobSearch.results.slice(0, 3).map((result) => ({
        kind: result.kind,
        canonicalType: result.canonicalType,
        sourceType: result.sourceType,
        title: result.title,
        score: Math.round(result.score),
      })),
      hybridSearch: hybrid.results.slice(0, 3).map((result) => ({
        kind: result.kind,
        canonicalType: result.canonicalType,
        sourceType: result.sourceType,
        title: result.title,
        excerpt: result.excerpt,
        score: Math.round(result.score),
        reasons: result.reasons.slice(0, 4),
      })),
      evidenceForUser: formatEvidenceForUser(hybrid.results).slice(0, 3),
      evidenceForAgent: formatEvidenceForAgent(hybrid.results).split("\n").slice(0, 2),
    }, null, 2));
  } finally {
    await prisma.office.delete({ where: { id: office.id } }).catch(() => null);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
