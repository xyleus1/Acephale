import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordMemoryEvent } from "@/lib/memory/record-event";

export const OLYMPIAN_LOAD_SOURCE_KEY = "OM-O1-AUG2026-SHA-LAX";
export const OLYMPIAN_LOAD_COMPANY_NAME = "Olympian Motors, Inc.";
export const OLYMPIAN_LOAD_TITLE = "Olympian Motors: 2 Model O1 prototype EVs";
export const OLYMPIAN_LOAD_IMPORT_VERSION = 2;

const OLYMPIAN_COMPANY_ALIASES = [
  OLYMPIAN_LOAD_COMPANY_NAME,
  "Olympian Motors",
] as const;

const OLYMPIAN_THREAD_EXTERNAL_ID = `manual:${OLYMPIAN_LOAD_SOURCE_KEY}`;
const SOURCE_LABEL = "Olympian Model O1 email dossier";
const IMPORT_PATH = "src/lib/olympian-load.ts";

type DossierFactState = "source_stated" | "conflict" | "missing";

export type OlympianLoadDossier = {
  version: 1;
  sourceKey: typeof OLYMPIAN_LOAD_SOURCE_KEY;
  facts: Array<{
    key: string;
    label: string;
    value: string | number | null;
    state: DossierFactState;
    evidence: string[];
  }>;
  conflicts: Array<{
    title: string;
    detail: string;
    evidence: string[];
  }>;
  intendedUse: string;
  portOfLoading: string;
  portOfDischarge: string;
  finalDelivery: string;
};

type ImportActor = {
  userId?: string | null;
  email?: string | null;
};

export type OlympianLoadImportResult = {
  ok: true;
  created: boolean;
  officeId: string;
  companyId: string;
  inquiryId: string;
  job: {
    id: string;
    reference: string;
    title: string | null;
  };
  importedAt: string;
  counts: {
    messages: number;
    documents: number;
    tasks: number;
    milestones: number;
  };
  url: string;
};

export type OlympianLoadImportPreview = {
  mode: "dry-run";
  office: {
    id: string;
    name: string;
  };
  sourceKey: typeof OLYMPIAN_LOAD_SOURCE_KEY;
  existing: {
    id: string;
    reference: string;
    title: string | null;
  } | null;
  wouldCreate: boolean;
  records: {
    companies: 1;
    inquiries: 1;
    jobs: 1;
    threads: 1;
    messages: number;
    documents: number;
    tasks: number;
    milestones: number;
  };
  protectedUnknowns: string[];
};

type ImportedMessage = {
  key: string;
  sentAt: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  bodyText: string;
  classification: "RFQ" | "CARRIER_REPLY" | "CUSTOMER_REPLY" | "RELATED_NOTE";
};

type PendingDocument = {
  name: string;
  docType: "BOOKING" | "INVOICE" | "PACKING_LIST" | "BL" | "COO" | "CUSTOMS" | "OTHER";
};

type ImportTask = {
  key: string;
  title: string;
  details: string;
  priority: "critical" | "high";
};

type ImportMilestone = {
  type: string;
  plannedAt: Date | null;
  note: string;
};

const SANITIZED_MESSAGES: readonly ImportedMessage[] = [
  {
    key: "2026-04-24-quote-request",
    sentAt: "2026-04-24T18:48:00.000Z",
    fromName: "Olympian Motors",
    fromEmail: "olympian-source@manual-import.invalid",
    subject: "New Shipment: 2 Units Model O1 - Olympian Motors",
    bodyText: [
      "Sanitized source summary. Verify against the original email chain.",
      "Olympian requested a quote for two prototype Model O1 electric vehicles from Shanghai to Los Angeles in one 40-foot container.",
      "The request also asked for required documents, certifications, dangerous-goods reports, and hazard or test reports.",
    ].join("\n"),
    classification: "RFQ",
  },
  {
    key: "2026-04-29-delivery-and-equipment",
    sentAt: "2026-04-29T18:00:00.000Z",
    fromName: "Olympian Motors",
    fromEmail: "olympian-source@manual-import.invalid",
    subject: "Re: New Shipment: 2 Units Model O1 - Olympian Motors",
    bodyText: [
      "Sanitized source summary. Verify against the original email chain.",
      "Olympian confirmed one 40HC for two prototype vehicles and corrected final delivery to 15801 Rockfield Blvd, Unit K, Irvine, California.",
      "Later party details omitted Unit K, so the complete delivery address remains unresolved.",
    ].join("\n"),
    classification: "CUSTOMER_REPLY",
  },
  {
    key: "2026-04-30-revised-quote-evidence",
    sentAt: "2026-04-30T16:31:00.000Z",
    fromName: "Expeditors",
    fromEmail: "forwarder-source@manual-import.invalid",
    subject: "Re: New Shipment: 2 Units Model O1 - Olympian Motors",
    bodyText: [
      "Sanitized source summary. Verify against the original email chain.",
      "Expeditors revised the ocean freight evidence to USD 3,300 per 40HC and Shanghai-area pickup to USD 450 per vehicle.",
      "The customer message identified USD 680 drayage to Irvine. No validity date or current booking is present, so these amounts are historical evidence only and are not executable rates.",
    ].join("\n"),
    classification: "CARRIER_REPLY",
  },
  {
    key: "2026-07-21-schedule-and-dg-status",
    sentAt: "2026-07-21T19:00:00.000Z",
    fromName: "Olympian Motors",
    fromEmail: "olympian-source@manual-import.invalid",
    subject: "Re: Aug 2026 Shipment SHA-LAX",
    bodyText: [
      "Sanitized source summary. Verify against the original email chain.",
      "Olympian requested factory pickup on August 27, 2026 and a vessel window from August 31 through September 2, 2026.",
      "Olympian stated that battery and chassis MSDS files and UN38.3 materials were ready.",
      "No document attachment from that claim is stored in this import.",
      "The message did not include a carrier booking number, confirmed sailing, ETD, or ETA.",
    ].join("\n"),
    classification: "CUSTOMER_REPLY",
  },
  {
    key: "2026-07-23-complete-vehicle-msds-gap",
    sentAt: "2026-07-23T17:00:00.000Z",
    fromName: "China origin supplier",
    fromEmail: "supplier-source@manual-import.invalid",
    subject: "Re: Complete vehicle transport documents",
    bodyText: [
      "Sanitized source summary. Verify against the original email chain.",
      "The supplier stated that no complete-vehicle MSDS was available and that the vehicles were expected to return to China after use in the United States.",
      "This created an unresolved temporary-export and temporary-entry question.",
    ].join("\n"),
    classification: "RELATED_NOTE",
  },
  {
    key: "2026-07-24-carrier-and-port-guidance",
    sentAt: "2026-07-24T15:00:00.000Z",
    fromName: "Expeditors",
    fromEmail: "forwarder-source@manual-import.invalid",
    subject: "Re: Model O1 DG carrier acceptance",
    bodyText: [
      "Sanitized source summary. Verify against the original email chain.",
      "Expeditors reported that COSCO might accept a battery MSDS while other named carriers required a complete-vehicle MSDS.",
      "Shanghai port authorization was described as taking up to four weeks. No written carrier pre-acceptance or completed port authorization is present.",
    ].join("\n"),
    classification: "CARRIER_REPLY",
  },
  {
    key: "2026-07-24-no-ata-instruction",
    sentAt: "2026-07-24T20:00:00.000Z",
    fromName: "Olympian Motors",
    fromEmail: "olympian-source@manual-import.invalid",
    subject: "Re: Temporary import process",
    bodyText: [
      "Sanitized source summary. Verify against the original email chain.",
      "Olympian instructed the team to keep the move as a standard demo or show-car shipment and not use ATA.",
      "That instruction did not resolve the China export method, U.S. entry method, bond treatment, or re-export controls.",
    ].join("\n"),
    classification: "CUSTOMER_REPLY",
  },
] as const;

const LEGACY_MESSAGE_KEYS = [
  "2026-05-delivery-and-equipment",
  "2026-07-21-schedule-request",
  "2026-07-21-dg-files-claimed-ready",
] as const;

const PENDING_DOCUMENTS: readonly PendingDocument[] = [
  { name: "Booking Confirmation", docType: "BOOKING" },
  { name: "Commercial Invoice", docType: "INVOICE" },
  { name: "Packing List", docType: "PACKING_LIST" },
  { name: "Bill of Lading", docType: "BL" },
  { name: "Certificate of Origin", docType: "COO" },
  { name: "Customs Declaration", docType: "CUSTOMS" },
  { name: "Complete Vehicle MSDS", docType: "OTHER" },
  { name: "UN38.3 Test Summary (claimed ready, file needed)", docType: "OTHER" },
  { name: "Vehicle Transport Condition Appraisal", docType: "OTHER" },
  { name: "Shanghai Port DG Authorization", docType: "OTHER" },
  { name: "Exporter License and Authorization", docType: "OTHER" },
  { name: "Loading and Securing Plan", docType: "OTHER" },
  { name: "NHTSA HS-7 Declaration Basis", docType: "CUSTOMS" },
  { name: "EPA Form 3520-1 Declaration Basis", docType: "CUSTOMS" },
  { name: "U.S. Entry and Re-export Plan", docType: "CUSTOMS" },
] as const;

const IMPORT_TASKS: readonly ImportTask[] = [
  {
    key: "vehicle-specifications",
    title: "Get complete specifications for both vehicles",
    details: "Confirm each VIN or chassis identifier, exact model, dimensions, net and gross weight, battery capacity, motor power, and seat count. The shipment says two units, but one supplier row says one EA.",
    priority: "critical",
  },
  {
    key: "exporter-dg-entity",
    title: "Resolve exporter and DG filing entity",
    details: "Confirm the legal exporter, export-license holder, invoice seller, manufacturer, dangerous-goods declarant, and port-filing entity. Do not assume Launch Design, Sensteed, and Shanghai Launch Automotive are interchangeable.",
    priority: "critical",
  },
  {
    key: "vehicle-msds-carrier-acceptance",
    title: "Obtain whole-vehicle MSDS or carrier pre-acceptance",
    details: "Get the complete-vehicle MSDS and transport-condition appraisal, or written carrier pre-acceptance for the exact two-vehicle shipment before treating the DG path as viable.",
    priority: "critical",
  },
  {
    key: "shanghai-port-authorization",
    title: "Confirm Shanghai port authorization status",
    details: "Record whether port authorization is approved, submitted, or not started, including the filing entity and expected completion date.",
    priority: "critical",
  },
  {
    key: "loading-securing-plan",
    title: "Approve loading and securing plan",
    details: "Confirm factory pickup location, loading party, vehicle wrapping, blocking, bracing, state of charge, key control, and emergency contact requirements.",
    priority: "high",
  },
  {
    key: "irvine-delivery-address",
    title: "Confirm the final Irvine delivery address",
    details: "Confirm whether Unit K is required at 15801 Rockfield Blvd, Irvine, California 92618 and identify the receiving contact.",
    priority: "high",
  },
  {
    key: "us-entry-reexport-plan",
    title: "Get a broker-written U.S. entry and re-export plan",
    details: "Confirm CBP entry type, TIB or other bond treatment, NHTSA HS-7 basis, EPA Form 3520-1 basis, importer of record, broker, ISF filer, permitted vehicle use, and re-export controls. The no-ATA instruction is not a customs plan.",
    priority: "critical",
  },
  {
    key: "commercial-customs-fields",
    title: "Confirm value, currency, Incoterm, and HTS",
    details: "Obtain the commercial invoice value and currency, Incoterm, valuation method, proposed HTS classification, and expected duty or tariff review.",
    priority: "critical",
  },
  {
    key: "carrier-booking",
    title: "Secure and record the carrier booking",
    details: "After the DG and port path is accepted, record carrier, service, booking number, confirmed ETD, ETA, terminal, container number, and document cutoffs.",
    priority: "high",
  },
] as const;

const IMPORT_MILESTONES: readonly ImportMilestone[] = [
  {
    type: "BOOKING",
    plannedAt: null,
    note: "No carrier booking is proven in the source emails.",
  },
  {
    type: "CARGO_READY",
    plannedAt: new Date("2026-08-27T12:00:00.000Z"),
    note: "Source-stated Shanghai factory pickup target. Not confirmed as completed.",
  },
  {
    type: "ETD",
    plannedAt: new Date("2026-08-31T12:00:00.000Z"),
    note: "Requested vessel window starts August 31 and ends September 2, 2026. No sailing is confirmed.",
  },
  {
    type: "ETA",
    plannedAt: null,
    note: "ETA is missing.",
  },
  {
    type: "CUSTOMS_ENTRY",
    plannedAt: null,
    note: "U.S. entry method and broker plan are unresolved.",
  },
  {
    type: "DELIVERY",
    plannedAt: null,
    note: "Final delivery is Irvine, California. Delivery date is unknown.",
  },
] as const;

const PROTECTED_UNKNOWNS = [
  "carrier booking, service, booking number, container number, ETD, and ETA",
  "current executable carrier rate, cost, revenue, and target price",
  "Incoterm, commercial value, currency, and HTS classification",
  "vehicle weights, VINs, complete battery specifications, and the second vehicle detail row",
  "written carrier acceptance, completed Shanghai port authorization, and customs clearance",
  "U.S. customs broker, entry type, TIB eligibility, HS-7 basis, EPA basis, and re-export controls",
] as const;

function buildLoadDossier(): OlympianLoadDossier {
  return {
    version: 1,
    sourceKey: OLYMPIAN_LOAD_SOURCE_KEY,
    facts: [
      {
        key: "vehicle_count",
        label: "Vehicle count",
        value: 2,
        state: "conflict",
        evidence: [
          "Shipment-level emails state two prototype vehicles.",
          "One supplier detail row states one EA and does not provide a complete second vehicle row.",
        ],
      },
      {
        key: "vehicle_model",
        label: "Vehicle model",
        value: "Model O1 Coupe prototype battery-electric vehicles",
        state: "source_stated",
        evidence: ["Olympian shipment request dated April 24, 2026."],
      },
      {
        key: "container",
        label: "Equipment",
        value: "1 x 40HC",
        state: "source_stated",
        evidence: ["Olympian pricing and equipment follow-up."],
      },
      {
        key: "historical_rate_evidence",
        label: "Historical quote evidence",
        value: "USD 3,300 per 40HC ocean; USD 450 pickup per vehicle; USD 680 Irvine drayage",
        state: "source_stated",
        evidence: [
          "Expeditors revised-rate email dated April 30, 2026.",
          "No validity date, current booking, or current carrier acceptance is present. Evidence only, not an executable quote.",
        ],
      },
      {
        key: "factory_pickup",
        label: "Factory pickup target",
        value: "2026-08-27",
        state: "source_stated",
        evidence: ["Olympian schedule request dated July 21, 2026."],
      },
      {
        key: "vessel_window",
        label: "Requested vessel window",
        value: "2026-08-31 through 2026-09-02",
        state: "source_stated",
        evidence: ["Olympian schedule request dated July 21, 2026."],
      },
      {
        key: "booking_status",
        label: "Carrier booking",
        value: null,
        state: "missing",
        evidence: ["No booking number, carrier confirmation, bill of lading, container number, ETD, or ETA appears in the reviewed evidence."],
      },
      {
        key: "dangerous_goods",
        label: "Dangerous goods",
        value: "Installed vehicle batteries; carrier and port acceptance unresolved",
        state: "source_stated",
        evidence: ["Expeditors and origin suppliers discussed complete-vehicle MSDS, UN38.3, transport appraisal, and Shanghai port authorization."],
      },
      {
        key: "complete_vehicle_msds",
        label: "Complete-vehicle MSDS",
        value: null,
        state: "missing",
        evidence: ["Supplier message dated July 23, 2026 states that no complete-vehicle MSDS was available."],
      },
      {
        key: "carrier_acceptance",
        label: "Written carrier DG acceptance",
        value: null,
        state: "missing",
        evidence: ["Expeditors reported a possible COSCO path, but no written acceptance is present."],
      },
      {
        key: "incoterm",
        label: "Incoterm",
        value: null,
        state: "missing",
        evidence: ["No Incoterm appears in the reviewed shipment evidence."],
      },
      {
        key: "commercial_value",
        label: "Commercial value",
        value: null,
        state: "missing",
        evidence: ["No final commercial invoice value or currency appears in the reviewed shipment evidence."],
      },
      {
        key: "temporary_entry",
        label: "Temporary-entry strategy",
        value: "Vehicles are expected to return to China; Olympian instructed no ATA",
        state: "conflict",
        evidence: [
          "Supplier message dated July 23, 2026 says the vehicles must return to China.",
          "Olympian message dated July 24, 2026 says not to use ATA.",
          "No replacement China export or U.S. entry plan is documented.",
        ],
      },
      {
        key: "delivery_address",
        label: "Final delivery address",
        value: "15801 Rockfield Blvd, Irvine, CA 92618",
        state: "conflict",
        evidence: [
          "An earlier correction includes Unit K.",
          "The final party summary omits Unit K.",
        ],
      },
    ],
    conflicts: [
      {
        title: "Shipment count versus supplier detail row",
        detail: "The shipment is consistently described as two vehicles in one 40HC, but one supplier row states one EA and does not provide a complete second vehicle record.",
        evidence: ["Olympian shipment emails.", "Supplier detail row summarized in the source dossier."],
      },
      {
        title: "Vehicle packaging responsibility",
        detail: "The factory described bare vehicles, while other messages discussed wrapping and protective foam. No approved loading and securing plan is present.",
        evidence: ["Origin supplier packaging statement.", "Expeditors packaging discussion."],
      },
      {
        title: "Temporary return without ATA",
        detail: "The vehicles are expected to return to China, but Olympian instructed the team not to use ATA. No approved replacement export and entry strategy is documented.",
        evidence: ["Supplier return-to-China statement dated July 23, 2026.", "Olympian no-ATA instruction dated July 24, 2026."],
      },
      {
        title: "Final delivery unit",
        detail: "One message specifies Unit K, while the final party summary omits the unit.",
        evidence: ["Olympian delivery-address correction.", "Final party summary."],
      },
    ],
    intendedUse: "Show, demo, or display vehicles. The supplier states that the vehicles must return to China.",
    portOfLoading: "Shanghai, China. Exact terminal is not stated.",
    portOfDischarge: "Los Angeles, California. Exact terminal is not stated.",
    finalDelivery: "Olympian R&D Lab / Warehouse, 15801 Rockfield Blvd, Irvine, CA 92618. Confirm whether Unit K is required.",
  };
}

function parsedDataJson() {
  return JSON.stringify({
    source: "manual_email_dossier",
    facts: {
      countryOfExport: "China",
      portOfLoading: "Shanghai, China. Exact terminal is not stated.",
      portOfUnlading: "Los Angeles, California. Exact terminal is not stated.",
      finalDelivery: "Olympian R&D Lab / Warehouse, 15801 Rockfield Blvd, Irvine, CA 92618. Confirm whether Unit K is required.",
      model: "Model O1 Coupe prototype battery-electric vehicle",
      principalFunction: "Prototype passenger electric vehicle for show, demo, or display use",
      intendedUse: "Show, demo, or display vehicles. The supplier states that the vehicles must return to China.",
      batteriesInstalled: true,
      packaging: "Conflict: factory described bare vehicles while other messages discussed wrapping and protective foam.",
      returnPlan: "Supplier states return to China; no approved export, U.S. entry, or re-export plan is documented.",
    },
    loadDossier: buildLoadDossier(),
  });
}

function isImportedInquiry(parsedData: string | null | undefined) {
  if (!parsedData) return false;
  try {
    const parsed = JSON.parse(parsedData) as {
      loadDossier?: {
        sourceKey?: unknown;
      };
    };
    return parsed.loadDossier?.sourceKey === OLYMPIAN_LOAD_SOURCE_KEY;
  } catch {
    return false;
  }
}

function sourceRefs(itemKey?: string): Prisma.InputJsonValue {
  return {
    source: "manual_email_dossier",
    sourceKey: OLYMPIAN_LOAD_SOURCE_KEY,
    importVersion: OLYMPIAN_LOAD_IMPORT_VERSION,
    ...(itemKey ? { itemKey } : {}),
    evidencePeriod: {
      from: "2026-04-24",
      to: "2026-07-24",
    },
  };
}

function provenance(operation: string): Prisma.InputJsonValue {
  return {
    source: "manual_email_dossier",
    operation,
    path: IMPORT_PATH,
    sourceExternalId: OLYMPIAN_LOAD_SOURCE_KEY,
    importVersion: OLYMPIAN_LOAD_IMPORT_VERSION,
  };
}

function expectedImportCounts() {
  return {
    messages: SANITIZED_MESSAGES.length,
    documents: PENDING_DOCUMENTS.length,
    tasks: IMPORT_TASKS.length,
    milestones: IMPORT_MILESTONES.length,
  };
}

type ImportedLoadIdentity = {
  officeId: string;
  companyId: string;
  inquiryId: string;
  job: {
    id: string;
    reference: string;
    title: string | null;
    createdAt: Date;
  };
};

async function existingImportedLoad(
  db: Prisma.TransactionClient | typeof prisma,
  officeId: string,
): Promise<ImportedLoadIdentity | null> {
  const job = await db.job.findUnique({
    where: {
      officeId_reference: {
        officeId,
        reference: OLYMPIAN_LOAD_SOURCE_KEY,
      },
    },
    select: {
      id: true,
      reference: true,
      title: true,
      createdAt: true,
      companyId: true,
      inquiryId: true,
      company: {
        select: {
          officeId: true,
        },
      },
      inquiry: {
        select: {
          officeId: true,
          companyId: true,
          parsedData: true,
        },
      },
      emailThreads: {
        where: {
          externalThreadId: OLYMPIAN_THREAD_EXTERNAL_ID,
        },
        select: {
          id: true,
        },
        take: 2,
      },
    },
  });

  if (!job) return null;
  if (!job.companyId || !job.inquiryId) {
    throw new Error(`Reference ${OLYMPIAN_LOAD_SOURCE_KEY} exists but is missing its company or inquiry link.`);
  }
  if (job.company?.officeId !== officeId) {
    throw new Error(`Reference ${OLYMPIAN_LOAD_SOURCE_KEY} is linked to a company outside office ${officeId}.`);
  }
  if (job.inquiry?.officeId !== officeId) {
    throw new Error(`Reference ${OLYMPIAN_LOAD_SOURCE_KEY} is linked to an inquiry outside office ${officeId}.`);
  }
  if (job.inquiry.companyId !== job.companyId) {
    throw new Error(`Reference ${OLYMPIAN_LOAD_SOURCE_KEY} has mismatched company links.`);
  }
  if (!isImportedInquiry(job.inquiry?.parsedData) && job.emailThreads.length === 0) {
    throw new Error(`Reference ${OLYMPIAN_LOAD_SOURCE_KEY} is already used by a different load.`);
  }
  if (job.emailThreads.length > 1) {
    throw new Error(`Reference ${OLYMPIAN_LOAD_SOURCE_KEY} has duplicate imported source threads.`);
  }

  return {
    officeId,
    companyId: job.companyId,
    inquiryId: job.inquiryId,
    job: {
      id: job.id,
      reference: job.reference,
      title: job.title,
      createdAt: job.createdAt,
    },
  };
}

function importedMessageExternalId(officeId: string, key: string) {
  return `manual:${officeId}:${OLYMPIAN_LOAD_SOURCE_KEY}:${key}`;
}

async function ensureImportedThread(
  tx: Prisma.TransactionClient,
  identity: ImportedLoadIdentity,
) {
  const markerThreads = await tx.emailThread.findMany({
    where: {
      officeId: identity.officeId,
      externalThreadId: OLYMPIAN_THREAD_EXTERNAL_ID,
    },
    select: {
      id: true,
      jobId: true,
      inquiryId: true,
      companyId: true,
    },
    take: 2,
  });
  if (markerThreads.length > 1) {
    throw new Error(`Source marker ${OLYMPIAN_THREAD_EXTERNAL_ID} has duplicate threads.`);
  }

  const existing = markerThreads[0];
  if (existing) {
    if (
      existing.jobId !== identity.job.id
      || existing.inquiryId !== identity.inquiryId
      || existing.companyId !== identity.companyId
    ) {
      throw new Error(`Source marker ${OLYMPIAN_THREAD_EXTERNAL_ID} is linked to a different record.`);
    }
    return existing.id;
  }

  const created = await tx.emailThread.create({
    data: {
      officeId: identity.officeId,
      jobId: identity.job.id,
      inquiryId: identity.inquiryId,
      companyId: identity.companyId,
      subject: "Olympian Model O1 Aug 2026 shipment dossier",
      participants: JSON.stringify([
        "olympian-source@manual-import.invalid",
        "forwarder-source@manual-import.invalid",
        "supplier-source@manual-import.invalid",
      ]),
      externalThreadId: OLYMPIAN_THREAD_EXTERNAL_ID,
      autoLinkedAt: identity.job.createdAt,
      autoLinkSkipReason: `Manual sanitized dossier import version ${OLYMPIAN_LOAD_IMPORT_VERSION}, not a provider-synced thread.`,
      lastMessageAt: new Date(SANITIZED_MESSAGES[SANITIZED_MESSAGES.length - 1].sentAt),
      messageCount: 0,
    },
    select: {
      id: true,
    },
  });
  return created.id;
}

async function reconcileImportedMessages(
  tx: Prisma.TransactionClient,
  officeId: string,
  threadId: string,
) {
  const legacyExternalIds = LEGACY_MESSAGE_KEYS.map((key) => importedMessageExternalId(officeId, key));
  await tx.emailMessage.deleteMany({
    where: {
      threadId,
      externalId: {
        in: legacyExternalIds,
      },
    },
  });

  await tx.emailMessage.createMany({
    data: SANITIZED_MESSAGES.map((message) => ({
      threadId,
      accountId: null,
      externalId: importedMessageExternalId(officeId, message.key),
      direction: "INBOUND" as const,
      fromEmail: message.fromEmail,
      fromName: message.fromName,
      toEmails: JSON.stringify(["derya-operations@manual-import.invalid"]),
      subject: message.subject,
      bodyText: message.bodyText,
      sentAt: new Date(message.sentAt),
      isRead: true,
      classification: message.classification,
      classificationReason: `Sanitized manual dossier evidence, import version ${OLYMPIAN_LOAD_IMPORT_VERSION}. Verify against the original source email.`,
      classificationAt: new Date("2026-07-24T20:00:00.000Z"),
    })),
    skipDuplicates: true,
  });

  const [messageCount, latestMessage] = await Promise.all([
    tx.emailMessage.count({
      where: {
        threadId,
      },
    }),
    tx.emailMessage.aggregate({
      where: {
        threadId,
      },
      _max: {
        sentAt: true,
      },
    }),
  ]);
  await tx.emailThread.update({
    where: {
      id: threadId,
    },
    data: {
      messageCount,
      lastMessageAt: latestMessage._max.sentAt
        ?? new Date(SANITIZED_MESSAGES[SANITIZED_MESSAGES.length - 1].sentAt),
      autoLinkSkipReason: `Manual sanitized dossier import version ${OLYMPIAN_LOAD_IMPORT_VERSION}, not a provider-synced thread.`,
    },
  });
}

async function reconcileImportedDocuments(
  tx: Prisma.TransactionClient,
  identity: ImportedLoadIdentity,
) {
  const names = PENDING_DOCUMENTS.map((document) => document.name);
  const existing = await tx.jobDocument.findMany({
    where: {
      jobId: identity.job.id,
      officeId: identity.officeId,
      name: {
        in: names,
      },
    },
    select: {
      name: true,
    },
  });
  const existingNames = new Set(existing.map((document) => document.name));
  const missing = PENDING_DOCUMENTS.filter((document) => !existingNames.has(document.name));
  if (missing.length === 0) return;

  await tx.jobDocument.createMany({
    data: missing.map((document) => ({
      jobId: identity.job.id,
      officeId: identity.officeId,
      name: document.name,
      docType: document.docType,
      status: "PENDING",
    })),
  });
}

async function reconcileImportedTasks(
  tx: Prisma.TransactionClient,
  identity: ImportedLoadIdentity,
  actor: ImportActor,
) {
  const titles = IMPORT_TASKS.map((task) => task.title);
  const existing = await tx.task.findMany({
    where: {
      officeId: identity.officeId,
      inquiryId: identity.inquiryId,
      source: "manual_email_dossier",
      title: {
        in: titles,
      },
    },
    select: {
      title: true,
    },
  });
  const existingTitles = new Set(existing.map((task) => task.title));
  const missing = IMPORT_TASKS.filter((task) => !existingTitles.has(task.title));
  if (missing.length === 0) return;

  await tx.task.createMany({
    data: missing.map((task) => ({
      officeId: identity.officeId,
      companyId: identity.companyId,
      inquiryId: identity.inquiryId,
      title: task.title,
      details: task.details,
      status: "OPEN" as const,
      priority: task.priority,
      source: "manual_email_dossier",
      sourceRefs: sourceRefs(task.key),
      provenance: provenance("create_open_issue"),
      createdByUserId: actor.userId ?? null,
    })),
  });
}

async function reconcileImportedMilestones(
  tx: Prisma.TransactionClient,
  identity: ImportedLoadIdentity,
) {
  const types = IMPORT_MILESTONES.map((milestone) => milestone.type);
  const existing = await tx.jobMilestone.findMany({
    where: {
      jobId: identity.job.id,
      type: {
        in: types,
      },
    },
    select: {
      type: true,
    },
  });
  const existingTypes = new Set(existing.map((milestone) => milestone.type));
  const missing = IMPORT_MILESTONES.filter((milestone) => !existingTypes.has(milestone.type));
  if (missing.length === 0) return;

  await tx.jobMilestone.createMany({
    data: missing.map((milestone) => ({
      jobId: identity.job.id,
      type: milestone.type,
      plannedAt: milestone.plannedAt,
      actualAt: null,
      note: milestone.note,
    })),
  });
}

async function actualImportedCounts(
  tx: Prisma.TransactionClient,
  identity: ImportedLoadIdentity,
  threadId: string,
) {
  const currentMessageIds = SANITIZED_MESSAGES.map((message) =>
    importedMessageExternalId(identity.officeId, message.key)
  );
  const documentNames = PENDING_DOCUMENTS.map((document) => document.name);
  const taskTitles = IMPORT_TASKS.map((task) => task.title);
  const milestoneTypes = IMPORT_MILESTONES.map((milestone) => milestone.type);
  const [messages, documents, tasks, milestones] = await Promise.all([
    tx.emailMessage.count({
      where: {
        threadId,
        externalId: {
          in: currentMessageIds,
        },
      },
    }),
    tx.jobDocument.count({
      where: {
        jobId: identity.job.id,
        officeId: identity.officeId,
        name: {
          in: documentNames,
        },
      },
    }),
    tx.task.count({
      where: {
        officeId: identity.officeId,
        inquiryId: identity.inquiryId,
        source: "manual_email_dossier",
        title: {
          in: taskTitles,
        },
      },
    }),
    tx.jobMilestone.count({
      where: {
        jobId: identity.job.id,
        type: {
          in: milestoneTypes,
        },
      },
    }),
  ]);
  return {
    messages,
    documents,
    tasks,
    milestones,
  };
}

async function reconcileImportAudit(
  tx: Prisma.TransactionClient,
  identity: ImportedLoadIdentity,
  actor: ImportActor,
  actorEmail: string,
) {
  const existing = await tx.auditLog.findFirst({
    where: {
      officeId: identity.officeId,
      action: "load.created",
      entityType: "job",
      entityId: identity.job.id,
      entityRef: identity.job.reference,
      summary: "Imported the Olympian shipment dossier",
    },
    select: {
      id: true,
    },
  });
  if (existing) return;

  await tx.auditLog.create({
    data: {
      officeId: identity.officeId,
      actorUserId: actor.userId ?? null,
      actorEmail,
      action: "load.created",
      entityType: "job",
      entityId: identity.job.id,
      entityRef: identity.job.reference,
      summary: "Imported the Olympian shipment dossier",
    },
  });
}

async function reconcileImportEvent(
  tx: Prisma.TransactionClient,
  identity: ImportedLoadIdentity,
  counts: OlympianLoadImportResult["counts"],
) {
  const existing = await tx.event.findFirst({
    where: {
      officeId: identity.officeId,
      type: "load.dossier_imported",
      entityType: "job",
      entityId: identity.job.id,
    },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      id: true,
    },
  });
  const payload = {
    sourceKey: OLYMPIAN_LOAD_SOURCE_KEY,
    importVersion: OLYMPIAN_LOAD_IMPORT_VERSION,
    inquiryId: identity.inquiryId,
    companyId: identity.companyId,
    counts,
    factsRequireReview: true,
    notSent: true,
  };
  if (existing) {
    await tx.event.update({
      where: {
        id: existing.id,
      },
      data: {
        payload,
      },
    });
    return;
  }

  await tx.event.create({
    data: {
      officeId: identity.officeId,
      type: "load.dossier_imported",
      entityType: "job",
      entityId: identity.job.id,
      payload,
    },
  });
}

async function reconcileImportedChildren(
  tx: Prisma.TransactionClient,
  identity: ImportedLoadIdentity,
  actor: ImportActor,
  actorEmail: string,
) {
  const threadId = await ensureImportedThread(tx, identity);
  await reconcileImportedMessages(tx, identity.officeId, threadId);
  await Promise.all([
    reconcileImportedDocuments(tx, identity),
    reconcileImportedTasks(tx, identity, actor),
    reconcileImportedMilestones(tx, identity),
    reconcileImportAudit(tx, identity, actor, actorEmail),
  ]);
  const counts = await actualImportedCounts(tx, identity, threadId);
  await reconcileImportEvent(tx, identity, counts);
  return counts;
}

async function findOrCreateCompany(tx: Prisma.TransactionClient, officeId: string) {
  const matches = await tx.company.findMany({
    where: {
      officeId,
      OR: OLYMPIAN_COMPANY_ALIASES.map((name) => ({
        name: {
          equals: name,
          mode: "insensitive" as const,
        },
      })),
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (matches.length > 1) {
    throw new Error("Multiple Olympian Motors company records exist in this office. Merge or select the correct company before importing.");
  }
  if (matches[0]) return matches[0];

  return tx.company.upsert({
    where: {
      officeId_name: {
        officeId,
        name: OLYMPIAN_LOAD_COMPANY_NAME,
      },
    },
    update: {},
    create: {
      officeId,
      name: OLYMPIAN_LOAD_COMPANY_NAME,
      status: "WORKED",
      product: "Sea",
      lane: "China to U.S. West Coast",
      direction: "Import",
      crmSource: "manual_email_dossier",
      sourceRefs: sourceRefs(),
      crmNotes: "Current Model O1 prototype vehicle shipment dossier imported for operator review.",
    },
    select: {
      id: true,
      name: true,
    },
  });
}

async function recordImportMemory(
  result: OlympianLoadImportResult,
) {
  await recordMemoryEvent({
    officeId: result.officeId,
    sourceType: "JOB",
    sourceExternalId: `manual_email_dossier:${OLYMPIAN_LOAD_SOURCE_KEY}`,
    sourceLabel: SOURCE_LABEL,
    sourceMetadata: {
      sourceKey: OLYMPIAN_LOAD_SOURCE_KEY,
      importVersion: OLYMPIAN_LOAD_IMPORT_VERSION,
      evidencePeriod: {
        from: "2026-04-24",
        to: "2026-07-24",
      },
    },
    eventType: "job.dossier_imported",
    entityType: "job",
    entityId: result.job.id,
    actorType: "system",
    actorId: null,
    occurredAt: result.importedAt,
    payloadVersion: OLYMPIAN_LOAD_IMPORT_VERSION,
    payload: {
      jobId: result.job.id,
      inquiryId: result.inquiryId,
      companyId: result.companyId,
      sourceKey: OLYMPIAN_LOAD_SOURCE_KEY,
      importVersion: OLYMPIAN_LOAD_IMPORT_VERSION,
      importedAt: result.importedAt,
      counts: result.counts,
      notSent: true,
    },
    provenance: {
      source: "manual_email_dossier",
      operation: "import_olympian_load",
      path: IMPORT_PATH,
      function: "importOlympianLoad",
      sourceRecordId: result.job.id,
      sourceExternalId: OLYMPIAN_LOAD_SOURCE_KEY,
      actorType: "system",
      actorId: null,
      notes: ["Operator trigger is preserved in the load audit log."],
    },
    idempotencyKey: `manual_email_dossier:${OLYMPIAN_LOAD_SOURCE_KEY}:job:${result.job.id}:imported`,
  }).catch(() => null);
}

export async function previewOlympianLoadImport(
  officeId: string,
): Promise<OlympianLoadImportPreview> {
  const office = await prisma.office.findUnique({
    where: {
      id: officeId,
    },
    select: {
      id: true,
      name: true,
    },
  });
  if (!office) throw new Error(`Office ${officeId} was not found.`);

  const existing = await existingImportedLoad(prisma, officeId);
  return {
    mode: "dry-run",
    office,
    sourceKey: OLYMPIAN_LOAD_SOURCE_KEY,
    existing: existing?.job ?? null,
    wouldCreate: !existing,
    records: {
      companies: 1,
      inquiries: 1,
      jobs: 1,
      threads: 1,
      ...expectedImportCounts(),
    },
    protectedUnknowns: [...PROTECTED_UNKNOWNS],
  };
}

export async function importOlympianLoad(input: {
  officeId: string;
  actor?: ImportActor;
}): Promise<OlympianLoadImportResult> {
  const actor = input.actor ?? {};
  const actorEmail = actor.email?.trim() || "system@manual-import.invalid";
  const lockKey = `manual_email_dossier:${input.officeId}:${OLYMPIAN_LOAD_SOURCE_KEY}`;

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

    const office = await tx.office.findUnique({
      where: {
        id: input.officeId,
      },
      select: {
        id: true,
      },
    });
    if (!office) throw new Error(`Office ${input.officeId} was not found.`);

    const existing = await existingImportedLoad(tx, input.officeId);
    if (existing) {
      const counts = await reconcileImportedChildren(tx, existing, actor, actorEmail);
      return {
        ok: true as const,
        created: false,
        officeId: existing.officeId,
        companyId: existing.companyId,
        inquiryId: existing.inquiryId,
        job: {
          id: existing.job.id,
          reference: existing.job.reference,
          title: existing.job.title,
        },
        importedAt: existing.job.createdAt.toISOString(),
        counts,
        url: `/dashboard/jobs/${existing.job.id}`,
      };
    }

    const existingInquiry = await tx.inquiry.findUnique({
      where: {
        officeId_reference: {
          officeId: input.officeId,
          reference: OLYMPIAN_LOAD_SOURCE_KEY,
        },
      },
      select: {
        id: true,
      },
    });
    if (existingInquiry) {
      throw new Error(`Reference ${OLYMPIAN_LOAD_SOURCE_KEY} is already used by a different inquiry.`);
    }

    const markerThreads = await tx.emailThread.findMany({
      where: {
        officeId: input.officeId,
        externalThreadId: OLYMPIAN_THREAD_EXTERNAL_ID,
      },
      select: {
        id: true,
      },
      take: 2,
    });
    if (markerThreads.length > 0) {
      throw new Error(`Source marker ${OLYMPIAN_THREAD_EXTERNAL_ID} already exists without the expected load.`);
    }

    const company = await findOrCreateCompany(tx, input.officeId);
    const parsedData = parsedDataJson();
    const inquiry = await tx.inquiry.create({
      data: {
        officeId: input.officeId,
        companyId: company.id,
        reference: OLYMPIAN_LOAD_SOURCE_KEY,
        subject: "New Shipment: 2 Units Model O1 - Olympian Motors",
        fromEmail: "olympian-source@manual-import.invalid",
        fromCompany: OLYMPIAN_LOAD_COMPANY_NAME,
        origin: "Shanghai, China",
        destination: "Irvine, CA, USA",
        mode: "SEA-FCL",
        containerCount: 1,
        containerType: "40HC",
        dangerousGoods: "YES",
        customsBy: "UNKNOWN",
        commodity: "2 prototype Model O1 Coupe battery-electric vehicles with installed batteries",
        targetPriceStatus: "UNKNOWN",
        cargoReadyDate: new Date("2026-08-27T12:00:00.000Z"),
        type: "FORWARDING",
        status: "QUOTED",
        rawEmailBody: SANITIZED_MESSAGES[0].bodyText,
        manualDetails: "Manual dossier import from overlapping email chains. Facts remain source-stated until an operator verifies the original message or document.",
        parsedData,
        notes: "One deduplicated shipment dossier. No carrier booking, executable rate, customs plan, or government approval is confirmed.",
        receivedAt: new Date("2026-04-24T18:48:00.000Z"),
      },
      select: {
        id: true,
      },
    });

    const job = await tx.job.create({
      data: {
        officeId: input.officeId,
        companyId: company.id,
        inquiryId: inquiry.id,
        reference: OLYMPIAN_LOAD_SOURCE_KEY,
        title: OLYMPIAN_LOAD_TITLE,
        cadence: "ONE_OFF",
        status: "QUOTED",
        type: "FORWARDING",
        mode: "SEA-FCL",
        origin: "Shanghai, China",
        destination: "Irvine, CA, USA",
        commodity: "2 prototype Model O1 Coupe battery-electric vehicles with installed batteries",
        dangerousGoods: "YES",
        customsBy: "UNKNOWN",
        containerCount: 1,
        containerType: "40HC",
        quantity: 2,
        quantityUnit: "UNITS",
        targetPriceStatus: "UNKNOWN",
        currency: "USD",
        notifyCustomer: false,
        customerEmail: null,
        notes: [
          `Source dossier: ${OLYMPIAN_LOAD_SOURCE_KEY}.`,
          "Ocean route is Shanghai to Los Angeles with final delivery in Irvine.",
          "No carrier booking, confirmed ETD or ETA, executable rate, customs strategy, or government approval is present.",
          "Historical email pricing remains evidence only and is not loaded into quote, cost, revenue, or target-price fields.",
        ].join(" "),
      },
      select: {
        id: true,
        reference: true,
        title: true,
        createdAt: true,
      },
    });

    const identity: ImportedLoadIdentity = {
      officeId: input.officeId,
      companyId: company.id,
      inquiryId: inquiry.id,
      job,
    };
    const counts = await reconcileImportedChildren(tx, identity, actor, actorEmail);

    return {
      ok: true as const,
      created: true,
      officeId: input.officeId,
      companyId: company.id,
      inquiryId: inquiry.id,
      job: {
        id: job.id,
        reference: job.reference,
        title: job.title,
      },
      importedAt: job.createdAt.toISOString(),
      counts,
      url: `/dashboard/jobs/${job.id}`,
    };
  }, {
    timeout: 20_000,
  });

  await recordImportMemory(result);
  return result;
}

export async function resolveOlympianImportOffice(
  requestedOfficeId?: string | null,
) {
  if (requestedOfficeId?.trim()) {
    const office = await prisma.office.findUnique({
      where: {
        id: requestedOfficeId.trim(),
      },
      select: {
        id: true,
        name: true,
      },
    });
    if (!office) throw new Error(`Office ${requestedOfficeId.trim()} was not found.`);
    return office;
  }

  const offices = await prisma.office.findMany({
    select: {
      id: true,
      name: true,
    },
    orderBy: {
      createdAt: "asc",
    },
    take: 2,
  });
  if (offices.length === 0) throw new Error("No office exists.");
  if (offices.length > 1) {
    throw new Error("Multiple offices exist. Pass --office=<officeId> so the import cannot target the wrong tenant.");
  }
  return offices[0];
}

export function getOlympianLoadImportFixture() {
  return {
    sourceKey: OLYMPIAN_LOAD_SOURCE_KEY,
    companyName: OLYMPIAN_LOAD_COMPANY_NAME,
    title: OLYMPIAN_LOAD_TITLE,
    parsedData: JSON.parse(parsedDataJson()) as {
      source: "manual_email_dossier";
      facts: {
        countryOfExport: string;
        portOfLoading: string;
        portOfUnlading: string;
        finalDelivery: string;
        model: string;
        principalFunction: string;
        intendedUse: string;
        batteriesInstalled: true;
        packaging: string;
        returnPlan: string;
      };
      loadDossier: OlympianLoadDossier;
    },
    messages: SANITIZED_MESSAGES.map((message) => ({ ...message })),
    documents: PENDING_DOCUMENTS.map((document) => ({ ...document })),
    tasks: IMPORT_TASKS.map((task) => ({ ...task })),
    milestones: IMPORT_MILESTONES.map((milestone) => ({
      ...milestone,
      plannedAt: milestone.plannedAt ? new Date(milestone.plannedAt) : null,
    })),
    protectedUnknowns: [...PROTECTED_UNKNOWNS],
  };
}
