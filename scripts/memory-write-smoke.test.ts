import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { backfillCompanyBrainMemory } from "../src/lib/memory/backfill";
import { getCustomerDossier } from "../src/lib/memory/customer-dossier";
import { ingestKnowledgeObjectStrict } from "../src/lib/memory/ingest-object";
import { recordMemoryEventStrict } from "../src/lib/memory/record-event";

async function main() {
  const runId = `memory-smoke-${Date.now()}`;
  const office = await prisma.office.create({ data: { name: runId } });

  try {
    const company = await prisma.company.create({
      data: {
        officeId: office.id,
        name: `${runId} Customer`,
        status: "IN_PROGRESS",
      },
    });
    const inquiry = await prisma.inquiry.create({
      data: {
        officeId: office.id,
        companyId: company.id,
        subject: `${runId} RFQ`,
        fromEmail: "shipper@example.com",
        fromCompany: company.name,
        origin: "Istanbul",
        destination: "Hamburg",
        mode: "SEA-FCL",
        commodity: "Machinery",
        containerCount: 1,
        containerType: "40HC",
        targetPriceStatus: "UNKNOWN",
      },
    });
    const job = await prisma.job.create({
      data: {
        officeId: office.id,
        companyId: company.id,
        inquiryId: inquiry.id,
        reference: `${runId}-JOB`,
        title: `${runId} shipment`,
        status: "INQUIRY",
        mode: "SEA-FCL",
        origin: "Istanbul",
        destination: "Hamburg",
        commodity: "Machinery",
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
        inquiryId: inquiry.id,
        jobId: job.id,
        subject: `${runId} RFQ thread`,
        participants: JSON.stringify(["shipper@example.com", emailAccount.email]),
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
        fromEmail: "shipper@example.com",
        toEmails: JSON.stringify([emailAccount.email]),
        subject: `${runId} RFQ`,
        bodyText: "Please quote one 40HC Istanbul to Hamburg.",
      },
    });
    const strategyAssessment = await prisma.strategyAssessment.create({
      data: {
        officeId: office.id,
        inquiryId: inquiry.id,
        jobId: job.id,
        entityType: "JOB",
        subject: job.title,
        recommendation: "REQUEST_RATES",
        recommendationLabel: "Get live rates",
        strategyMemo: "Smoke-test strategy assessment for memory event verification.",
        score: 61,
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
      sourceType: "STRATEGY",
      sourceExternalId: `strategy:assessment:${strategyAssessment.id}`,
      canonicalType: "strategy_assessment",
      title: strategyAssessment.subject,
      text: strategyAssessment.strategyMemo,
      entityType: "strategy_assessment",
      entityId: strategyAssessment.id,
      companyId: company.id,
      inquiryId: inquiry.id,
      jobId: job.id,
      strategyAssessmentId: strategyAssessment.id,
      payloadVersion: 1,
      payload: { assessmentId: strategyAssessment.id, recommendation: strategyAssessment.recommendation },
      provenance: {
        source: "memory_smoke_test",
        operation: "verify_strategy_object_write",
        path: "scripts/memory-write-smoke.test.ts",
        function: "main",
        sourceRecordId: strategyAssessment.id,
      },
    });

    const events = [
      {
        sourceType: "GMAIL",
        sourceExternalId: `gmail:message:${emailMessage.id}`,
        eventType: "gmail.message.ingested",
        entityType: "email_message",
        entityId: emailMessage.id,
        payload: { emailMessageId: emailMessage.id, emailThreadId: emailThread.id, inquiryId: inquiry.id, jobId: job.id },
      },
      {
        sourceType: "INQUIRY",
        sourceExternalId: `inquiry:${inquiry.id}`,
        eventType: "inquiry.created",
        entityType: "inquiry",
        entityId: inquiry.id,
        payload: { inquiryId: inquiry.id, companyId: company.id, subject: inquiry.subject },
      },
      {
        sourceType: "JOB",
        sourceExternalId: `job:${job.id}`,
        eventType: "job.status_updated",
        entityType: "job",
        entityId: job.id,
        payload: { jobId: job.id, fromStatus: "PROPOSED", toStatus: job.status },
      },
      {
        sourceType: "STRATEGY",
        sourceExternalId: `strategy:assessment:${strategyAssessment.id}`,
        eventType: "strategy.assessment.created",
        entityType: "strategy_assessment",
        entityId: strategyAssessment.id,
        payload: { assessmentId: strategyAssessment.id, recommendation: strategyAssessment.recommendation },
      },
    ] as const;

    for (const event of events) {
      await recordMemoryEventStrict({
        officeId: office.id,
        sourceType: event.sourceType,
        sourceExternalId: event.sourceExternalId,
        sourceLabel: "Memory smoke test",
        eventType: event.eventType,
        entityType: event.entityType,
        entityId: event.entityId,
        actorType: "system",
        actorId: null,
        payloadVersion: 1,
        payload: event.payload,
        provenance: {
          source: "memory_smoke_test",
          operation: `verify_${event.eventType}`,
          path: "scripts/memory-write-smoke.test.ts",
          function: "main",
          sourceRecordId: event.entityId,
        },
        idempotencyKey: `${runId}:${event.eventType}`,
      });
    }

    const written = await prisma.memoryEvent.findMany({
      where: { officeId: office.id },
      select: { eventType: true, sourceType: true, entityType: true, entityId: true, payloadVersion: true },
      orderBy: { eventType: "asc" },
    });
    const missing = events
      .map((event) => event.eventType)
      .filter((eventType) => !written.some((row) => row.eventType === eventType && row.payloadVersion === 1));
    if (missing.length > 0) {
      throw new Error(`Missing memory events: ${missing.join(", ")}`);
    }

    const dossier = await getCustomerDossier({ officeId: office.id, companyId: company.id, limit: 5 });
    if (!dossier.found || dossier.company_profile.id !== company.id || !Array.isArray(dossier.recommended_next_actions)) {
      throw new Error("Customer dossier did not return the expected source-linked shape.");
    }

    await backfillCompanyBrainMemory({ officeId: office.id, strict: true });
    const afterFirstBackfill = {
      objects: await prisma.knowledgeObject.count({ where: { officeId: office.id } }),
      events: await prisma.memoryEvent.count({ where: { officeId: office.id } }),
    };
    await backfillCompanyBrainMemory({ officeId: office.id, strict: true });
    const afterSecondBackfill = {
      objects: await prisma.knowledgeObject.count({ where: { officeId: office.id } }),
      events: await prisma.memoryEvent.count({ where: { officeId: office.id } }),
    };
    if (afterSecondBackfill.objects !== afterFirstBackfill.objects || afterSecondBackfill.events !== afterFirstBackfill.events) {
      throw new Error(`Backfill is not idempotent: first=${JSON.stringify(afterFirstBackfill)} second=${JSON.stringify(afterSecondBackfill)}`);
    }

    console.log(JSON.stringify({
      ok: true,
      officeId: office.id,
      events: written,
      dossier: {
        company: dossier.company_profile.name,
        sections: ["company_profile", "contacts", "recent_emails", "active_jobs", "commercial_summary", "operational_summary", "recommended_next_actions"],
        commercial_summary: dossier.commercial_summary,
        operational_summary: dossier.operational_summary,
      },
      backfillIdempotency: afterSecondBackfill,
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
