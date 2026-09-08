import {
  hashSupplyStateValue,
} from "../state-runtime/canonicalize";
import { supplyStateScopeRef, supplyStateWorkspaceId, type SupplyStateDependency, type SupplyWorldEvidenceRef } from "../state-runtime/types";
import type { BenchmarkClients, BenchmarkSqlClient } from "./database";
import {
  BENCHMARK_COMPANY_COUNT,
  BENCHMARK_GENERATED_AT,
  BENCHMARK_REQUEST_COUNT,
  BENCHMARK_SUPPLIER_COUNT,
  BENCHMARK_VENDOR_COUNT,
  benchmarkAccountEmail,
  benchmarkConversationMessageId,
  benchmarkEvidenceRef,
  benchmarkExactLexicalCanonicalPointers,
  benchmarkOfficeName,
  benchmarkOperatorId,
  benchmarkProcurementMessageTarget,
  benchmarkProfilePrefix,
  benchmarkProviderMessageId,
  benchmarkRetrievableCountPlan,
  benchmarkScenarioContext,
  benchmarkStableIds,
  benchmarkVendorId,
  buildBenchmarkStateReadPacket,
  deterministicBenchmarkId,
  deterministicBenchmarkUuid,
  generateBenchmarkCorpus,
} from "./generate";
import { COMMERCIAL_STATE_BENCHMARK_SCENARIOS } from "./scenarios";
import {
  BENCHMARK_PROFILE_RETRIEVABLE_TARGETS,
  BENCHMARK_SEED_VERSION,
  type BenchmarkCase,
  type BenchmarkCorpusManifest,
  type BenchmarkProfile,
  type BenchmarkScenarioSeed,
} from "./types";
import { analyzeBenchmarkLexicalTables } from "./lexical-indexes";

const INSERT_BATCH_SIZE = 750;
const FIXED_TIME = BENCHMARK_GENERATED_AT;

type JsonRow = Record<string, unknown>;

type EvidenceDescriptor = {
  scenario: BenchmarkScenarioSeed;
  logicalId: string;
  kind: SupplyWorldEvidenceRef["kind"];
  ref: SupplyWorldEvidenceRef;
  content: string;
  hardNegative: boolean;
};

function chunks<T>(values: readonly T[], size = INSERT_BATCH_SIZE) {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
}

async function insertRows(
  client: BenchmarkSqlClient,
  sql: string,
  rows: readonly JsonRow[],
  batchSize = INSERT_BATCH_SIZE,
) {
  let inserted = 0;
  for (const batch of chunks(rows, batchSize)) {
    inserted += await client.$executeRawUnsafe(sql, JSON.stringify(batch));
  }
  return inserted;
}

function supplierName(index: number) {
  const officeIndex = Math.floor(index / 60);
  const localIndex = index % 60;
  const golden = [
    ["Atlas Fasteners LLC", "atlas-fasteners.example"],
    ["Meridian Motion GmbH", "meridian-motion.example"],
    ["Northstar Metals Inc", "northstar-metals.example"],
    ["Harbor Industrial Ltd", "harbor-industrial.example"],
    ["Atlas Fastener LLC", "atlas-fastener.example"],
  ] as const;
  const selected = golden[localIndex];
  if (selected) return { name: selected[0], domain: selected[1] };
  const number = String(localIndex + 1).padStart(2, "0");
  return {
    name: `Regional Component Source ${officeIndex + 1}-${number}`,
    domain: `regional-source-${officeIndex + 1}-${number}.example`,
  };
}

function normalizedSupplierName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function companyName(index: number) {
  const names = [
    "Apex Components",
    "Bluewater Automation",
    "Cedar Medical Devices",
    "Delta Process Systems",
    "Evergreen Mobility",
    "Foundry Robotics",
  ];
  return names[index % 6]!;
}

function scenarioByRequestIndex() {
  return new Map(COMMERCIAL_STATE_BENCHMARK_SCENARIOS.map((scenario) => [scenario.requestIndex, scenario]));
}

function scenarioSupplierIndexes(requestIndex: number, officeIndex: number) {
  const scenario = scenarioByRequestIndex().get(requestIndex);
  if (scenario) return [scenario.supplierIndexes[0]!, scenario.supplierIndexes[1]!];
  const base = officeIndex * 60;
  const local = requestIndex % 24;
  return [base + ((local * 2) % 60), base + (((local * 2) + 1) % 60)];
}

function evidenceDescriptors(profile: BenchmarkProfile): EvidenceDescriptor[] {
  const byKey = new Map<string, EvidenceDescriptor>();
  for (const scenario of COMMERCIAL_STATE_BENCHMARK_SCENARIOS) {
    for (const template of scenario.evidenceTemplates) {
      const ref = benchmarkEvidenceRef(profile, scenario, template.logicalId, template.kind);
      const key = `${ref.kind}:${ref.id}`;
      byKey.set(key, {
        scenario,
        logicalId: template.logicalId,
        kind: template.kind,
        ref,
        content: template.content,
        hardNegative: false,
      });
    }
    for (const template of scenario.hardNegativeTemplates) {
      const ref = benchmarkEvidenceRef(profile, scenario, template.logicalId, template.kind);
      const key = `${ref.kind}:${ref.id}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          scenario,
          logicalId: template.logicalId,
          kind: template.kind,
          ref,
          content: template.reason,
          hardNegative: true,
        });
      }
    }
  }
  return [...byKey.values()].sort((left, right) => (
    `${left.kind}:${left.ref.id}`.localeCompare(`${right.kind}:${right.ref.id}`)
  ));
}

function refContentHash(reference: SupplyWorldEvidenceRef) {
  if ("contentHash" in reference && reference.contentHash) return reference.contentHash;
  if ("sourceHash" in reference) return reference.sourceHash;
  if ("outputHash" in reference) return reference.outputHash;
  if ("inputHash" in reference) return reference.inputHash;
  if ("payloadHash" in reference) return reference.payloadHash;
  if ("valueHash" in reference) return reference.valueHash;
  return hashSupplyStateValue(reference);
}

async function assertProfileMetadataCompatible(
  owner: BenchmarkSqlClient,
  manifest: BenchmarkCorpusManifest,
) {
  const rows = await owner.$queryRawUnsafe<Array<{
    id: string;
    queryText: string;
    metadata: unknown;
  }>>(`
    SELECT id, query_text AS "queryText", metadata_json AS metadata
    FROM benchmark.cases
    WHERE profile = $1
    ORDER BY id
  `, manifest.profile);
  if (rows.length === 0) return;
  const expected = new Map(manifest.cases.map((caseRow) => [caseRow.id, caseRow]));
  const compatible = rows.length === manifest.cases.length && rows.every((row) => {
    const caseRow = expected.get(row.id);
    return caseRow
      && row.queryText === caseRow.queryText
      && hashSupplyStateValue(row.metadata) === hashSupplyStateValue(caseRow.metadata);
  });
  if (!compatible) {
    throw new Error(
      `Existing ${manifest.profile} benchmark metadata conflicts with ${BENCHMARK_SEED_VERSION}. Run benchmark:reset before reseeding.`,
    );
  }
}

async function seedCoreGraph(clients: Pick<BenchmarkClients, "app" | "owner">, profile: BenchmarkProfile) {
  const ids = benchmarkStableIds(profile);
  const offices = ids.officeIds.map((id, index) => ({
    id,
    name: benchmarkOfficeName(profile, index as 0 | 1),
  }));
  await insertRows(clients.app, `
    INSERT INTO public."Office" (id, name, "createdAt", "updatedAt")
    SELECT id, name, TIMESTAMPTZ '2026-08-01 00:00:00+00', TIMESTAMPTZ '2026-08-01 00:00:00+00'
    FROM jsonb_to_recordset($1::jsonb) AS row(id text, name text)
    ON CONFLICT (id) DO NOTHING
  `, offices);

  // Commercial State readers resolve the same internal operator access used
  // by the product runtime before assembling Company Context. Seed one
  // disabled-login benchmark operator per office so the benchmark exercises
  // that real access boundary instead of compiling a bounded reader failure.
  const operators = ids.officeIds.map((officeId, index) => ({
    id: benchmarkOperatorId(profile, index as 0 | 1),
    officeId,
    email: `commercial-state-operator+${profile}-${index + 1}@example.test`,
    passwordHash: "benchmark-login-disabled",
    fullName: `Commercial State Benchmark Operator ${index + 1}`,
  }));
  await insertRows(clients.app, `
    INSERT INTO public."User" (
      id, "officeId", email, "passwordHash", "fullName", role, "isActive", "canViewWholeOffice",
      "createdAt", "updatedAt"
    )
    SELECT id, "officeId", email, "passwordHash", "fullName", 'ADMIN'::public."UserRole", true, true,
      TIMESTAMPTZ '2026-08-01 00:00:00+00', TIMESTAMPTZ '2026-08-01 00:00:00+00'
    FROM jsonb_to_recordset($1::jsonb) AS row(
      id text, "officeId" text, email text, "passwordHash" text, "fullName" text
    )
    ON CONFLICT (id) DO NOTHING
  `, operators);

  const companies = ids.companyIds.map((id, index) => ({
    id,
    officeId: ids.officeIds[Math.floor(index / 6)]!,
    name: companyName(index),
    domain: `bench-company-${(index % 6) + 1}.office-${Math.floor(index / 6) + 1}.example`,
    sourceRefs: { benchmark: true, profile, logicalCompany: `BENCH-COMPANY-${String(index + 1).padStart(2, "0")}` },
  }));
  await insertRows(clients.app, `
    INSERT INTO public."Company" (id, "officeId", name, domain, "sourceRefs", "createdAt", "updatedAt")
    SELECT id, "officeId", name, domain, "sourceRefs",
      TIMESTAMPTZ '2026-08-01 00:00:00+00', TIMESTAMPTZ '2026-08-01 00:00:00+00'
    FROM jsonb_to_recordset($1::jsonb) AS row(id text, "officeId" text, name text, domain text, "sourceRefs" jsonb)
    ON CONFLICT (id) DO NOTHING
  `, companies);

  const suppliers = ids.supplierIds.map((id, index) => {
    const identity = supplierName(index);
    return {
      id,
      officeId: ids.officeIds[Math.floor(index / 60)]!,
      name: identity.name,
      normalizedName: normalizedSupplierName(identity.name),
      website: `https://${identity.domain}`,
      domain: identity.domain,
      status: index % 60 < 5 ? "VERIFIED" : "UNVERIFIED",
      sourceRefs: { benchmark: true, profile },
    };
  });
  await insertRows(clients.app, `
    INSERT INTO public."Supplier" (
      id, "officeId", name, "normalizedName", website, domain, status, "sourceRefs", "createdAt", "updatedAt"
    )
    SELECT id::uuid, "officeId", name, "normalizedName", website, domain, status, "sourceRefs",
      TIMESTAMPTZ '2026-08-01 00:00:00+00', TIMESTAMPTZ '2026-08-01 00:00:00+00'
    FROM jsonb_to_recordset($1::jsonb) AS row(
      id text, "officeId" text, name text, "normalizedName" text, website text, domain text, status text, "sourceRefs" jsonb
    )
    ON CONFLICT (id) DO NOTHING
  `, suppliers);

  const companySupplierRows: Array<{
    id: string;
    officeId: string;
    companyId: string;
    supplierId: string;
    status: string;
    notes: string;
    sourceRefs: Record<string, unknown>;
  }> = ids.supplierIds.map((supplierId, index) => {
    const officeIndex = Math.floor(index / 60);
    const localIndex = index % 60;
    const companyIndex = (officeIndex * 6) + (localIndex % 6);
    return {
      id: deterministicBenchmarkUuid(profile, `company-supplier:${index + 1}`),
      officeId: ids.officeIds[officeIndex]!,
      companyId: ids.companyIds[companyIndex]!,
      supplierId,
      status: localIndex < 5 ? "APPROVED" : "CANDIDATE",
      notes: "Deterministic Commercial State benchmark relationship.",
      sourceRefs: { benchmark: true, profile },
    };
  });
  const relationshipKeys = new Set(companySupplierRows.map((row) => `${row.companyId}:${row.supplierId}`));
  for (const scenario of COMMERCIAL_STATE_BENCHMARK_SCENARIOS) {
    const companyId = ids.companyIds[scenario.companyIndex]!;
    const officeId = ids.officeIds[scenario.officeIndex]!;
    for (const supplierIndex of scenario.supplierIndexes) {
      const supplierId = ids.supplierIds[supplierIndex]!;
      const key = `${companyId}:${supplierId}`;
      if (relationshipKeys.has(key)) continue;
      relationshipKeys.add(key);
      companySupplierRows.push({
        id: deterministicBenchmarkUuid(profile, `scenario-company-supplier:${scenario.companyIndex + 1}:${supplierIndex + 1}`),
        officeId,
        companyId,
        supplierId,
        status: "APPROVED",
        notes: `Scripted relationship for ${scenario.family}.`,
        sourceRefs: { benchmark: true, profile, scenarioId: scenario.id },
      });
    }
  }
  await insertRows(clients.app, `
    INSERT INTO public."CompanySupplier" (
      id, "officeId", "companyId", "supplierId", status, notes, "sourceRefs", "createdAt", "updatedAt"
    )
    SELECT id::uuid, "officeId", "companyId", "supplierId"::uuid, status, notes, "sourceRefs",
      TIMESTAMPTZ '2026-08-01 00:00:00+00', TIMESTAMPTZ '2026-08-01 00:00:00+00'
    FROM jsonb_to_recordset($1::jsonb) AS row(
      id text, "officeId" text, "companyId" text, "supplierId" text, status text, notes text, "sourceRefs" jsonb
    )
    ON CONFLICT (id) DO NOTHING
  `, companySupplierRows);

  const workspaces = ids.workspaceIds.map((id, index) => ({
    id,
    officeId: ids.officeIds[Math.floor(index / 6)]!,
    companyId: ids.companyIds[index]!,
    externalKey: `BENCH-WORKSPACE-${String(index + 1).padStart(2, "0")}`,
    name: `${companyName(index)} Supply Benchmark`,
  }));
  await insertRows(clients.app, `
    INSERT INTO public."SupplyWorkspace" (
      id, "officeId", "companyId", "externalKey", name, status, version, "createdAt", "updatedAt"
    )
    SELECT id, "officeId", "companyId", "externalKey", name, 'ACTIVE', 1,
      TIMESTAMPTZ '2026-08-01 00:00:00+00', TIMESTAMPTZ '2026-08-01 00:00:00+00'
    FROM jsonb_to_recordset($1::jsonb) AS row(id text, "officeId" text, "companyId" text, "externalKey" text, name text)
    ON CONFLICT (id) DO NOTHING
  `, workspaces);

  const workflowAccounts = ids.workflowCustomerIds.map((id, companyIndex) => ({
    id,
    officeId: ids.officeIds[Math.floor(companyIndex / 6)]!,
    companyId: ids.companyIds[companyIndex]!,
    name: companyName(companyIndex),
  }));
  await insertRows(clients.owner, `
    INSERT INTO public."CompanyWorkflowAccount" (id, office_id, company_id, name)
    SELECT id::uuid, "officeId", "companyId", name
    FROM jsonb_to_recordset($1::jsonb) AS row(id text, "officeId" text, "companyId" text, name text)
    ON CONFLICT (id) DO NOTHING
  `, workflowAccounts);

  const items = ids.itemIds.map((id, requestIndex) => {
    const companyIndex = Math.floor(requestIndex / 4);
    const scenario = scenarioByRequestIndex().get(requestIndex);
    const itemKey = scenario?.itemKey ?? `component-${String(requestIndex + 1).padStart(3, "0")}`;
    return {
      id,
      officeId: ids.officeIds[Math.floor(companyIndex / 6)]!,
      companyId: ids.companyIds[companyIndex]!,
      customerId: ids.workflowCustomerIds[companyIndex]!,
      material: scenario?.promptSubject ?? `Benchmark component ${requestIndex + 1}`,
      sku:
        scenario?.id === "exact-commercial-identifiers"
          ? "SKU-PX-4400"
          : `${itemKey.toUpperCase()}-${requestIndex + 1}`,
      specification: scenario?.id === "capability-versus-bom"
        ? "5-axis CNC; MIL-A-8625 Type III finish"
        : `Controlled specification for ${itemKey}`,
      manufacturer: "Benchmark Manufacturing",
      partNumber: `BENCH-PN-${String(requestIndex + 1).padStart(4, "0")}`,
      unit: "EA",
    };
  });
  await insertRows(clients.owner, `
    INSERT INTO public."Item" (id, office_id, company_id, customer_id, material, sku, specification, manufacturer, "partNumber", unit)
    SELECT id::uuid, "officeId", "companyId", "customerId"::uuid, material, sku, specification, manufacturer, "partNumber", unit
    FROM jsonb_to_recordset($1::jsonb) AS row(
      id text, "officeId" text, "companyId" text, "customerId" text, material text, sku text,
      specification text, manufacturer text, "partNumber" text, unit text
    )
    ON CONFLICT (id) DO NOTHING
  `, items);

  const orders = ids.orderIds.map((id, requestIndex) => {
    const companyIndex = Math.floor(requestIndex / 4);
    const scenario = scenarioByRequestIndex().get(requestIndex);
    const current = scenario?.currentState ?? {};
    return {
      id,
      customerId: ids.workflowCustomerIds[companyIndex]!,
      itemId: ids.itemIds[requestIndex]!,
      quantity: scenario?.id === "inventory-inbound-demand-availability" ? 120 : 25 + (requestIndex % 9) * 5,
      unit: "EA",
      neededBy: String(current.neededBy ?? `2026-${String(9 + (requestIndex % 3)).padStart(2, "0")}-28`),
      notes: scenario?.promptCurrentQuestion ?? "Deterministic benchmark request.",
      requestContext: {
        source: {
          workspace_id: ids.workspaceIds[companyIndex],
          benchmark_profile: profile,
          rfq: scenario?.id === "exact-commercial-identifiers" ? "RFQ-BENCH-0048" : `RFQ-BENCH-${String(requestIndex + 1).padStart(4, "0")}`,
        },
        procurement_context: {
          service_level: current.serviceLevel ?? "STANDARD",
          rush: current.rush ?? false,
        },
      },
      status: "sourcing",
      progress: "supplier_outreach",
      decisionSnapshot: { benchmark: true, scenario: scenario?.id ?? null },
    };
  });
  await insertRows(clients.owner, `
    INSERT INTO public."ProcurementOrder" (
      id, customer_id, bom_id, quantity, unit, needed_by, notes, request_context, status, progress, decision_snapshot
    )
    SELECT id::uuid, "customerId"::uuid, "itemId"::uuid, quantity::numeric, unit, "neededBy"::date,
      notes, "requestContext", status, progress, "decisionSnapshot"
    FROM jsonb_to_recordset($1::jsonb) AS row(
      id text, "customerId" text, "itemId" text, quantity numeric, unit text, "neededBy" text,
      notes text, "requestContext" jsonb, status text, progress text, "decisionSnapshot" jsonb
    )
    ON CONFLICT (id) DO NOTHING
  `, orders);

  const vendors: JsonRow[] = [];
  for (let requestIndex = 0; requestIndex < BENCHMARK_REQUEST_COUNT; requestIndex += 1) {
    const companyIndex = Math.floor(requestIndex / 4);
    const officeIndex = Math.floor(companyIndex / 6);
    const supplierIndexes = scenarioSupplierIndexes(requestIndex, officeIndex);
    for (let slot = 0; slot < 2; slot += 1) {
      const supplierIndex = supplierIndexes[slot]!;
      const identity = supplierName(supplierIndex);
      const scenario = scenarioByRequestIndex().get(requestIndex);
      const quoted = slot === 0 && (
        scenario?.id === "quote-after-follow-up"
        || scenario?.id === "standard-versus-missed-rush"
      );
      const quoteRevision = scenario?.id === "quote-after-follow-up"
        ? "Q-2026-061-R2"
        : "BENCHMARK-CURRENT";
      vendors.push({
        id: benchmarkVendorId(ids, requestIndex, slot),
        orderId: ids.orderIds[requestIndex],
        supplierId: ids.supplierIds[supplierIndex],
        name: identity.name,
        website: `https://${identity.domain}`,
        contactName: `Benchmark Buyer Contact ${supplierIndex + 1}`,
        contactEmail: `rfq-${supplierIndex + 1}@${identity.domain}`,
        contactPhone: null,
        contact: { name: `Benchmark Buyer Contact ${supplierIndex + 1}`, email: `rfq-${supplierIndex + 1}@${identity.domain}` },
        identity: { supplier_key: normalizedSupplierName(identity.name).replace(/ /g, "-") },
        status: quoted ? "quoted" : "contacted",
        research: { benchmark: true, profile },
        quote: quoted ? { revision: quoteRevision, currency: "USD", amount: 4825, lead_time_days: 21 } : null,
      });
    }
  }
  await insertRows(clients.owner, `
    INSERT INTO public."OrderSupplier" (
      id, order_id, supplier_registry_id, name, website, contact_name, contact_email, contact_phone,
      contact, identity, status, research, quote
    )
    SELECT id::uuid, "orderId"::uuid, "supplierId"::uuid, name, website, "contactName", "contactEmail", "contactPhone",
      contact, identity, status, research, quote
    FROM jsonb_to_recordset($1::jsonb) AS row(
      id text, "orderId" text, "supplierId" text, name text, website text, "contactName" text,
      "contactEmail" text, "contactPhone" text, contact jsonb, identity jsonb, status text, research jsonb, quote jsonb
    )
    ON CONFLICT (id) DO NOTHING
  `, vendors);
}

async function seedSupplyState(clients: Pick<BenchmarkClients, "app">, profile: BenchmarkProfile) {
  const ids = benchmarkStableIds(profile);
  const descriptors = evidenceDescriptors(profile);
  const snapshots: JsonRow[] = [];
  for (let companyIndex = 0; companyIndex < BENCHMARK_COMPANY_COUNT; companyIndex += 1) {
    const officeId = ids.officeIds[Math.floor(companyIndex / 6)]!;
    const workspaceId = ids.workspaceIds[companyIndex]!;
    for (const version of [1, 2]) {
      const id = deterministicBenchmarkId(profile, `workspace:${companyIndex + 1}:snapshot-v${version}`);
      snapshots.push({
        id,
        officeId,
        workspaceId,
        version,
        status: "DRAFT",
        schemaVersion: 1,
        sourceHash: hashSupplyStateValue({ profile, kind: "supply_snapshot", id }),
        metadata: { benchmark: true, profile, version },
        publishedAt: null,
      });
    }
  }
  await insertRows(clients.app, `
    INSERT INTO public."SupplySnapshot" (
      id, "officeId", "workspaceId", version, status, "schemaVersion", "sourceHash", metadata, "publishedAt"
    )
    SELECT id, "officeId", "workspaceId", version, status, "schemaVersion", "sourceHash", metadata, "publishedAt"::timestamptz
    FROM jsonb_to_recordset($1::jsonb) AS row(
      id text, "officeId" text, "workspaceId" text, version int, status text, "schemaVersion" int,
      "sourceHash" text, metadata jsonb, "publishedAt" text
    )
    ON CONFLICT (id) DO NOTHING
  `, snapshots);

  const supplyItems = ids.itemIds.map((_itemId, requestIndex) => {
    const companyIndex = Math.floor(requestIndex / 4);
    const scenario = scenarioByRequestIndex().get(requestIndex);
    const itemKey = scenario?.itemKey ?? `component-${String(requestIndex + 1).padStart(3, "0")}`;
    return {
      id: deterministicBenchmarkId(profile, `supply-item:${requestIndex + 1}`),
      officeId: ids.officeIds[Math.floor(companyIndex / 6)]!,
      workspaceId: ids.workspaceIds[companyIndex]!,
      snapshotId: deterministicBenchmarkId(profile, `workspace:${companyIndex + 1}:snapshot-v2`),
      itemKey,
      externalId: `BENCH-ITEM-${String(requestIndex + 1).padStart(3, "0")}`,
      sku: scenario?.id === "exact-commercial-identifiers"
        ? "SKU-PX-4400"
        : `${itemKey.toUpperCase()}-${requestIndex + 1}`,
      manufacturer: "Benchmark Manufacturing",
      mpn: `BENCH-MPN-${String(requestIndex + 1).padStart(4, "0")}`,
      name: scenario?.promptSubject ?? `Benchmark component ${requestIndex + 1}`,
      description: scenario?.promptCurrentQuestion ?? "Deterministic benchmark supply item.",
      category: "industrial_component",
      itemType: "COMPONENT",
      unitOfMeasure: "EA",
      metadata: { benchmark: true, profile },
      sourceRefs: [{ kind: "benchmark", profile }],
    };
  });
  await insertRows(clients.app, `
    INSERT INTO public."SupplyItem" (
      id, "officeId", "workspaceId", "snapshotId", "itemKey", "externalId", sku, manufacturer, mpn,
      name, description, category, "itemType", "unitOfMeasure", metadata, "sourceRefs"
    )
    SELECT id, "officeId", "workspaceId", "snapshotId", "itemKey", "externalId", sku, manufacturer, mpn,
      name, description, category, "itemType", "unitOfMeasure", metadata, "sourceRefs"
    FROM jsonb_to_recordset($1::jsonb) AS row(
      id text, "officeId" text, "workspaceId" text, "snapshotId" text, "itemKey" text, "externalId" text,
      sku text, manufacturer text, mpn text, name text, description text, category text, "itemType" text,
      "unitOfMeasure" text, metadata jsonb, "sourceRefs" jsonb
    )
    ON CONFLICT (id) DO NOTHING
  `, supplyItems);

  await seedItemSupplyDetails(clients.app, profile);

  const publishedSnapshots = snapshots.map((snapshot) => ({
    id: snapshot.id,
    publishedAt: snapshot.version === 1
      ? "2026-04-01T00:00:00.000Z"
      : "2026-07-01T00:00:00.000Z",
  }));
  await insertRows(clients.app, `
    UPDATE public."SupplySnapshot" AS snapshot
    SET status = 'PUBLISHED',
        "publishedAt" = source."publishedAt"::timestamptz
    FROM jsonb_to_recordset($1::jsonb) AS source(id text, "publishedAt" text)
    WHERE snapshot.id = source.id
      AND snapshot.status = 'DRAFT'
  `, publishedSnapshots);

  const profileKeys = new Map<string, { scenario: BenchmarkScenarioSeed; supplierKey: string }>();
  for (const scenario of COMMERCIAL_STATE_BENCHMARK_SCENARIOS) {
    const context = benchmarkScenarioContext(profile, scenario);
    profileKeys.set(`${context.workspaceId}\u0000${context.supplierKey}`, { scenario, supplierKey: context.supplierKey });
    for (const descriptor of descriptors.filter((entry) => entry.scenario.id === scenario.id && entry.kind === "supply_profile_fact")) {
      if (/atlas-fastener-distinct/.test(descriptor.logicalId)) {
        profileKeys.set(`${context.workspaceId}\u0000atlas-fastener`, { scenario, supplierKey: "atlas-fastener" });
      }
    }
  }
  const profiles = [...profileKeys.values()].map(({ scenario, supplierKey }) => {
    const context = benchmarkScenarioContext(profile, scenario);
    const identity = supplierKey === "atlas-fastener"
      ? { name: "Atlas Fastener LLC", domain: "atlas-fastener.example" }
      : supplierName(scenario.supplierIndexes[0]!);
    return {
      id: deterministicBenchmarkId(profile, `supplier-profile:${context.workspaceId}:${supplierKey}`),
      officeId: context.officeId,
      workspaceId: context.workspaceId,
      supplierKey,
      normalizedName: normalizedSupplierName(identity.name),
      companyName: identity.name,
      website: `https://${identity.domain}`,
      websiteDomain: identity.domain,
      roles: ["MANUFACTURER", "DISTRIBUTOR"],
      status: "QUALIFIED",
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-08-01T00:00:00.000Z",
    };
  });
  await insertRows(clients.app, `
    INSERT INTO public."SupplySupplierProfile" (
      id, "officeId", "workspaceId", "supplierKey", "normalizedName", "companyName", website,
      "websiteDomain", roles, status, "firstSeenAt", "lastSeenAt", "createdAt", "updatedAt"
    )
    SELECT id, "officeId", "workspaceId", "supplierKey", "normalizedName", "companyName", website,
      "websiteDomain", roles, status, "firstSeenAt"::timestamptz, "lastSeenAt"::timestamptz,
      TIMESTAMPTZ '2026-08-01 00:00:00+00', TIMESTAMPTZ '2026-08-01 00:00:00+00'
    FROM jsonb_to_recordset($1::jsonb) AS row(
      id text, "officeId" text, "workspaceId" text, "supplierKey" text, "normalizedName" text,
      "companyName" text, website text, "websiteDomain" text, roles jsonb, status text,
      "firstSeenAt" text, "lastSeenAt" text
    )
    ON CONFLICT (id) DO NOTHING
  `, profiles);

  const contextDescriptors = descriptors.filter((descriptor) => descriptor.kind === "company_context");
  const contextRows: JsonRow[] = contextDescriptors.map((descriptor, index) => {
    const context = benchmarkScenarioContext(profile, descriptor.scenario);
    const foreign = descriptor.hardNegative && /foreign/.test(descriptor.logicalId);
    const companyIndex = foreign ? (descriptor.scenario.officeIndex === 0 ? 6 : 0) : descriptor.scenario.companyIndex;
    const reference = descriptor.ref as Extract<SupplyWorldEvidenceRef, { kind: "company_context" }>;
    return {
      id: reference.id,
      officeId: ids.officeIds[Math.floor(companyIndex / 6)]!,
      companyId: ids.companyIds[companyIndex]!,
      itemId: null,
      kind: "DOCUMENT",
      name: `Benchmark context ${descriptor.scenario.ordinal}-${index + 1}`,
      description: descriptor.scenario.family,
      storageUrl: `benchmark://${profile}/context/${encodeURIComponent(reference.id)}`,
      mimeType: "text/markdown",
      sizeBytes: descriptor.content.length,
      contentHash: reference.contentHash ?? refContentHash(reference),
      markdown: descriptor.content,
      processingState: "READY",
      payload: { benchmark: true, profile, scenarioId: descriptor.scenario.id, hardNegative: descriptor.hardNegative },
    };
  });
  while (contextRows.length < 24) {
    const index = contextRows.length;
    const companyIndex = index % BENCHMARK_COMPANY_COUNT;
    const id = deterministicBenchmarkId(profile, `context-filler:${index + 1}`);
    contextRows.push({
      id,
      officeId: ids.officeIds[Math.floor(companyIndex / 6)]!,
      companyId: ids.companyIds[companyIndex]!,
      itemId: null,
      kind: "DOCUMENT",
      name: `Benchmark supporting context ${index + 1}`,
      description: "Bounded supporting context for benchmark coverage.",
      storageUrl: `benchmark://${profile}/context/filler-${index + 1}`,
      mimeType: "text/markdown",
      sizeBytes: 64,
      contentHash: hashSupplyStateValue({ profile, context: index + 1 }),
      markdown: `Supporting company context ${index + 1}.`,
      processingState: "READY",
      payload: { benchmark: true, profile, filler: true },
    });
  }
  if (contextRows.length > 24) throw new Error("Scripted CompanyContext evidence exceeds the fixed benchmark allocation.");
  await insertRows(clients.app, `
    INSERT INTO public."CompanyContext" (
      id, "officeId", "companyId", "itemId", kind, name, description, "storageUrl", "mimeType", "sizeBytes",
      "contentHash", markdown, "processingState", payload
    )
    SELECT id, "officeId", "companyId", "itemId"::uuid, kind, name, description, "storageUrl", "mimeType", "sizeBytes",
      "contentHash", markdown, "processingState", payload
    FROM jsonb_to_recordset($1::jsonb) AS row(
      id text, "officeId" text, "companyId" text, "itemId" text, kind text, name text, description text,
      "storageUrl" text, "mimeType" text, "sizeBytes" int, "contentHash" text, markdown text,
      "processingState" text, payload jsonb
    )
    ON CONFLICT (id) DO NOTHING
  `, contextRows);

  const supplyEvidenceRows = COMMERCIAL_STATE_BENCHMARK_SCENARIOS.map((scenario) => {
    const context = benchmarkScenarioContext(profile, scenario);
    const descriptor = descriptors.find((entry) => entry.scenario.id === scenario.id && entry.kind === "supply_evidence");
    const id = descriptor?.ref.id ?? deterministicBenchmarkId(profile, `scenario:${scenario.id}:supply-evidence`);
    const contentHash = descriptor ? refContentHash(descriptor.ref) : hashSupplyStateValue({ profile, scenario: scenario.id, evidence: true });
    return {
      id,
      officeId: context.officeId,
      workspaceId: context.workspaceId,
      snapshotId: context.snapshotId,
      evidenceKey: `benchmark:${scenario.id}`,
      kind: "BENCHMARK_SOURCE",
      sourceType: "BENCHMARK_CANONICAL",
      sourceUri: `benchmark://${profile}/scenario/${scenario.id}`,
      sourceRecordId: scenario.id,
      sourceVersion: BENCHMARK_SEED_VERSION,
      title: scenario.family,
      excerpt: descriptor?.content ?? scenario.promptCurrentQuestion,
      payload: { currentState: scenario.currentState, contradictoryHistory: scenario.contradictoryHistory },
      contentHash,
      confidence: 1,
      observedAt: FIXED_TIME,
      capturedAt: FIXED_TIME,
    };
  });
  await insertRows(clients.app, `
    INSERT INTO public."SupplyEvidence" (
      id, "officeId", "workspaceId", "snapshotId", "evidenceKey", kind, "sourceType", "sourceUri",
      "sourceRecordId", "sourceVersion", title, excerpt, payload, "contentHash", confidence, "observedAt", "capturedAt"
    )
    SELECT id, "officeId", "workspaceId", "snapshotId", "evidenceKey", kind, "sourceType", "sourceUri",
      "sourceRecordId", "sourceVersion", title, excerpt, payload, "contentHash", confidence::numeric,
      "observedAt"::timestamptz, "capturedAt"::timestamptz
    FROM jsonb_to_recordset($1::jsonb) AS row(
      id text, "officeId" text, "workspaceId" text, "snapshotId" text, "evidenceKey" text, kind text,
      "sourceType" text, "sourceUri" text, "sourceRecordId" text, "sourceVersion" text, title text,
      excerpt text, payload jsonb, "contentHash" text, confidence numeric, "observedAt" text, "capturedAt" text
    )
    ON CONFLICT (id) DO NOTHING
  `, supplyEvidenceRows);

  const profileFactDescriptors = descriptors.filter((descriptor) => descriptor.kind === "supply_profile_fact");
  const profileFactRows: JsonRow[] = profileFactDescriptors.map((descriptor, index) => {
    const context = benchmarkScenarioContext(profile, descriptor.scenario);
    const subjectRef = /atlas-fastener-distinct/.test(descriptor.logicalId)
      ? "atlas-fastener"
      : /foreign/.test(descriptor.logicalId)
        ? `${context.supplierKey}-foreign-office`
        : context.supplierKey;
    const workspaceId = /foreign/.test(descriptor.logicalId)
      ? ids.workspaceIds[descriptor.scenario.officeIndex === 0 ? 6 : 0]!
      : context.workspaceId;
    const officeId = /foreign/.test(descriptor.logicalId)
      ? ids.officeIds[descriptor.scenario.officeIndex === 0 ? 1 : 0]!
      : context.officeId;
    return {
      id: descriptor.ref.id,
      officeId,
      workspaceId,
      subjectType: "SUPPLIER",
      subjectRef,
      factType: descriptor.logicalId.includes("payment-terms") ? "PAYMENT_TERMS" : "CAPABILITY_OR_IDENTITY",
      value: { text: descriptor.content, logicalId: descriptor.logicalId, hardNegative: descriptor.hardNegative },
      sourceType: "BENCHMARK_CANONICAL",
      sourceUri: `benchmark://${profile}/profile-fact/${index + 1}`,
      contentHash: refContentHash(descriptor.ref),
      observedAt: descriptor.hardNegative ? "2025-06-01T00:00:00.000Z" : "2026-07-15T00:00:00.000Z",
      capturedAt: descriptor.hardNegative ? "2025-06-02T00:00:00.000Z" : "2026-07-16T00:00:00.000Z",
    };
  });
  const mutationFacts = new Map<string, JsonRow>();
  for (const caseRow of generateBenchmarkCorpus(profile).cases) {
    const concurrency = caseRow.metadata.actionConcurrency;
    if (!concurrency) continue;
    for (const mutation of [concurrency.mutation, concurrency.unrelatedControl].filter(Boolean)) {
      if (mutation?.kind !== "supplier_fact_head") continue;
      const scenario = COMMERCIAL_STATE_BENCHMARK_SCENARIOS.find((entry) => entry.id === caseRow.metadata.scenarioId)!;
      const context = benchmarkScenarioContext(profile, scenario);
      mutationFacts.set(mutation.factId, {
        id: mutation.factId,
        officeId: context.officeId,
        workspaceId: mutation.workspaceId,
        subjectType: "SUPPLIER",
        subjectRef: mutation.supplierKey,
        factType: "BENCHMARK_CONCURRENCY_HEAD",
        value: { benchmark: true, concurrencyControl: true, supplierKey: mutation.supplierKey },
        sourceType: "BENCHMARK_CONCURRENCY",
        sourceUri: `benchmark://${profile}/concurrency/${encodeURIComponent(mutation.factId)}`,
        contentHash: mutation.contentHash,
        observedAt: "2026-07-31T00:00:00.000Z",
        capturedAt: "2026-07-31T00:00:00.000Z",
      });
    }
  }
  for (const row of mutationFacts.values()) {
    if (!profileFactRows.some((candidate) => candidate.id === row.id)) profileFactRows.push(row);
  }
  while (profileFactRows.length < 24) {
    const index = profileFactRows.length;
    const scenario = COMMERCIAL_STATE_BENCHMARK_SCENARIOS[index % 12]!;
    const context = benchmarkScenarioContext(profile, scenario);
    const id = deterministicBenchmarkId(profile, `profile-fact-filler:${index + 1}`);
    profileFactRows.push({
      id,
      officeId: context.officeId,
      workspaceId: context.workspaceId,
      subjectType: "SUPPLIER",
      subjectRef: context.supplierKey,
      factType: "BENCHMARK_SUPPORTING_FACT",
      value: { benchmark: true, ordinal: index + 1 },
      sourceType: "BENCHMARK_CANONICAL",
      sourceUri: `benchmark://${profile}/profile-fact/filler-${index + 1}`,
      contentHash: hashSupplyStateValue({ profile, profileFact: index + 1 }),
      observedAt: "2026-05-01T00:00:00.000Z",
      capturedAt: "2026-05-02T00:00:00.000Z",
    });
  }
  if (profileFactRows.length > 24) throw new Error("Scripted supplier facts exceed the fixed benchmark allocation.");
  await insertRows(clients.app, `
    INSERT INTO public."SupplyProfileFact" (
      id, "officeId", "workspaceId", "subjectType", "subjectRef", "factType", value,
      "sourceType", "sourceUri", "contentHash", "observedAt", "capturedAt"
    )
    SELECT id, "officeId", "workspaceId", "subjectType", "subjectRef", "factType", value,
      "sourceType", "sourceUri", "contentHash", "observedAt"::timestamptz, "capturedAt"::timestamptz
    FROM jsonb_to_recordset($1::jsonb) AS row(
      id text, "officeId" text, "workspaceId" text, "subjectType" text, "subjectRef" text,
      "factType" text, value jsonb, "sourceType" text, "sourceUri" text, "contentHash" text,
      "observedAt" text, "capturedAt" text
    )
    ON CONFLICT (id) DO NOTHING
  `, profileFactRows);

  const priceRows = COMMERCIAL_STATE_BENCHMARK_SCENARIOS.map((scenario, index) => {
    const context = benchmarkScenarioContext(profile, scenario);
    const id = deterministicBenchmarkId(profile, `scenario:${scenario.id}:price:current`);
    return {
      id,
      officeId: context.officeId,
      workspaceId: context.workspaceId,
      supplierProfileId: deterministicBenchmarkId(profile, `supplier-profile:${context.workspaceId}:${context.supplierKey}`),
      itemKey: context.itemKey,
      observationType: "SUPPLIER_QUOTE",
      amount: 100 + (index * 7.25),
      currency: "USD",
      unitOfMeasure: "EA",
      minimumQuantity: 10,
      availableQuantity: 100 + index,
      sourceUrl: `benchmark://${profile}/price/${scenario.id}`,
      sourceLabel: "Deterministic benchmark quote",
      contentHash: hashSupplyStateValue({ profile, scenario: scenario.id, price: "current" }),
      observedAt: "2026-07-20T00:00:00.000Z",
      capturedAt: "2026-07-20T00:00:00.000Z",
    };
  });
  await insertRows(clients.app, `
    INSERT INTO public."SupplyPriceObservation" (
      id, "officeId", "workspaceId", "supplierProfileId", "itemKey", "observationType", amount,
      currency, "unitOfMeasure", "minimumQuantity", "availableQuantity", "sourceUrl", "sourceLabel",
      "contentHash", "observedAt", "capturedAt"
    )
    SELECT id, "officeId", "workspaceId", "supplierProfileId", "itemKey", "observationType", amount::numeric,
      currency, "unitOfMeasure", "minimumQuantity"::numeric, "availableQuantity"::numeric, "sourceUrl", "sourceLabel",
      "contentHash", "observedAt"::timestamptz, "capturedAt"::timestamptz
    FROM jsonb_to_recordset($1::jsonb) AS row(
      id text, "officeId" text, "workspaceId" text, "supplierProfileId" text, "itemKey" text,
      "observationType" text, amount numeric, currency text, "unitOfMeasure" text, "minimumQuantity" numeric,
      "availableQuantity" numeric, "sourceUrl" text, "sourceLabel" text, "contentHash" text,
      "observedAt" text, "capturedAt" text
    )
    ON CONFLICT (id) DO NOTHING
  `, priceRows);

  const planningRows = COMMERCIAL_STATE_BENCHMARK_SCENARIOS.map((scenario) => {
    const context = benchmarkScenarioContext(profile, scenario);
    const output = scenario.id === "inventory-inbound-demand-availability"
      ? { onHand: 40, inbound: 50, demand: 120, availableAfterDemand: -30, shortage: 30 }
      : { recommendation: scenario.promptCurrentQuestion };
    const outputHash = hashSupplyStateValue({ profile, kind: "planning_result", id: context.planningResultId });
    return {
      id: context.planningResultId,
      officeId: context.officeId,
      workspaceId: context.workspaceId,
      snapshotId: context.snapshotId,
      engineVersion: "benchmark-deterministic-v1",
      snapshotHash: hashSupplyStateValue({ profile, kind: "supply_snapshot", id: context.snapshotId }),
      normalizedInputHash: hashSupplyStateValue({ profile, scenario: scenario.id, planningInput: true }),
      assumptions: [],
      unknowns: scenario.id === "capability-versus-bom" ? ["Exact 5-axis and finish capability is unconfirmed."] : [],
      evidenceReferences: scenario.evidenceTemplates.map((entry) => entry.logicalId),
      output,
      outputHash,
    };
  });
  await insertRows(clients.app, `
    INSERT INTO public."SupplyPlanningResult" (
      id, "officeId", "workspaceId", "snapshotId", "engineVersion", "snapshotHash", "normalizedInputHash",
      assumptions, unknowns, "evidenceReferences", output, "outputHash"
    )
    SELECT id, "officeId", "workspaceId", "snapshotId", "engineVersion", "snapshotHash", "normalizedInputHash",
      assumptions, unknowns, "evidenceReferences", output, "outputHash"
    FROM jsonb_to_recordset($1::jsonb) AS row(
      id text, "officeId" text, "workspaceId" text, "snapshotId" text, "engineVersion" text,
      "snapshotHash" text, "normalizedInputHash" text, assumptions jsonb, unknowns jsonb,
      "evidenceReferences" jsonb, output jsonb, "outputHash" text
    )
    ON CONFLICT (id) DO NOTHING
  `, planningRows);

  const executionTasks = COMMERCIAL_STATE_BENCHMARK_SCENARIOS.map((scenario) => {
    const context = benchmarkScenarioContext(profile, scenario);
    const inputHash = scenario.id === "exact-commercial-identifiers"
      ? hashSupplyStateValue({ profile, scenario: scenario.id, draft: "current" })
      : hashSupplyStateValue({ profile, kind: "execution_task", id: context.executionTaskId });
    return {
      id: context.executionTaskId,
      officeId: context.officeId,
      workspaceId: context.workspaceId,
      snapshotId: context.snapshotId,
      taskKey: `procurement-reply-draft:${context.orderId}:${context.vendorId}:benchmark`,
      taskType: "PROCUREMENT_SUPPLIER_REPLY_DRAFT",
      capabilityKey: "procurement_supplier_reply",
      status: "PLANNED",
      requiresApproval: true,
      input: { benchmark: true, profile, orderId: context.orderId, vendorId: context.vendorId, scenarioId: scenario.id },
      inputHash,
      externalSystem: "BENCHMARK_MAIL",
      idempotencyKey: `benchmark:${profile}:${scenario.id}:reply-draft`,
    };
  });
  await insertRows(clients.app, `
    INSERT INTO public."SupplyExecutionTask" (
      id, "officeId", "workspaceId", "snapshotId", "taskKey", "taskType", "capabilityKey", status,
      "requiresApproval", input, "inputHash", "externalSystem", "idempotencyKey", "createdAt", "updatedAt"
    )
    SELECT id, "officeId", "workspaceId", "snapshotId", "taskKey", "taskType", "capabilityKey", status,
      "requiresApproval", input, "inputHash", "externalSystem", "idempotencyKey",
      TIMESTAMPTZ '2026-08-01 00:00:00+00', TIMESTAMPTZ '2026-08-01 00:00:00+00'
    FROM jsonb_to_recordset($1::jsonb) AS row(
      id text, "officeId" text, "workspaceId" text, "snapshotId" text, "taskKey" text, "taskType" text,
      "capabilityKey" text, status text, "requiresApproval" boolean, input jsonb, "inputHash" text,
      "externalSystem" text, "idempotencyKey" text
    )
    ON CONFLICT (id) DO NOTHING
  `, executionTasks);

}

async function seedItemSupplyDetails(app: BenchmarkSqlClient, profile: BenchmarkProfile) {
  const ids = benchmarkStableIds(profile);
  const capability = COMMERCIAL_STATE_BENCHMARK_SCENARIOS.find((scenario) => scenario.id === "capability-versus-bom")!;
  const availability = COMMERCIAL_STATE_BENCHMARK_SCENARIOS.find((scenario) => scenario.id === "inventory-inbound-demand-availability")!;
  const capabilityContext = benchmarkScenarioContext(profile, capability);
  const availabilityContext = benchmarkScenarioContext(profile, availability);
  const locationId = deterministicBenchmarkId(profile, "scenario:inventory-inbound-demand-availability:location");
  await insertRows(app, `
    INSERT INTO public."SupplyLocation" (
      id, "officeId", "workspaceId", "snapshotId", "locationKey", name, kind, "countryCode", "sourceRefs"
    )
    SELECT id, "officeId", "workspaceId", "snapshotId", "locationKey", name, kind, "countryCode", "sourceRefs"
    FROM jsonb_to_recordset($1::jsonb) AS row(
      id text, "officeId" text, "workspaceId" text, "snapshotId" text, "locationKey" text,
      name text, kind text, "countryCode" text, "sourceRefs" jsonb
    )
    ON CONFLICT (id) DO NOTHING
  `, [{
    id: locationId,
    officeId: availabilityContext.officeId,
    workspaceId: availabilityContext.workspaceId,
    snapshotId: availabilityContext.snapshotId,
    locationKey: "BENCH-WAREHOUSE-01",
    name: "Benchmark Main Warehouse",
    kind: "WAREHOUSE",
    countryCode: "US",
    sourceRefs: [{ kind: "benchmark", profile }],
  }]);
  const availabilitySupplyItemId = deterministicBenchmarkId(profile, `supply-item:${availability.requestIndex + 1}`);
  await insertRows(app, `
    INSERT INTO public."SupplyInventoryPosition" (
      id, "officeId", "workspaceId", "snapshotId", "positionKey", "itemId", "locationId", "unitOfMeasure",
      "quantityOnHand", "quantityAllocated", "quantityInTransit", "quantityOnOrder", "expectedReceiptAt", "asOf", "sourceRefs"
    )
    SELECT id, "officeId", "workspaceId", "snapshotId", "positionKey", "itemId", "locationId", "unitOfMeasure",
      "quantityOnHand"::numeric, "quantityAllocated"::numeric, "quantityInTransit"::numeric, "quantityOnOrder"::numeric,
      "expectedReceiptAt"::timestamptz, "asOf"::timestamptz, "sourceRefs"
    FROM jsonb_to_recordset($1::jsonb) AS row(
      id text, "officeId" text, "workspaceId" text, "snapshotId" text, "positionKey" text, "itemId" text,
      "locationId" text, "unitOfMeasure" text, "quantityOnHand" numeric, "quantityAllocated" numeric,
      "quantityInTransit" numeric, "quantityOnOrder" numeric, "expectedReceiptAt" text, "asOf" text, "sourceRefs" jsonb
    )
    ON CONFLICT (id) DO NOTHING
  `, [{
    id: deterministicBenchmarkId(profile, "scenario:inventory-inbound-demand-availability:inventory"),
    officeId: availabilityContext.officeId,
    workspaceId: availabilityContext.workspaceId,
    snapshotId: availabilityContext.snapshotId,
    positionKey: "BENCH-INVENTORY-PUMP-SEAL-44",
    itemId: availabilitySupplyItemId,
    locationId,
    unitOfMeasure: "EA",
    quantityOnHand: 40,
    quantityAllocated: 0,
    quantityInTransit: 50,
    quantityOnOrder: 0,
    expectedReceiptAt: "2026-08-15T00:00:00.000Z",
    asOf: "2026-08-01T00:00:00.000Z",
    sourceRefs: [{ kind: "benchmark", profile }],
  }]);
  await insertRows(app, `
    INSERT INTO public."SupplyDemand" (
      id, "officeId", "workspaceId", "snapshotId", "demandKey", "itemId", "locationId", "sourceType",
      "externalId", quantity, "unitOfMeasure", "dueAt", status, priority, "sourceRefs"
    )
    SELECT id, "officeId", "workspaceId", "snapshotId", "demandKey", "itemId", "locationId", "sourceType",
      "externalId", quantity::numeric, "unitOfMeasure", "dueAt"::timestamptz, status, priority, "sourceRefs"
    FROM jsonb_to_recordset($1::jsonb) AS row(
      id text, "officeId" text, "workspaceId" text, "snapshotId" text, "demandKey" text, "itemId" text,
      "locationId" text, "sourceType" text, "externalId" text, quantity numeric, "unitOfMeasure" text,
      "dueAt" text, status text, priority int, "sourceRefs" jsonb
    )
    ON CONFLICT (id) DO NOTHING
  `, [{
    id: deterministicBenchmarkId(profile, "scenario:inventory-inbound-demand-availability:demand"),
    officeId: availabilityContext.officeId,
    workspaceId: availabilityContext.workspaceId,
    snapshotId: availabilityContext.snapshotId,
    demandKey: "BENCH-DEMAND-PUMP-SEAL-44",
    itemId: availabilitySupplyItemId,
    locationId,
    sourceType: "CUSTOMER_ORDER",
    externalId: "BENCH-DEMAND-120",
    quantity: 120,
    unitOfMeasure: "EA",
    dueAt: "2026-08-20T00:00:00.000Z",
    status: "OPEN",
    priority: 10,
    sourceRefs: [{ kind: "benchmark", profile }],
  }]);
  await insertRows(app, `
    INSERT INTO public."SupplySupplierTerm" (
      id, "officeId", "workspaceId", "snapshotId", "termKey", "itemId", "facilityId", "supplierKey",
      "supplierName", "isCurrent", "unitOfMeasure", currency, "unitPrice", "leadTimeMinDays", "leadTimeMaxDays",
      "availableQuantity", "availableAt", "evidenceRefs", "sourceRefs"
    )
    SELECT id, "officeId", "workspaceId", "snapshotId", "termKey", "itemId", "facilityId", "supplierKey",
      "supplierName", "isCurrent", "unitOfMeasure", currency, "unitPrice"::numeric, "leadTimeMinDays", "leadTimeMaxDays",
      "availableQuantity"::numeric, "availableAt"::timestamptz, "evidenceRefs", "sourceRefs"
    FROM jsonb_to_recordset($1::jsonb) AS row(
      id text, "officeId" text, "workspaceId" text, "snapshotId" text, "termKey" text, "itemId" text,
      "facilityId" text, "supplierKey" text, "supplierName" text, "isCurrent" boolean, "unitOfMeasure" text,
      currency text, "unitPrice" numeric, "leadTimeMinDays" int, "leadTimeMaxDays" int,
      "availableQuantity" numeric, "availableAt" text, "evidenceRefs" jsonb, "sourceRefs" jsonb
    )
    ON CONFLICT (id) DO NOTHING
  `, [{
    id: deterministicBenchmarkId(profile, "scenario:inventory-inbound-demand-availability:term"),
    officeId: availabilityContext.officeId,
    workspaceId: availabilityContext.workspaceId,
    snapshotId: availabilityContext.snapshotId,
    termKey: "BENCH-INBOUND-50",
    itemId: availabilitySupplyItemId,
    facilityId: locationId,
    supplierKey: availabilityContext.supplierKey,
    supplierName: "Harbor Industrial Ltd",
    isCurrent: true,
    unitOfMeasure: "EA",
    currency: "USD",
    unitPrice: 28.5,
    leadTimeMinDays: 10,
    leadTimeMaxDays: 14,
    availableQuantity: 50,
    availableAt: "2026-08-15T00:00:00.000Z",
    evidenceRefs: [],
    sourceRefs: [{ kind: "benchmark", profile }],
  }]);

  const productItemId = deterministicBenchmarkId(profile, `supply-item:${capability.requestIndex + 1}`);
  const componentRequestIndex = capability.requestIndex + 1;
  const componentItemId = deterministicBenchmarkId(profile, `supply-item:${componentRequestIndex + 1}`);
  const bomVersionId = deterministicBenchmarkId(profile, "scenario:capability-versus-bom:bom-version");
  await insertRows(app, `
    INSERT INTO public."SupplyBomVersion" (
      id, "officeId", "workspaceId", "snapshotId", "productItemId", revision, status, "sourceSystem", "externalId", "effectiveAt", "sourceRefs"
    )
    SELECT id, "officeId", "workspaceId", "snapshotId", "productItemId", revision, status, "sourceSystem", "externalId",
      "effectiveAt"::timestamptz, "sourceRefs"
    FROM jsonb_to_recordset($1::jsonb) AS row(
      id text, "officeId" text, "workspaceId" text, "snapshotId" text, "productItemId" text,
      revision text, status text, "sourceSystem" text, "externalId" text, "effectiveAt" text, "sourceRefs" jsonb
    )
    ON CONFLICT (id) DO NOTHING
  `, [{
    id: bomVersionId,
    officeId: capabilityContext.officeId,
    workspaceId: capabilityContext.workspaceId,
    snapshotId: capabilityContext.snapshotId,
    productItemId,
    revision: "BENCH-R2",
    status: "ACTIVE",
    sourceSystem: "BENCHMARK_BOM",
    externalId: "BOM-AEROSPACE-BRACKET-17",
    effectiveAt: "2026-07-01T00:00:00.000Z",
    sourceRefs: [{ kind: "benchmark", profile }],
  }]);
  await insertRows(app, `
    INSERT INTO public."SupplyBomLine" (
      id, "officeId", "workspaceId", "snapshotId", "bomVersionId", "parentItemId", "componentItemId",
      "lineNumber", quantity, "unitOfMeasure", "isOptional", "sourceRefs"
    )
    SELECT id, "officeId", "workspaceId", "snapshotId", "bomVersionId", "parentItemId", "componentItemId",
      "lineNumber", quantity::numeric, "unitOfMeasure", "isOptional", "sourceRefs"
    FROM jsonb_to_recordset($1::jsonb) AS row(
      id text, "officeId" text, "workspaceId" text, "snapshotId" text, "bomVersionId" text,
      "parentItemId" text, "componentItemId" text, "lineNumber" int, quantity numeric,
      "unitOfMeasure" text, "isOptional" boolean, "sourceRefs" jsonb
    )
    ON CONFLICT (id) DO NOTHING
  `, [{
    id: deterministicBenchmarkId(profile, "scenario:capability-versus-bom:bom-line"),
    officeId: capabilityContext.officeId,
    workspaceId: capabilityContext.workspaceId,
    snapshotId: capabilityContext.snapshotId,
    bomVersionId,
    parentItemId: productItemId,
    componentItemId,
    lineNumber: 10,
    quantity: 1,
    unitOfMeasure: "EA",
    isOptional: false,
    sourceRefs: [{ process: "5_AXIS_CNC", finish: "MIL-A-8625_TYPE_III" }],
  }]);
  await insertRows(app, `
    INSERT INTO public."SupplyFccProfile" (
      id, "officeId", "workspaceId", "snapshotId", "itemId", "moduleAuthorization",
      "hostIntegrationConstraints", labeling, "rfExposure", testing, "testingGaps", "reviewRequirements", "blockedReasons", "sourceRefs"
    )
    SELECT id, "officeId", "workspaceId", "snapshotId", "itemId", "moduleAuthorization",
      "hostIntegrationConstraints", labeling, "rfExposure", testing, "testingGaps", "reviewRequirements", "blockedReasons", "sourceRefs"
    FROM jsonb_to_recordset($1::jsonb) AS row(
      id text, "officeId" text, "workspaceId" text, "snapshotId" text, "itemId" text,
      "moduleAuthorization" text, "hostIntegrationConstraints" jsonb, labeling text, "rfExposure" text,
      testing text, "testingGaps" jsonb, "reviewRequirements" jsonb, "blockedReasons" jsonb, "sourceRefs" jsonb
    )
    ON CONFLICT (id) DO NOTHING
  `, [{
    id: deterministicBenchmarkId(profile, "scenario:capability-versus-bom:fcc-profile"),
    officeId: capabilityContext.officeId,
    workspaceId: capabilityContext.workspaceId,
    snapshotId: capabilityContext.snapshotId,
    itemId: productItemId,
    moduleAuthorization: "NOT_APPLICABLE",
    hostIntegrationConstraints: [],
    labeling: "NOT_APPLICABLE",
    rfExposure: "NOT_APPLICABLE",
    testing: "NOT_APPLICABLE",
    testingGaps: ["No RF-bearing module is part of the mechanical bracket BOM."],
    reviewRequirements: ["Confirm applicability before release."],
    blockedReasons: [],
    sourceRefs: [{ kind: "benchmark", profile }],
  }]);
}

type LedgerMessagePlan = {
  customerId: string;
  orderId: string;
  vendorId: string;
  providerMessageId: string;
  direction: "INBOUND" | "OUTBOUND";
  counterpartyEmail: string;
  subject: string;
  bodyText: string;
  sentAt: string;
};

async function seedCommunicationLedger(bourne: BenchmarkSqlClient, profile: BenchmarkProfile) {
  const ids = benchmarkStableIds(profile);
  const accountEmail = benchmarkAccountEmail(profile);
  const desired = new Map<string, LedgerMessagePlan>();
  const descriptors = evidenceDescriptors(profile).filter((descriptor) => descriptor.kind === "procurement_message");
  for (const descriptor of descriptors) {
    const target = benchmarkProcurementMessageTarget(profile, descriptor.scenario, descriptor.logicalId);
    const vendorIndex = ids.vendorIds.indexOf(target.vendorId);
    if (vendorIndex < 0) throw new Error("Benchmark procurement message targets an unknown vendor.");
    const requestIndex = Math.floor(vendorIndex / 2);
    const slot = vendorIndex % 2;
    const supplierIndexes = scenarioSupplierIndexes(requestIndex, Math.floor(requestIndex / 24));
    const identity = supplierName(supplierIndexes[slot]!);
    const providerMessageId = benchmarkProviderMessageId(profile, descriptor.scenario, descriptor.logicalId);
    const direction: "INBOUND" | "OUTBOUND" = descriptor.logicalId.includes("prepared-follow-up")
      ? "OUTBOUND"
      : "INBOUND";
    desired.set(`${target.orderId}:${target.vendorId}`, {
      ...target,
      providerMessageId,
      direction,
      counterpartyEmail: `rfq-${supplierIndexes[slot]! + 1}@${identity.domain}`,
      subject: descriptor.logicalId === "legal-commercial-question"
        ? "Indemnity and liability terms required"
        : descriptor.logicalId === "quote-arrival-message"
          ? "Quote Q-2026-061-R2"
          : `Supplier response for ${descriptor.scenario.family}`,
      bodyText: descriptor.content,
      sentAt: `2026-07-${String(10 + descriptor.scenario.ordinal).padStart(2, "0")}T12:00:00.000Z`,
    });
  }
  const rows: JsonRow[] = [];
  for (let requestIndex = 0; requestIndex < BENCHMARK_REQUEST_COUNT; requestIndex += 1) {
    const companyIndex = Math.floor(requestIndex / 4);
    const officeIndex = Math.floor(companyIndex / 6);
    const supplierIndexes = scenarioSupplierIndexes(requestIndex, officeIndex);
    for (let slot = 0; slot < 2; slot += 1) {
      const customerId = ids.workflowCustomerIds[companyIndex]!;
      const orderId = ids.orderIds[requestIndex]!;
      const vendorId = benchmarkVendorId(ids, requestIndex, slot);
      const planned = desired.get(`${orderId}:${vendorId}`);
      const supplierIndex = supplierIndexes[slot]!;
      const identity = supplierName(supplierIndex);
      const counterpartyEmail = planned?.counterpartyEmail ?? `rfq-${supplierIndex + 1}@${identity.domain}`;
      const providerMessageId = planned?.providerMessageId
        ?? `benchmark-provider-${profile}-${String((requestIndex * 2) + slot + 1).padStart(3, "0")}`;
      const direction = planned?.direction ?? "INBOUND";
      rows.push({
        customerId,
        orderId,
        vendorId,
        provider: "GMAIL",
        accountEmail,
        counterpartyEmail,
        providerMessageId,
        providerThreadId: `benchmark-thread-${profile}-${String(requestIndex + 1).padStart(3, "0")}`,
        rfcMessageId: `<${providerMessageId}@benchmark.example>`,
        direction,
        fromEmail: direction === "INBOUND" ? counterpartyEmail : accountEmail,
        fromName: direction === "INBOUND" ? identity.name : "Derya Benchmark Buyer",
        toEmails: direction === "INBOUND" ? [accountEmail] : [counterpartyEmail],
        ccEmails: [],
        subject: planned?.subject ?? `Response for RFQ-BENCH-${String(requestIndex + 1).padStart(4, "0")}`,
        bodyText: planned?.bodyText ?? "Supplier acknowledges the benchmark RFQ and confirms receipt.",
        bodyTruncated: false,
        attachments: [],
        sentAt: planned?.sentAt ?? `2026-07-${String(1 + (requestIndex % 28)).padStart(2, "0")}T10:00:00.000Z`,
      });
    }
  }
  if (rows.length !== 96) throw new Error("Benchmark workflow ledger must contain exactly 96 relevant messages.");
  await insertRows(bourne, `
    INSERT INTO public.procurement_communication_messages (
      customer_id, order_id, vendor_id, provider, account_email, counterparty_email, provider_message_id,
      provider_thread_id, rfc_message_id, direction, from_email, from_name, to_emails, cc_emails,
      subject, body_text, body_truncated, attachments, sent_at
    )
    SELECT "customerId"::uuid, "orderId"::uuid, "vendorId"::uuid, provider, "accountEmail", "counterpartyEmail",
      "providerMessageId", "providerThreadId", "rfcMessageId", direction, "fromEmail", "fromName", "toEmails",
      "ccEmails", subject, "bodyText", "bodyTruncated", attachments, "sentAt"::timestamptz
    FROM jsonb_to_recordset($1::jsonb) AS row(
      "customerId" text, "orderId" text, "vendorId" text, provider text, "accountEmail" text,
      "counterpartyEmail" text, "providerMessageId" text, "providerThreadId" text, "rfcMessageId" text,
      direction text, "fromEmail" text, "fromName" text, "toEmails" jsonb, "ccEmails" jsonb,
      subject text, "bodyText" text, "bodyTruncated" boolean, attachments jsonb, "sentAt" text
    )
    ON CONFLICT (customer_id, provider, account_email, provider_message_id) DO NOTHING
  `, rows);
}

async function seedEmailEvidence(app: BenchmarkSqlClient, profile: BenchmarkProfile) {
  const ids = benchmarkStableIds(profile);
  const accountEmail = benchmarkAccountEmail(profile);
  const direct = evidenceDescriptors(profile).filter((descriptor) => descriptor.kind === "email_message");
  const messages: JsonRow[] = direct.map((descriptor, index) => {
    const context = benchmarkScenarioContext(profile, descriptor.scenario);
    const reference = descriptor.ref as Extract<SupplyWorldEvidenceRef, { kind: "email_message" }>;
    const ambiguous = descriptor.hardNegative || /ambiguous|unrouted/.test(descriptor.logicalId);
    return {
      id: reference.id,
      threadId: deterministicBenchmarkId(profile, `email-thread:direct:${index + 1}`),
      officeId: context.officeId,
      companyId: ambiguous ? null : context.companyId,
      autoLinkSkipReason: ambiguous ? "UNROUTED_SHARED_MAILBOX" : null,
      externalId: `benchmark-email-external-${profile}-${index + 1}`,
      gmailMessageId: reference.providerMessageId ?? reference.id,
      rfcMessageId: `<benchmark-email-${profile}-${index + 1}@example.test>`,
      direction: "INBOUND",
      fromEmail: `ambiguous-${index + 1}@supplier.example`,
      toEmails: JSON.stringify([accountEmail]),
      ccEmails: JSON.stringify([]),
      subject: descriptor.scenario.family,
      bodyText: descriptor.content,
      sentAt: `2026-06-${String(1 + index).padStart(2, "0")}T09:00:00.000Z`,
    };
  });
  while (messages.length < 24) {
    const index = messages.length;
    const officeIndex = index % 2;
    const companyIndex = (officeIndex * 6) + 2 + (index % 4);
    messages.push({
      id: deterministicBenchmarkId(profile, `email-message:filler:${index + 1}`),
      threadId: deterministicBenchmarkId(profile, `email-thread:filler:${index + 1}`),
      officeId: ids.officeIds[officeIndex],
      companyId: ids.companyIds[companyIndex],
      autoLinkSkipReason: null,
      externalId: `benchmark-email-filler-${profile}-${index + 1}`,
      gmailMessageId: `benchmark-email-filler-${profile}-${index + 1}`,
      rfcMessageId: `<benchmark-email-filler-${profile}-${index + 1}@example.test>`,
      direction: "INBOUND",
      fromEmail: `supplier-${index + 1}@unrelated-history.example`,
      toEmails: JSON.stringify([accountEmail]),
      ccEmails: JSON.stringify([]),
      subject: `Historical unrelated supplier note ${index + 1}`,
      bodyText: "This routed historical note belongs to a non-golden company and is not evidence for benchmark gold cases.",
      sentAt: `2025-10-${String(1 + (index % 28)).padStart(2, "0")}T09:00:00.000Z`,
    });
  }
  if (messages.length > 24) throw new Error("Scripted EmailMessage evidence exceeds the fixed benchmark allocation.");
  const threads = messages.map((message, index) => ({
    id: message.threadId,
    officeId: message.officeId,
    companyId: message.companyId,
    subject: message.subject,
    participants: JSON.stringify([message.fromEmail, accountEmail]),
    externalThreadId: `benchmark-local-thread-${profile}-${index + 1}`,
    autoLinkSkipReason: message.autoLinkSkipReason,
    lastMessageAt: message.sentAt,
    messageCount: 1,
  }));
  await insertRows(app, `
    INSERT INTO public."EmailThread" (
      id, "officeId", "companyId", subject, participants, "externalThreadId", "autoLinkSkipReason",
      "lastMessageAt", "messageCount", "createdAt", "updatedAt"
    )
    SELECT id, "officeId", "companyId", subject, participants, "externalThreadId", "autoLinkSkipReason",
      "lastMessageAt"::timestamptz, "messageCount",
      TIMESTAMPTZ '2026-08-01 00:00:00+00', TIMESTAMPTZ '2026-08-01 00:00:00+00'
    FROM jsonb_to_recordset($1::jsonb) AS row(
      id text, "officeId" text, "companyId" text, subject text, participants text, "externalThreadId" text,
      "autoLinkSkipReason" text, "lastMessageAt" text, "messageCount" int
    )
    ON CONFLICT (id) DO NOTHING
  `, threads);
  await insertRows(app, `
    INSERT INTO public."EmailMessage" (
      id, "threadId", "officeId", "externalId", "gmailMessageId", "rfcMessageId", direction,
      "fromEmail", "toEmails", "ccEmails", subject, "bodyText", "sentAt"
    )
    SELECT id, "threadId", "officeId", "externalId", "gmailMessageId", "rfcMessageId", direction::public."EmailDirection",
      "fromEmail", "toEmails", "ccEmails", subject, "bodyText", "sentAt"::timestamptz
    FROM jsonb_to_recordset($1::jsonb) AS row(
      id text, "threadId" text, "officeId" text, "externalId" text, "gmailMessageId" text, "rfcMessageId" text,
      direction text, "fromEmail" text, "toEmails" text, "ccEmails" text, subject text, "bodyText" text, "sentAt" text
    )
    ON CONFLICT (id) DO NOTHING
  `, messages);
}

function relevantMemoryRows(profile: BenchmarkProfile) {
  const ids = benchmarkStableIds(profile);
  const descriptors = evidenceDescriptors(profile);
  const descriptorByPointer = new Map(descriptors.map((descriptor) => [
    `${descriptor.ref.kind}:${descriptor.ref.id}`,
    descriptor,
  ]));
  const directObjects = descriptors.filter((descriptor) => descriptor.kind === "knowledge_object");
  const directChunks = descriptors.filter((descriptor) => descriptor.kind === "knowledge_chunk");
  const directEvents = descriptors.filter((descriptor) => descriptor.kind === "memory_event");
  const objects: JsonRow[] = directObjects.map((descriptor) => {
    const context = benchmarkScenarioContext(profile, descriptor.scenario);
    const canonicalPointer = `${descriptor.ref.kind}:${descriptor.ref.id}`;
    const indexedText = [
      descriptor.content,
      descriptor.scenario.promptSubject,
      descriptor.scenario.promptCurrentQuestion,
    ].join("\n");
    return {
      id: descriptor.ref.id,
      officeId: context.officeId,
      sourceType: "BENCHMARK_RELEVANT",
      sourceExternalId: canonicalPointer,
      canonicalType: "COMMERCIAL_EVIDENCE",
      title: descriptor.scenario.family,
      contentHash: hashSupplyStateValue({ profile, objectId: descriptor.ref.id }),
      rawRef: `benchmark://${profile}/knowledge/${encodeURIComponent(descriptor.ref.id)}`,
      entityType: "company",
      entityId: context.companyId,
      companyId: context.companyId,
      occurredAt: "2026-06-01T00:00:00.000Z",
      payload: { text: indexedText, scenarioId: descriptor.scenario.id, hardNegative: descriptor.hardNegative },
      provenance: { source: "benchmark", profile, scenarioId: descriptor.scenario.id, canonicalEvidenceRef: descriptor.ref },
    };
  });
  for (const pointer of benchmarkExactLexicalCanonicalPointers(profile)) {
    if (objects.some((object) => object.sourceExternalId === pointer.canonicalPointer)) continue;
    const descriptor = descriptorByPointer.get(pointer.canonicalPointer);
    if (!descriptor) {
      throw new Error(`Keyword index pointer ${pointer.canonicalPointer} has no canonical evidence descriptor.`);
    }
    const context = benchmarkScenarioContext(profile, descriptor.scenario);
    const id = deterministicBenchmarkId(profile, `knowledge-object:canonical-index:${pointer.canonicalPointer}`);
    const indexedText = [
      descriptor.content,
      descriptor.scenario.promptSubject,
      descriptor.scenario.promptCurrentQuestion,
    ].join("\n");
    objects.push({
      id,
      officeId: context.officeId,
      sourceType: "BENCHMARK_RELEVANT",
      sourceExternalId: pointer.canonicalPointer,
      canonicalType: "COMMERCIAL_EVIDENCE",
      title: descriptor.scenario.family,
      contentHash: hashSupplyStateValue({ profile, canonicalPointer: pointer.canonicalPointer, indexedText }),
      rawRef: `benchmark://${profile}/canonical/${encodeURIComponent(pointer.canonicalPointer)}`,
      entityType: "company",
      entityId: context.companyId,
      companyId: context.companyId,
      occurredAt: "2026-07-20T00:00:00.000Z",
      payload: { text: indexedText, scenarioId: descriptor.scenario.id, canonicalPointer: pointer.canonicalPointer },
      provenance: { source: "benchmark", profile, scenarioId: descriptor.scenario.id, canonicalEvidenceRef: pointer.ref },
    });
  }
  while (objects.length < 24) {
    const index = objects.length;
    const scenario = COMMERCIAL_STATE_BENCHMARK_SCENARIOS[index % 12]!;
    const context = benchmarkScenarioContext(profile, scenario);
    const id = deterministicBenchmarkId(profile, `knowledge-object:relevant-filler:${index + 1}`);
    objects.push({
      id,
      officeId: context.officeId,
      sourceType: "BENCHMARK_RELEVANT",
      sourceExternalId: `relevant-object-filler-${index + 1}`,
      canonicalType: "COMMERCIAL_EVIDENCE",
      title: scenario.family,
      contentHash: hashSupplyStateValue({ profile, objectId: id }),
      rawRef: `benchmark://${profile}/knowledge/${encodeURIComponent(id)}`,
      entityType: "company",
      entityId: context.companyId,
      companyId: context.companyId,
      occurredAt: "2026-05-01T00:00:00.000Z",
      payload: { text: scenario.promptCurrentQuestion, scenarioId: scenario.id },
      provenance: { source: "benchmark", profile, scenarioId: scenario.id },
    });
  }
  if (objects.length > 24) throw new Error("Scripted KnowledgeObject evidence exceeds the relevant allocation.");
  const objectForScenario = (scenarioId: string, fallbackIndex: number) => objects.find((object) => (
    (object.payload as { scenarioId?: string }).scenarioId === scenarioId
  )) ?? objects[fallbackIndex % objects.length]!;

  const chunks: JsonRow[] = directChunks.map((descriptor, index) => {
    const object = objectForScenario(descriptor.scenario.id, index);
    return {
      id: descriptor.ref.id,
      officeId: object.officeId,
      objectId: object.id,
      ordinal: index,
      kind: "TEXT",
      text: descriptor.content,
      tokenCount: Math.ceil(descriptor.content.length / 4),
      metadata: { benchmark: true, profile, scenarioId: descriptor.scenario.id, hardNegative: descriptor.hardNegative },
      provenance: { source: "benchmark", profile, scenarioId: descriptor.scenario.id },
    };
  });
  while (chunks.length < 24) {
    const index = chunks.length;
    const object = objects[index]!;
    chunks.push({
      id: deterministicBenchmarkId(profile, `knowledge-chunk:relevant-filler:${index + 1}`),
      officeId: object.officeId,
      objectId: object.id,
      ordinal: index,
      kind: "TEXT",
      text: `Relevant bounded benchmark evidence ${index + 1}: ${(object.payload as { text: string }).text}`,
      tokenCount: 24,
      metadata: { benchmark: true, profile, relevant: true },
      provenance: { source: "benchmark", profile },
    });
  }
  if (chunks.length > 24) throw new Error("Scripted KnowledgeChunk evidence exceeds the relevant allocation.");

  const events: JsonRow[] = directEvents.map((descriptor, index) => {
    const context = benchmarkScenarioContext(profile, descriptor.scenario);
    const object = objectForScenario(descriptor.scenario.id, index);
    return {
      id: descriptor.ref.id,
      officeId: context.officeId,
      objectId: object.id,
      sourceType: "BENCHMARK_RELEVANT",
      sourceExternalId: `relevant-event-${descriptor.scenario.id}-${index + 1}`,
      eventType: "COMMERCIAL_STATE_CHANGED",
      entityType: "company",
      entityId: context.companyId,
      occurredAt: "2026-06-15T00:00:00.000Z",
      idempotencyKey: `benchmark:${profile}:relevant-event:${index + 1}`,
      payload: { text: descriptor.content, scenarioId: descriptor.scenario.id, hardNegative: descriptor.hardNegative },
      provenance: { source: "benchmark", profile, scenarioId: descriptor.scenario.id },
    };
  });
  while (events.length < 24) {
    const index = events.length;
    const object = objects[index]!;
    events.push({
      id: deterministicBenchmarkId(profile, `memory-event:relevant-filler:${index + 1}`),
      officeId: object.officeId,
      objectId: object.id,
      sourceType: "BENCHMARK_RELEVANT",
      sourceExternalId: `relevant-event-filler-${index + 1}`,
      eventType: "COMMERCIAL_EVIDENCE_CAPTURED",
      entityType: "company",
      entityId: object.companyId,
      occurredAt: "2026-05-15T00:00:00.000Z",
      idempotencyKey: `benchmark:${profile}:relevant-event-filler:${index + 1}`,
      payload: { benchmark: true, relevant: true, ordinal: index + 1 },
      provenance: { source: "benchmark", profile },
    });
  }
  if (events.length > 24) throw new Error("Scripted MemoryEvent evidence exceeds the relevant allocation.");
  return { ids, objects, chunks, events };
}

async function insertKnowledgeObjects(app: BenchmarkSqlClient, rows: readonly JsonRow[]) {
  return insertRows(app, `
    INSERT INTO public."KnowledgeObject" (
      id, "officeId", "sourceType", "sourceExternalId", "canonicalType", title, "contentHash", "rawRef",
      "entityType", "entityId", "companyId", "occurredAt", payload, provenance, "createdAt", "updatedAt"
    )
    SELECT id, "officeId", "sourceType", "sourceExternalId", "canonicalType", title, "contentHash", "rawRef",
      "entityType", "entityId", "companyId", "occurredAt"::timestamptz, payload, provenance,
      TIMESTAMPTZ '2026-08-01 00:00:00+00', TIMESTAMPTZ '2026-08-01 00:00:00+00'
    FROM jsonb_to_recordset($1::jsonb) AS row(
      id text, "officeId" text, "sourceType" text, "sourceExternalId" text, "canonicalType" text,
      title text, "contentHash" text, "rawRef" text, "entityType" text, "entityId" text, "companyId" text,
      "occurredAt" text, payload jsonb, provenance jsonb
    )
    ON CONFLICT (id) DO NOTHING
  `, rows);
}

async function insertKnowledgeChunks(app: BenchmarkSqlClient, rows: readonly JsonRow[]) {
  return insertRows(app, `
    INSERT INTO public."KnowledgeChunk" (
      id, "officeId", "objectId", ordinal, kind, text, "tokenCount", metadata, provenance, "createdAt", "updatedAt"
    )
    SELECT id, "officeId", "objectId", ordinal, kind, text, "tokenCount", metadata, provenance,
      TIMESTAMPTZ '2026-08-01 00:00:00+00', TIMESTAMPTZ '2026-08-01 00:00:00+00'
    FROM jsonb_to_recordset($1::jsonb) AS row(
      id text, "officeId" text, "objectId" text, ordinal int, kind text, text text, "tokenCount" int,
      metadata jsonb, provenance jsonb
    )
    ON CONFLICT (id) DO NOTHING
  `, rows);
}

async function insertMemoryEvents(app: BenchmarkSqlClient, rows: readonly JsonRow[]) {
  return insertRows(app, `
    INSERT INTO public."MemoryEvent" (
      id, "officeId", "objectId", "sourceType", "sourceExternalId", "eventType", "entityType", "entityId",
      "occurredAt", "idempotencyKey", payload, provenance
    )
    SELECT id, "officeId", "objectId", "sourceType", "sourceExternalId", "eventType", "entityType", "entityId",
      "occurredAt"::timestamptz, "idempotencyKey", payload, provenance
    FROM jsonb_to_recordset($1::jsonb) AS row(
      id text, "officeId" text, "objectId" text, "sourceType" text, "sourceExternalId" text, "eventType" text,
      "entityType" text, "entityId" text, "occurredAt" text, "idempotencyKey" text, payload jsonb, provenance jsonb
    )
    ON CONFLICT (id) DO NOTHING
  `, rows);
}

function distractorText(index: number) {
  const templates = [
    "Historical RFQ payment terms were NET_30 for an unrelated archived account.",
    "A superseded quote mentioned rush delivery but belongs to a different supplier and SKU.",
    "Inventory review recorded inbound units and demand for a non-golden component.",
    "A vendor with a similar name supplied a different legal entity in another request.",
    "Technical document processing completed for an unrelated drawing revision.",
    "A prior purchase order and provider message were reconciled for a closed request.",
  ];
  return `${templates[index % templates.length]} Distractor record ${index + 1}.`;
}

async function seedCompanyBrain(app: BenchmarkSqlClient, profile: BenchmarkProfile) {
  const relevant = relevantMemoryRows(profile);
  const plan = benchmarkRetrievableCountPlan(profile);
  await insertKnowledgeObjects(app, relevant.objects);
  await insertKnowledgeChunks(app, relevant.chunks);
  await insertMemoryEvents(app, relevant.events);

  const objectDistractors = plan.knowledgeObjects - relevant.objects.length;
  const chunkDistractors = plan.knowledgeChunks - relevant.chunks.length;
  const eventDistractors = plan.memoryEvents - relevant.events.length;
  const max = Math.max(objectDistractors, chunkDistractors, eventDistractors);
  for (let start = 0; start < max; start += INSERT_BATCH_SIZE) {
    const end = Math.min(max, start + INSERT_BATCH_SIZE);
    const objects: JsonRow[] = [];
    const chunks: JsonRow[] = [];
    const events: JsonRow[] = [];
    for (let index = start; index < end; index += 1) {
      const officeIndex = index % 2;
      const companyIndex = (officeIndex * 6) + 2 + (index % 4);
      const objectId = `${benchmarkProfilePrefix(profile)}:distractor-object:${String(index + 1).padStart(7, "0")}`;
      const text = distractorText(index);
      if (index < objectDistractors) {
        objects.push({
          id: objectId,
          officeId: relevant.ids.officeIds[officeIndex],
          sourceType: "BENCHMARK_DISTRACTOR",
          sourceExternalId: `distractor-object-${String(index + 1).padStart(7, "0")}`,
          canonicalType: "HISTORICAL_COMMERCIAL_NOTE",
          title: `Unrelated commercial history ${index + 1}`,
          contentHash: hashSupplyStateValue({ profile, distractor: index + 1 }),
          rawRef: `benchmark://${profile}/distractor/${index + 1}`,
          entityType: "company",
          entityId: relevant.ids.companyIds[companyIndex],
          companyId: relevant.ids.companyIds[companyIndex],
          occurredAt: `2024-${String(1 + (index % 12)).padStart(2, "0")}-15T00:00:00.000Z`,
          payload: { text, benchmark: true, distractor: true },
          provenance: { source: "benchmark", profile, distractor: true },
        });
      }
      if (index < chunkDistractors) {
        chunks.push({
          id: `${benchmarkProfilePrefix(profile)}:distractor-chunk:${String(index + 1).padStart(7, "0")}`,
          officeId: relevant.ids.officeIds[officeIndex],
          objectId,
          ordinal: 0,
          kind: "TEXT",
          text,
          tokenCount: Math.ceil(text.length / 4),
          metadata: { benchmark: true, profile, distractor: true },
          provenance: { source: "benchmark", profile, distractor: true },
        });
      }
      if (index < eventDistractors) {
        events.push({
          id: `${benchmarkProfilePrefix(profile)}:distractor-event:${String(index + 1).padStart(7, "0")}`,
          officeId: relevant.ids.officeIds[officeIndex],
          objectId,
          sourceType: "BENCHMARK_DISTRACTOR",
          sourceExternalId: `distractor-event-${String(index + 1).padStart(7, "0")}`,
          eventType: "HISTORICAL_NOTE_CAPTURED",
          entityType: "company",
          entityId: relevant.ids.companyIds[companyIndex],
          occurredAt: `2024-${String(1 + (index % 12)).padStart(2, "0")}-16T00:00:00.000Z`,
          idempotencyKey: `benchmark:${profile}:distractor-event:${index + 1}`,
          payload: { text, benchmark: true, distractor: true },
          provenance: { source: "benchmark", profile, distractor: true },
        });
      }
    }
    if (objects.length) await insertKnowledgeObjects(app, objects);
    if (chunks.length) await insertKnowledgeChunks(app, chunks);
    if (events.length) await insertMemoryEvents(app, events);
  }
}

async function currentConcurrencyDependency(
  clients: Pick<BenchmarkClients, "app" | "dashboard">,
  profile: BenchmarkProfile,
  caseRow: BenchmarkCase,
): Promise<SupplyStateDependency> {
  const concurrency = caseRow.metadata.actionConcurrency;
  if (!concurrency) throw new Error("Benchmark case is not a concurrency case.");
  const scenario = COMMERCIAL_STATE_BENCHMARK_SCENARIOS.find((entry) => entry.id === caseRow.metadata.scenarioId)!;
  const context = benchmarkScenarioContext(profile, scenario);
  const mutation = concurrency.mutation;
  const reason = `Benchmark semantic concurrency guard for ${scenario.family}.`;
  if (scenario.concurrencyKind === "supplier_fact_head") {
    const rows = await clients.app.$queryRawUnsafe<Array<{ id: string; contentHash: string }>>(`
      SELECT id, "contentHash"
      FROM public."SupplyProfileFact"
      WHERE "officeId" = $1
        AND "workspaceId" = $2
        AND "subjectType" = 'SUPPLIER'
        AND "subjectRef" = $3
      ORDER BY "capturedAt" DESC, id DESC
      LIMIT 50
    `, context.officeId, context.workspaceId, context.supplierKey);
    const value = rows.map((row) => ({ id: row.id, contentHash: row.contentHash }));
    const valueHash = hashSupplyStateValue(value);
    return {
      key: concurrency.baselineDependencyKey,
      source: "APP_DB",
      entityType: "SupplyProfileFact",
      entityRef: context.supplierKey,
      version: valueHash,
      valueHash,
      policy: "STRICT",
      reason,
      evidenceRefs: rows.map((row) => ({ kind: "supply_profile_fact", id: row.id, contentHash: row.contentHash })),
    };
  }
  if (scenario.concurrencyKind === "company_context_document") {
    const rows = await clients.app.$queryRawUnsafe<Array<{ id: string; contentHash: string | null; processingState: string | null }>>(`
      SELECT id, "contentHash", "processingState"
      FROM public."CompanyContext"
      WHERE id = $1 AND "officeId" = $2 AND "companyId" = $3 AND kind = 'DOCUMENT'
      LIMIT 1
    `, context.contextId, context.officeId, context.companyId);
    const row = rows[0];
    if (!row) throw new Error("Benchmark company context concurrency source is missing.");
    const value = { contentHash: row.contentHash, processingState: row.processingState };
    return {
      key: concurrency.baselineDependencyKey,
      source: "APP_DB",
      entityType: "CompanyContext",
      entityRef: row.id,
      version: row.contentHash ?? hashSupplyStateValue(value),
      valueHash: hashSupplyStateValue(value),
      policy: "STRICT",
      reason,
      evidenceRefs: [{ kind: "company_context", id: row.id, contentHash: row.contentHash }],
    };
  }
  if (scenario.concurrencyKind === "workspace_snapshot") {
    const rows = await clients.app.$queryRawUnsafe<Array<{
      id: string;
      version: number;
      schemaVersion: number;
      sourceHash: string | null;
      publishedAt: Date;
    }>>(`
      SELECT id, version, "schemaVersion", "sourceHash", "publishedAt"
      FROM public."SupplySnapshot"
      WHERE "officeId" = $1 AND "workspaceId" = $2 AND status = 'PUBLISHED'
      ORDER BY version DESC, "publishedAt" DESC, id DESC
      LIMIT 1
    `, context.officeId, context.workspaceId);
    const row = rows[0];
    if (!row) throw new Error("Benchmark snapshot concurrency source is missing.");
    const sourceHash = row.sourceHash ?? hashSupplyStateValue({
      id: row.id,
      version: row.version,
      schemaVersion: row.schemaVersion,
      publishedAt: row.publishedAt.toISOString(),
    });
    const value = {
      id: row.id,
      version: row.version,
      schemaVersion: row.schemaVersion,
      sourceHash,
      publishedAt: row.publishedAt.toISOString(),
    };
    return {
      key: concurrency.baselineDependencyKey,
      source: "APP_DB",
      entityType: "SupplySnapshot",
      entityRef: context.workspaceId,
      version: row.id,
      valueHash: hashSupplyStateValue(value),
      policy: "STRICT",
      reason,
      evidenceRefs: [{ kind: "supply_snapshot", id: row.id, sourceHash }],
    };
  }
  if (scenario.concurrencyKind === "vendor_quote") {
    const rows = await clients.dashboard.$queryRawUnsafe<Array<{ id: string; quote: unknown }>>(`
      SELECT id::text AS id, quote
      FROM public.order_vendors
      WHERE id = $1::uuid AND order_id = $2::uuid
      LIMIT 1
    `, context.vendorId, context.orderId);
    const row = rows[0];
    if (!row) throw new Error("Benchmark vendor quote concurrency source is missing.");
    const valueHash = hashSupplyStateValue(row.quote);
    return {
      key: concurrency.baselineDependencyKey,
      source: "WORKFLOW_DB",
      entityType: "order_vendor_quote",
      entityRef: row.id,
      version: valueHash,
      valueHash,
      policy: "STRICT",
      reason,
      evidenceRefs: [{ kind: "procurement_vendor", id: row.id, valueHash }],
    };
  }
  if (scenario.concurrencyKind === "vendor_latest_message") {
    const rows = await clients.dashboard.$queryRawUnsafe<Array<{
      provider: string;
      accountEmail: string;
      providerMessageId: string;
      direction: "INBOUND" | "OUTBOUND";
      fromEmail: string;
      toEmails: unknown;
      ccEmails: unknown;
      subject: string | null;
      bodyText: string | null;
      bodyTruncated: boolean;
      sentAt: Date;
    }>>(`
      SELECT provider, account_email AS "accountEmail", provider_message_id AS "providerMessageId",
        direction, from_email AS "fromEmail", to_emails AS "toEmails", cc_emails AS "ccEmails",
        subject, body_text AS "bodyText", body_truncated AS "bodyTruncated", sent_at AS "sentAt"
      FROM public.procurement_communication_messages
      WHERE customer_id = $1::uuid AND order_id = $2::uuid AND vendor_id = $3::uuid
      ORDER BY sent_at DESC, provider_message_id DESC
      LIMIT 1
    `, context.customerId, context.orderId, context.vendorId);
    const row = rows[0];
    if (!row) throw new Error("Benchmark latest message concurrency source is missing.");
    const messageId = benchmarkConversationMessageId({
      customerId: context.customerId,
      orderId: context.orderId,
      vendorId: context.vendorId,
      provider: row.provider,
      accountEmail: row.accountEmail,
      providerMessageId: row.providerMessageId,
    });
    const stringArray = (value: unknown) => Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim().toLowerCase()).filter(Boolean).sort()
      : [];
    const value = {
      id: messageId,
      direction: row.direction,
      fromEmail: row.fromEmail.trim().toLowerCase(),
      toEmails: stringArray(row.toEmails),
      ccEmails: stringArray(row.ccEmails),
      subject: row.subject?.trim() || null,
      bodyHash: hashSupplyStateValue(row.bodyText ?? ""),
      sentAt: row.sentAt.toISOString(),
      truncated: row.bodyTruncated,
    };
    return {
      key: concurrency.baselineDependencyKey,
      source: "EMAIL_LEDGER",
      entityType: "procurement_communication_message",
      entityRef: context.vendorId,
      version: messageId,
      valueHash: hashSupplyStateValue(value),
      policy: "STRICT",
      reason,
      evidenceRefs: [{ kind: "procurement_message", id: messageId, valueHash: hashSupplyStateValue(value) }],
    };
  }
  if (scenario.concurrencyKind === "vendor_saved_draft") {
    const rows = await clients.app.$queryRawUnsafe<Array<{ id: string; inputHash: string; status: string }>>(`
      SELECT id, "inputHash", status
      FROM public."SupplyExecutionTask"
      WHERE id = $1 AND "officeId" = $2
      LIMIT 1
    `, context.executionTaskId, context.officeId);
    const row = rows[0];
    if (!row) throw new Error("Benchmark saved draft concurrency source is missing.");
    const value = { id: row.id, inputHash: row.inputHash, status: row.status };
    return {
      key: concurrency.baselineDependencyKey,
      source: "APP_DB",
      entityType: "SupplyExecutionTask",
      entityRef: row.id,
      version: row.inputHash,
      valueHash: hashSupplyStateValue(value),
      policy: "STRICT",
      reason,
      evidenceRefs: [{ kind: "execution_task", id: row.id, inputHash: row.inputHash }],
    };
  }
  throw new Error(`Unsupported benchmark concurrency source ${String(mutation.kind)}.`);
}

async function seedStateReads(
  clients: Pick<BenchmarkClients, "app" | "dashboard">,
  manifest: BenchmarkCorpusManifest,
) {
  const rows: JsonRow[] = [];
  for (const caseRow of manifest.cases.filter((candidate) => candidate.metadata.actionConcurrency)) {
    const concurrency = caseRow.metadata.actionConcurrency!;
    const current = await currentConcurrencyDependency(clients, manifest.profile, caseRow);
    const dependency = concurrency.expectedValid ? current : {
      ...current,
      version: hashSupplyStateValue({ caseId: caseRow.id, state: "stale-version" }),
      valueHash: hashSupplyStateValue({ caseId: caseRow.id, state: "stale-value" }),
    };
    const packet = buildBenchmarkStateReadPacket({
      caseRow,
      dependency,
      evidenceRefs: dependency.evidenceRefs,
    });
    rows.push({
      id: concurrency.stateReadId,
      officeId: caseRow.scope.officeId,
      workspaceId: supplyStateWorkspaceId(caseRow.scope),
      scopeType: caseRow.scope.type,
      scopeRef: supplyStateScopeRef(caseRow.scope),
      objective: packet.objective,
      compilerVersion: packet.compilerVersion,
      sourceFingerprint: packet.sourceFingerprint,
      packet,
      packetHash: packet.packetHash,
      evidenceRefs: packet.evidenceRefs,
      dependencyManifest: packet.dependencies,
    });
  }
  if (rows.length !== 40) throw new Error("Benchmark seed must persist exactly 40 immutable state reads.");
  await insertRows(clients.app, `
    INSERT INTO public."SupplyStateRead" (
      id, "officeId", "workspaceId", "scopeType", "scopeRef", objective, "compilerVersion",
      "sourceFingerprint", packet, "packetHash", "evidenceRefs", "dependencyManifest"
    )
    SELECT id, "officeId", "workspaceId", "scopeType", "scopeRef", objective, "compilerVersion",
      "sourceFingerprint", packet, "packetHash", "evidenceRefs", "dependencyManifest"
    FROM jsonb_to_recordset($1::jsonb) AS row(
      id text, "officeId" text, "workspaceId" text, "scopeType" text, "scopeRef" text, objective text,
      "compilerVersion" text, "sourceFingerprint" text, packet jsonb, "packetHash" text,
      "evidenceRefs" jsonb, "dependencyManifest" jsonb
    )
    ON CONFLICT (id) DO NOTHING
  `, rows);
}

async function actualRetrievableCounts(
  clients: Pick<BenchmarkClients, "app" | "dashboard">,
  profile: BenchmarkProfile,
) {
  const ids = benchmarkStableIds(profile);
  const officeIds = ids.officeIds;
  const customerIds = ids.workflowCustomerIds;
  const rows = await clients.app.$queryRawUnsafe<Array<Record<string, bigint>>>(`
    SELECT
      (SELECT count(*) FROM public."CompanyContext" WHERE "officeId" = ANY($1::text[])) AS "companyContext",
      (SELECT count(*) FROM public."EmailMessage" WHERE "officeId" = ANY($1::text[])) AS "emailMessages",
      (SELECT count(*) FROM public."KnowledgeObject" WHERE "officeId" = ANY($1::text[])) AS "knowledgeObjects",
      (SELECT count(*) FROM public."KnowledgeChunk" WHERE "officeId" = ANY($1::text[])) AS "knowledgeChunks",
      (SELECT count(*) FROM public."MemoryEvent" WHERE "officeId" = ANY($1::text[])) AS "memoryEvents",
      (SELECT count(*) FROM public."SupplyProfileFact" WHERE "officeId" = ANY($1::text[])) AS "supplyProfileFacts",
      (SELECT count(*) FROM public."SupplyPriceObservation" WHERE "officeId" = ANY($1::text[])) AS "supplyPriceObservations",
      (SELECT count(*) FROM public."SupplyEvidence" WHERE "officeId" = ANY($1::text[])) AS "supplyEvidence",
      (SELECT count(*) FROM public."SupplyExecutionEvent" WHERE "officeId" = ANY($1::text[])) AS "supplyExecutionEvents"
  `, officeIds);
  const ledgerRows = await clients.dashboard.$queryRawUnsafe<Array<{ count: bigint }>>(`
    SELECT count(*) AS count
    FROM public.procurement_communication_messages
    WHERE customer_id = ANY($1::uuid[])
  `, customerIds);
  const row = rows[0];
  if (!row) throw new Error("Benchmark retrievable counts could not be read.");
  const counts = {
    companyContext: Number(row.companyContext),
    procurementCommunicationMessages: Number(ledgerRows[0]?.count ?? 0),
    emailMessages: Number(row.emailMessages),
    knowledgeObjects: Number(row.knowledgeObjects),
    knowledgeChunks: Number(row.knowledgeChunks),
    memoryEvents: Number(row.memoryEvents),
    supplyProfileFacts: Number(row.supplyProfileFacts),
    supplyPriceObservations: Number(row.supplyPriceObservations),
    supplyEvidence: Number(row.supplyEvidence),
    supplyExecutionEvents: Number(row.supplyExecutionEvents),
    total: 0,
  };
  counts.total = Object.entries(counts)
    .filter(([key]) => key !== "total")
    .reduce((total, [, value]) => total + value, 0);
  return counts;
}

async function seedCases(owner: BenchmarkSqlClient, manifest: BenchmarkCorpusManifest) {
  const rows = manifest.cases.map((caseRow) => ({
    id: caseRow.id,
    profile: caseRow.profile,
    queryText: caseRow.queryText,
    queryType: caseRow.queryType,
    difficulty: caseRow.difficulty,
    scope: caseRow.scope,
    goldFacts: caseRow.goldFacts,
    goldEvidence: caseRow.goldEvidence,
    goldDependencies: caseRow.goldDependencies,
    metadata: caseRow.metadata,
  }));
  await insertRows(owner, `
    INSERT INTO benchmark.cases (
      id, profile, query_text, query_type, difficulty, scope_json, gold_facts_json,
      gold_evidence_json, gold_dependencies_json, metadata_json
    )
    SELECT id, profile, "queryText", "queryType", difficulty, scope, "goldFacts", "goldEvidence", "goldDependencies", metadata
    FROM jsonb_to_recordset($1::jsonb) AS row(
      id text, profile text, "queryText" text, "queryType" text, difficulty text, scope jsonb,
      "goldFacts" jsonb, "goldEvidence" jsonb, "goldDependencies" jsonb, metadata jsonb
    )
    ON CONFLICT (id) DO NOTHING
  `, rows);
}

export function benchmarkProcurementCustomerMap(profile: BenchmarkProfile) {
  const ids = benchmarkStableIds(profile);
  return {
    [ids.officeIds[0]]: ids.workflowCustomerIds[0]!,
    [ids.officeIds[1]]: ids.workflowCustomerIds[6]!,
  };
}

export async function seedCommercialStateBenchmark(args: {
  clients: BenchmarkClients;
  profile: BenchmarkProfile;
}) {
  const manifest = generateBenchmarkCorpus(args.profile);
  await assertProfileMetadataCompatible(args.clients.owner, manifest);
  await seedCoreGraph(args.clients, args.profile);
  await seedSupplyState(args.clients, args.profile);
  await seedCommunicationLedger(args.clients.bourne, args.profile);
  await seedEmailEvidence(args.clients.app, args.profile);
  await seedCompanyBrain(args.clients.app, args.profile);
  await seedStateReads(args.clients, manifest);
  const actualCounts = await actualRetrievableCounts(args.clients, args.profile);
  const expectedCounts = benchmarkRetrievableCountPlan(args.profile);
  if (hashSupplyStateValue(actualCounts) !== hashSupplyStateValue(expectedCounts)
    || actualCounts.total !== BENCHMARK_PROFILE_RETRIEVABLE_TARGETS[args.profile]) {
    throw new Error(
      `Benchmark ${args.profile} retrievable count mismatch: expected ${JSON.stringify(expectedCounts)}, received ${JSON.stringify(actualCounts)}. Run benchmark:reset before reseeding.`,
    );
  }
  await seedCases(args.clients.owner, manifest);
  await assertProfileMetadataCompatible(args.clients.owner, manifest);
  await analyzeBenchmarkLexicalTables(args.clients.owner);
  return {
    ...manifest,
    procurementCustomerMap: benchmarkProcurementCustomerMap(args.profile),
    retrievableCounts: actualCounts,
  };
}
