import "dotenv/config";

import { prisma } from "../src/lib/prisma";
import {
  getOlympianLoadImportFixture,
  importOlympianLoad,
  OLYMPIAN_LOAD_COMPANY_NAME,
  OLYMPIAN_LOAD_IMPORT_VERSION,
  OLYMPIAN_LOAD_SOURCE_KEY,
  previewOlympianLoadImport,
} from "../src/lib/olympian-load";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const fixture = getOlympianLoadImportFixture();
  const runId = `olympian-import-test-${Date.now()}`;
  const office = await prisma.office.create({
    data: {
      name: runId,
    },
    select: {
      id: true,
    },
  });
  const secondOffice = await prisma.office.create({
    data: {
      name: `${runId}-second-office`,
    },
    select: {
      id: true,
    },
  });

  try {
    const existingCompany = await prisma.company.create({
      data: {
        officeId: office.id,
        name: "Olympian Motors",
        status: "LOST",
        crmNotes: "Operator-owned note that the importer must preserve.",
      },
      select: {
        id: true,
      },
    });

    const preview = await previewOlympianLoadImport(office.id);
    assert(preview.mode === "dry-run", "Preview must be dry-run mode.");
    assert(preview.wouldCreate, "Preview should report that the load would be created.");

    const first = await importOlympianLoad({
      officeId: office.id,
      actor: {
        userId: null,
        email: "olympian-test@manual-import.invalid",
      },
    });

    const sourceThread = await prisma.emailThread.findFirst({
      where: {
        officeId: office.id,
        jobId: first.job.id,
        externalThreadId: `manual:${OLYMPIAN_LOAD_SOURCE_KEY}`,
      },
      select: {
        id: true,
      },
    });
    assert(sourceThread, "First import should create its source thread.");

    const messagePrefix = `manual:${office.id}:${OLYMPIAN_LOAD_SOURCE_KEY}:`;
    await prisma.emailMessage.deleteMany({
      where: {
        threadId: sourceThread.id,
        externalId: {
          in: [
            `${messagePrefix}2026-04-29-delivery-and-equipment`,
            `${messagePrefix}2026-07-21-schedule-and-dg-status`,
          ],
        },
      },
    });
    await prisma.emailMessage.createMany({
      data: [
        {
          threadId: sourceThread.id,
          externalId: `${messagePrefix}2026-05-delivery-and-equipment`,
          direction: "INBOUND",
          fromEmail: "legacy-source@manual-import.invalid",
          toEmails: JSON.stringify(["derya-operations@manual-import.invalid"]),
          subject: "Legacy chronology fixture",
          bodyText: "Legacy v1 message with the wrong May 1 date.",
          sentAt: new Date("2026-05-01T18:00:00.000Z"),
        },
        {
          threadId: sourceThread.id,
          externalId: `${messagePrefix}2026-07-21-schedule-request`,
          direction: "INBOUND",
          fromEmail: "legacy-source@manual-import.invalid",
          toEmails: JSON.stringify(["derya-operations@manual-import.invalid"]),
          subject: "Legacy split schedule fixture",
          bodyText: "Legacy v1 schedule half.",
          sentAt: new Date("2026-07-21T16:00:00.000Z"),
        },
        {
          threadId: sourceThread.id,
          externalId: `${messagePrefix}2026-07-21-dg-files-claimed-ready`,
          direction: "INBOUND",
          fromEmail: "legacy-source@manual-import.invalid",
          toEmails: JSON.stringify(["derya-operations@manual-import.invalid"]),
          subject: "Legacy split DG fixture",
          bodyText: "Legacy v1 DG half.",
          sentAt: new Date("2026-07-21T19:00:00.000Z"),
        },
      ],
    });

    await Promise.all([
      prisma.jobDocument.deleteMany({
        where: {
          jobId: first.job.id,
          officeId: office.id,
          name: "Complete Vehicle MSDS",
        },
      }),
      prisma.task.deleteMany({
        where: {
          officeId: office.id,
          inquiryId: first.inquiryId,
          source: "manual_email_dossier",
          title: "Get complete specifications for both vehicles",
        },
      }),
      prisma.jobMilestone.deleteMany({
        where: {
          jobId: first.job.id,
          type: "ETA",
        },
      }),
      prisma.memoryEvent.deleteMany({
        where: {
          officeId: office.id,
          entityId: first.job.id,
          eventType: "job.dossier_imported",
        },
      }),
    ]);
    await prisma.jobDocument.create({
      data: {
        jobId: first.job.id,
        officeId: office.id,
        name: "Booking Confirmation",
        docType: "BOOKING",
        status: "UPLOADED",
      },
    });

    const second = await importOlympianLoad({
      officeId: office.id,
      actor: {
        userId: null,
        email: "olympian-test@manual-import.invalid",
      },
    });
    const otherOffice = await importOlympianLoad({
      officeId: secondOffice.id,
      actor: {
        userId: null,
        email: "olympian-test@manual-import.invalid",
      },
    });

    assert(first.created, "First import should create the load.");
    assert(!second.created, "Second import should reuse the existing load.");
    assert(first.job.id === second.job.id, "Idempotent import must return the same job.");
    assert(first.importedAt === second.importedAt, "Reruns should preserve the original import timestamp.");
    assert(second.counts.messages === fixture.messages.length, "Rerun should reconcile the current message fixture.");
    assert(second.counts.documents === fixture.documents.length + 1, "Rerun should report actual matching document rows, including an operator duplicate.");
    assert(second.counts.tasks === fixture.tasks.length, "Rerun should restore a missing fixture-owned task.");
    assert(second.counts.milestones === fixture.milestones.length, "Rerun should restore a missing fixture-owned milestone.");
    assert(otherOffice.created, "A different office should receive its own scoped load.");
    assert(otherOffice.job.id !== first.job.id, "Office-scoped imports must not share a job.");
    assert(first.companyId === existingCompany.id, "Importer should reuse the existing company alias.");

    await prisma.job.update({
      where: {
        id: otherOffice.job.id,
      },
      data: {
        companyId: existingCompany.id,
      },
    });
    let rejectedForeignCompany = false;
    try {
      await importOlympianLoad({ officeId: secondOffice.id });
    } catch (error) {
      rejectedForeignCompany = error instanceof Error && error.message.includes("company outside office");
    } finally {
      await prisma.job.update({
        where: {
          id: otherOffice.job.id,
        },
        data: {
          companyId: otherOffice.companyId,
        },
      });
    }
    assert(rejectedForeignCompany, "Rerun should reject a cross-office company link.");

    const foreignInquiry = await prisma.inquiry.create({
      data: {
        officeId: office.id,
        companyId: existingCompany.id,
        reference: `${runId}-foreign-inquiry`,
        subject: "Cross-office importer guard fixture",
      },
      select: {
        id: true,
      },
    });
    await prisma.job.update({
      where: {
        id: otherOffice.job.id,
      },
      data: {
        inquiryId: foreignInquiry.id,
      },
    });
    let rejectedForeignInquiry = false;
    try {
      await importOlympianLoad({ officeId: secondOffice.id });
    } catch (error) {
      rejectedForeignInquiry = error instanceof Error && error.message.includes("inquiry outside office");
    } finally {
      await prisma.job.update({
        where: {
          id: otherOffice.job.id,
        },
        data: {
          inquiryId: otherOffice.inquiryId,
        },
      });
      await prisma.inquiry.delete({
        where: {
          id: foreignInquiry.id,
        },
      });
    }
    assert(rejectedForeignInquiry, "Rerun should reject a cross-office inquiry link.");

    const preservedCompany = await prisma.company.findUnique({
      where: {
        id: existingCompany.id,
      },
      select: {
        status: true,
        crmNotes: true,
      },
    });
    assert(preservedCompany?.status === "LOST", "Importer must not overwrite an existing company status.");
    assert(
      preservedCompany.crmNotes === "Operator-owned note that the importer must preserve.",
      "Importer must not overwrite existing company notes.",
    );

    const job = await prisma.job.findUnique({
      where: {
        officeId_reference: {
          officeId: office.id,
          reference: OLYMPIAN_LOAD_SOURCE_KEY,
        },
      },
      include: {
        inquiry: true,
        emailThreads: {
          include: {
            messages: true,
          },
        },
        documents: true,
        milestones: true,
      },
    });
    assert(job, "Imported job was not found.");
    assert(job.companyId === existingCompany.id, "Imported job should point to the reused company.");
    assert(job.inquiry, "Imported job should have a source inquiry.");
    assert(job.reference === OLYMPIAN_LOAD_SOURCE_KEY, "Job reference should be stable.");
    assert(job.status === "QUOTED", "Job should stay in pricing, not booked.");
    assert(job.notifyCustomer === false, "Imported load must not enable customer notifications.");
    assert(job.cost == null && job.revenue == null, "Import must not create operational economics.");
    assert(job.targetPrice == null && job.targetPriceStatus === "UNKNOWN", "Import must not create a target price.");
    assert(job.etd == null && job.eta == null, "Requested dates must not become confirmed job ETD or ETA.");
    assert(job.inquiry.containerCount === 1 && job.inquiry.containerType === "40HC", "Equipment should be 1 x 40HC.");
    assert(job.quantity === 2 && job.quantityUnit === "UNITS", "Job should record two vehicle units.");
    assert(job.dangerousGoods === "YES", "Installed-battery vehicle shipment should remain marked DG.");
    assert(job.emailThreads.length === 1, "Import should create exactly one deduplicated thread.");
    assert(job.emailThreads[0].messages.length === fixture.messages.length, "Imported message count should match the sanitized fixture.");
    assert(job.documents.length === fixture.documents.length + 1, "Rerun should retain the operator-created duplicate document.");
    assert(
      fixture.documents.every((required) => job.documents.some((document) => document.name === required.name)),
      "Every fixture document requirement should exist after reconciliation.",
    );
    assert(
      job.documents.some((document) => document.name === "Booking Confirmation" && document.status === "UPLOADED"),
      "Rerun must preserve the operator-created uploaded document.",
    );
    assert(job.milestones.length === fixture.milestones.length, "Milestone count should match the fixture.");

    const importedMessages = [...job.emailThreads[0].messages].sort(
      (left, right) => left.sentAt.getTime() - right.sentAt.getTime(),
    );
    assert(
      importedMessages[0]?.sentAt.toISOString() === "2026-04-24T18:48:00.000Z",
      "Conversation chronology should begin with the April 24 quote request.",
    );
    assert(
      importedMessages.some((message) => message.sentAt.toISOString().startsWith("2026-04-29")),
      "Delivery and equipment evidence should be dated April 29.",
    );
    assert(
      !importedMessages.some((message) => message.bodyText?.includes("wrong May 1 date")),
      "The legacy May 1 chronology fixture should be removed.",
    );
    const july21Messages = importedMessages.filter(
      (message) => message.sentAt.toISOString().startsWith("2026-07-21"),
    );
    assert(july21Messages.length === 1, "July 21 schedule and DG evidence should be one source message.");
    assert(
      july21Messages[0].bodyText?.includes("August 27, 2026")
        && july21Messages[0].bodyText?.includes("UN38.3"),
      "The single July 21 message should preserve both schedule and DG statements.",
    );
    assert(
      !importedMessages.some((message) => [
        "2026-05-delivery-and-equipment",
        "2026-07-21-schedule-request",
        "2026-07-21-dg-files-claimed-ready",
      ].some((legacyKey) => message.externalId?.endsWith(legacyKey))),
      "Version 2 reconciliation should remove importer-owned legacy messages.",
    );

    const parsedData = JSON.parse(job.inquiry.parsedData ?? "{}") as {
      source?: string;
      loadDossier?: {
        version?: number;
        sourceKey?: string;
        facts?: Array<{ state?: string }>;
        conflicts?: unknown[];
      };
    };
    assert(parsedData.source === "manual_email_dossier", "Inquiry should identify the manual dossier source.");
    assert(parsedData.loadDossier?.version === 1, "Load dossier should be versioned.");
    assert(parsedData.loadDossier?.sourceKey === OLYMPIAN_LOAD_SOURCE_KEY, "Load dossier source key should be stable.");
    assert(parsedData.loadDossier.facts?.some((fact) => fact.state === "missing"), "Load dossier should preserve missing facts.");
    assert(parsedData.loadDossier.facts?.some((fact) => fact.state === "conflict"), "Load dossier should preserve conflicting facts.");
    assert((parsedData.loadDossier.conflicts?.length ?? 0) > 0, "Load dossier should include explicit conflicts.");

    const [
      companyCount,
      inquiryCount,
      jobCount,
      threadCount,
      taskCount,
      quoteCount,
      auditCount,
      importEvents,
      memoryEvents,
    ] = await Promise.all([
      prisma.company.count({ where: { officeId: office.id, id: existingCompany.id } }),
      prisma.inquiry.count({ where: { officeId: office.id, reference: OLYMPIAN_LOAD_SOURCE_KEY } }),
      prisma.job.count({ where: { officeId: office.id, reference: OLYMPIAN_LOAD_SOURCE_KEY } }),
      prisma.emailThread.count({ where: { officeId: office.id, externalThreadId: `manual:${OLYMPIAN_LOAD_SOURCE_KEY}` } }),
      prisma.task.count({ where: { officeId: office.id, inquiryId: job.inquiry.id } }),
      prisma.carrierQuote.count({ where: { inquiryId: job.inquiry.id } }),
      prisma.auditLog.count({ where: { officeId: office.id, entityId: job.id, action: "load.created" } }),
      prisma.event.findMany({
        where: { officeId: office.id, entityId: job.id, type: "load.dossier_imported" },
        select: { payload: true },
      }),
      prisma.memoryEvent.findMany({
        where: {
          officeId: office.id,
          entityId: job.id,
          eventType: "job.dossier_imported",
        },
        select: {
          actorType: true,
          occurredAt: true,
          payloadVersion: true,
          payload: true,
        },
      }),
    ]);
    const eventCount = importEvents.length;
    const memoryCount = memoryEvents.length;

    assert(companyCount === 1, "Import should reuse one company.");
    assert(inquiryCount === 1, "Import should create exactly one inquiry.");
    assert(jobCount === 1, "Import should create exactly one job.");
    assert(threadCount === 1, "Import should create exactly one source thread.");
    assert(taskCount === fixture.tasks.length, "Open task count should match the fixture.");
    assert(quoteCount === 0, "Historical pricing must not create CarrierQuote rows.");
    assert(auditCount === 1, "Idempotent rerun must not duplicate the audit log.");
    assert(eventCount === 1, "Idempotent rerun must not duplicate the operational event.");
    assert(memoryCount === 1, "Idempotent rerun must not duplicate the memory event.");
    const eventPayload = importEvents[0]?.payload as {
      importVersion?: number;
      counts?: { messages?: number; documents?: number };
    };
    assert(eventPayload.importVersion === OLYMPIAN_LOAD_IMPORT_VERSION, "Operational event should be upgraded to the current import version.");
    assert(eventPayload.counts?.messages === fixture.messages.length, "Operational event should store the reconciled message count.");
    assert(eventPayload.counts?.documents === fixture.documents.length + 1, "Operational event should store actual persisted document rows.");
    const memoryEvent = memoryEvents[0];
    assert(memoryEvent.actorType === "system", "Memory provenance should use a stable system actor.");
    assert(memoryEvent.occurredAt.toISOString() === first.importedAt, "Memory occurrence time should remain the original import time.");
    assert(memoryEvent.payloadVersion === OLYMPIAN_LOAD_IMPORT_VERSION, "Memory event should be upgraded to the current import version.");
    const memoryPayload = memoryEvent.payload as {
      importedAt?: string;
      importVersion?: number;
      counts?: { messages?: number; documents?: number };
    };
    assert(memoryPayload.importedAt === first.importedAt, "Memory payload should preserve the stable import timestamp.");
    assert(memoryPayload.importVersion === OLYMPIAN_LOAD_IMPORT_VERSION, "Memory payload should store the current import version.");
    assert(memoryPayload.counts?.messages === fixture.messages.length, "Memory payload should store the reconciled message count.");
    assert(memoryPayload.counts?.documents === fixture.documents.length + 1, "Memory payload should store actual persisted document rows.");

    const secondOfficeCompany = await prisma.company.findUnique({
      where: {
        officeId_name: {
          officeId: secondOffice.id,
          name: OLYMPIAN_LOAD_COMPANY_NAME,
        },
      },
      select: {
        id: true,
      },
    });
    assert(secondOfficeCompany, "Importer should create the canonical company in an office with no alias.");

    console.log(JSON.stringify({
      ok: true,
      firstCreated: first.created,
      secondCreated: second.created,
      officeIsolation: otherOffice.job.id !== first.job.id,
      counts: {
        messages: job.emailThreads[0].messages.length,
        documents: job.documents.length,
        tasks: taskCount,
        milestones: job.milestones.length,
        carrierQuotes: quoteCount,
        memoryEvents: memoryCount,
      },
    }, null, 2));
  } finally {
    await prisma.office.deleteMany({
      where: {
        id: {
          in: [office.id, secondOffice.id],
        },
      },
    }).catch(() => null);
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
