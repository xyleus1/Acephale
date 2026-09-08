import assert from "node:assert/strict";
import {
  hashSupplyStateDependencies,
  hashSupplyStateValue,
} from "../src/lib/supply-os/state-runtime/canonicalize";
import { buildSupplyStateProjection } from "../src/lib/supply-os/state-runtime/projections/build";
import {
  emptySupplyStateReaderResult,
  makeSupplyStateDependency,
  SupplyStateDependencyDriftError,
} from "../src/lib/supply-os/state-runtime/readers/types";
import {
  assertSupplyStateScopeOwnership,
  SupplyStateScopeOwnershipError,
} from "../src/lib/supply-os/state-runtime/readers/scope-ownership";
import {
  invalidateCompanyContextDocumentStateProjections,
  invalidatePublishedSupplySnapshotStateProjections,
  invalidateRoutedEmailThreadStateProjections,
} from "../src/lib/supply-os/state-runtime/projections/invalidate";
import {
  getFreshStateProjection,
  storeSupplyStateProjection,
} from "../src/lib/supply-os/state-runtime/projections/store";
import { projectionFreshnessHeadDependencies } from "../src/lib/supply-os/state-runtime/projections/freshness";
import type {
  SupplyStateProjectionBuild,
  SupplyStateProjectionRequest,
} from "../src/lib/supply-os/state-runtime/projections/types";
import {
  enqueueSupplyStateProjectionRebuildIfEnabled,
  parseSupplyStateProjectionJobPayload,
  runSupplyStateProjectionRebuildJob,
  supplyStateProjectionJobDedupeKey,
} from "../src/lib/supply-os/state-runtime/projections/worker";
import {
  getSupplyStateMetricSummaries,
  resetSupplyStateInstrumentationForTests,
} from "../src/lib/supply-os/state-runtime/instrumentation";
import {
  supplyStateScopeRef,
  type SupplyStateDependency,
  type SupplyStateScope,
} from "../src/lib/supply-os/state-runtime/types";

const scope = {
  type: "company",
  officeId: "office-a",
  companyId: "company-a",
  workspaceId: "workspace-a",
} satisfies SupplyStateScope;

function dependency(version: string): SupplyStateDependency {
  return {
    key: "company.context_version:company-a",
    source: "APP_DB",
    entityType: "CompanyContext",
    entityRef: "company-a",
    version,
    valueHash: hashSupplyStateValue({ version }),
    policy: "ADVISORY",
    reason: "Company Context changed.",
    evidenceRefs: [],
  };
}

function build(version: string): SupplyStateProjectionBuild {
  const dependencies = [dependency(version)];
  const payload = {
    currentState: { company: { id: "company-a", version } },
    derivedState: {},
    openLoops: [],
    uncertainties: [],
  };
  return {
    scope,
    projectionType: "company_context_v1",
    compilerVersion: "supply-world-state-v1.2",
    sourceFingerprint: hashSupplyStateDependencies(dependencies),
    payload,
    payloadHash: hashSupplyStateValue(payload),
    evidenceRefs: [],
    dependencies,
    builtAt: "2026-08-26T12:00:00.000Z",
    sourceCounts: { APP_DB: 1 },
    timingsMs: { company_context: 1 },
    hadReaderFailure: false,
  };
}

async function projectionCacheContract() {
  resetSupplyStateInstrumentationForTests();
  let storedRow: Record<string, unknown> | null = null;
  let buildCount = 0;
  let fresh = true;
  let nextBuild = build("v1");
  const dependencies = {
    assertScopeOwnership: async () => {},
    findUnique: async () => storedRow,
    upsert: async (args: Record<string, Record<string, unknown>>) => {
      const now = new Date("2026-08-26T12:00:00.000Z");
      storedRow = {
        ...(storedRow ?? {}),
        ...(storedRow ? args.update : args.create),
        id: "projection-a",
        builtAt: (storedRow ? args.update.builtAt : args.create.builtAt) ?? now,
        dirtyAt: null,
        createdAt: now,
        updatedAt: now,
      };
      return { id: "projection-a", builtAt: new Date(storedRow.builtAt as Date | string) };
    },
    build: async () => {
      buildCount += 1;
      return nextBuild;
    },
    checkFreshness: async () => ({
      fresh,
      sourceFingerprint: fresh ? nextBuild.sourceFingerprint : null,
      changedKeys: fresh ? [] : [nextBuild.dependencies[0]!.key],
      failedKeys: [],
    }),
  };

  const request = { scope, projectionsEnabled: true } satisfies SupplyStateProjectionRequest & {
    projectionsEnabled: boolean;
  };
  const first = await getFreshStateProjection(request, dependencies as never);
  assert.equal(first.projectionHit, false, "First projection compilation must build live state.");
  assert.equal(first.id, "projection-a", "First projection compilation was not materialized.");
  assert.equal(buildCount, 1);

  const second = await getFreshStateProjection(request, dependencies as never);
  assert.equal(second.projectionHit, true, "Second unchanged compilation must hit the projection.");
  assert.equal(buildCount, 1, "A fresh projection was rebuilt.");

  fresh = false;
  nextBuild = build("v2");
  const changed = await getFreshStateProjection(request, dependencies as never);
  assert.equal(changed.projectionHit, false, "A relevant dependency change must bypass stale state.");
  assert.equal(changed.dependencies[0]?.version, "v2");
  assert.equal(buildCount, 2);

  fresh = true;
  const unrelated = await getFreshStateProjection(request, dependencies as never);
  assert.equal(unrelated.projectionHit, true, "An unrelated change must not invalidate the projection.");
  assert.equal(buildCount, 2);

  const fallback = await getFreshStateProjection(request, {
    assertScopeOwnership: async () => {},
    findUnique: async () => { throw new Error("projection read unavailable"); },
    upsert: async () => { throw new Error("projection write unavailable"); },
    build: async () => build("live"),
    checkFreshness: async () => { throw new Error("not called"); },
  } as never);
  assert.equal(fallback.id, null, "Projection failure did not fall back to live compilation.");
  assert.equal(fallback.projectionHit, false);

  const hitsBeforeDisabledRead = getSupplyStateMetricSummaries()
    .find((summary) => summary.name === "projection_hit")?.count;
  const disabled = await getFreshStateProjection({ ...request, projectionsEnabled: false }, {
    assertScopeOwnership: async () => {},
    findUnique: async () => { throw new Error("Disabled projections must not read the cache."); },
    upsert: async () => { throw new Error("Disabled projections must not write the cache."); },
    build: async () => build("disabled-live"),
    checkFreshness: async () => { throw new Error("Disabled projections must not check freshness."); },
  } as never);
  assert.equal(disabled.id, null);
  assert.equal(
    getSupplyStateMetricSummaries().find((summary) => summary.name === "projection_hit")?.count,
    hitsBeforeDisabledRead,
    "A disabled projection lookup polluted the projection hit-rate metric.",
  );
  assert.equal(
    getSupplyStateMetricSummaries().find((summary) => summary.name === "projection_rebuild_count")?.count,
    2,
    "Both successful synchronous projection materializations must be counted exactly once.",
  );

  let customerBoundaryTouched = false;
  await assert.rejects(
    () => getFreshStateProjection({
      ...request,
      access: {
        actorType: "CUSTOMER",
        officeId: "office-a",
        portalUserId: "portal-a",
        membershipId: "membership-a",
        companyId: "company-a",
        membershipRole: "ADMIN",
      } as never,
    }, {
      assertScopeOwnership: async () => {},
      findUnique: async () => { customerBoundaryTouched = true; return null; },
      upsert: async () => { customerBoundaryTouched = true; throw new Error("unexpected"); },
      build: async () => { customerBoundaryTouched = true; return build("unexpected"); },
      checkFreshness: async () => { customerBoundaryTouched = true; throw new Error("unexpected"); },
    } as never),
    /only to internal operators/,
  );
  assert.equal(customerBoundaryTouched, false, "Customer access reached projection state before rejection.");
}

async function compileConsistencyContract() {
  let readerAttempts = 0;
  let resolveAttempts = 0;
  const request = {
    scope: { type: "workspace", officeId: "office-a", workspaceId: "workspace-a" },
  } satisfies SupplyStateProjectionRequest;
  const consistent = await buildSupplyStateProjection(request, {
    assertScopeOwnership: async () => {},
    readersForScope: () => [{
      name: "changing_reader",
      read: async () => {
        readerAttempts += 1;
        const result = emptySupplyStateReaderResult();
        result.currentState = { attempt: readerAttempts };
        result.dependencies = [makeSupplyStateDependency({
          key: "workspace.identity:workspace-a",
          source: "APP_DB",
          entityType: "SupplyWorkspace",
          entityRef: "workspace-a",
          value: { attempt: readerAttempts },
          version: `v${readerAttempts}`,
          reason: "Workspace identity changed.",
        })];
        return result;
      },
    }],
    resolveDependencies: async (dependencies) => {
      resolveAttempts += 1;
      if (resolveAttempts === 1) {
        const declared = dependencies[0]!;
        throw new SupplyStateDependencyDriftError(
          declared.key,
          declared.version,
          "v2",
          declared.valueHash,
          hashSupplyStateValue({ attempt: 2 }),
        );
      }
      return dependencies;
    },
    now: () => new Date("2026-08-26T12:00:00.000Z"),
  });
  assert.equal(readerAttempts, 2, "A compile drift did not rerun the whole reader set exactly once.");
  assert.equal(resolveAttempts, 2);
  assert.deepEqual(consistent.payload.currentState, { attempt: 2 });
  assert.equal(consistent.dependencies[0]?.version, "v2");

  let firstReaderAttempts = 0;
  let secondReaderAttempts = 0;
  const duplicateRace = await buildSupplyStateProjection(request, {
    assertScopeOwnership: async () => {},
    readersForScope: () => [{
      name: "identity_reader_a",
      read: async () => {
        firstReaderAttempts += 1;
        const result = emptySupplyStateReaderResult();
        const version = firstReaderAttempts === 1 ? "v1" : "v2";
        result.currentState = { readerA: version };
        result.dependencies = [makeSupplyStateDependency({
          key: "workspace.identity:workspace-a",
          source: "APP_DB",
          entityType: "SupplyWorkspace",
          entityRef: "workspace-a",
          value: { version },
          version,
          policy: "STRICT",
          reason: "Workspace identity changed.",
        })];
        return result;
      },
    }, {
      name: "identity_reader_b",
      read: async () => {
        secondReaderAttempts += 1;
        const result = emptySupplyStateReaderResult();
        result.currentState = { readerB: "v2" };
        result.dependencies = [makeSupplyStateDependency({
          key: "workspace.identity:workspace-a",
          source: "APP_DB",
          entityType: "SupplyWorkspace",
          entityRef: "workspace-a",
          value: { version: "v2" },
          version: "v2",
          policy: "STRICT",
          reason: "Workspace identity changed.",
        })];
        return result;
      },
    }],
    resolveDependencies: async (dependencies) => dependencies,
  });
  assert.equal(firstReaderAttempts, 2, "Conflicting duplicate facts did not retry the whole reader set.");
  assert.equal(secondReaderAttempts, 2, "Every reader must be rerun after a duplicate-fact race.");
  assert.equal(duplicateRace.dependencies[0]?.version, "v2");
  assert.deepEqual(duplicateRace.payload.currentState, { readerA: "v2", readerB: "v2" });

  let repeatedReaderAttempts = 0;
  await assert.rejects(
    () => buildSupplyStateProjection(request, {
      assertScopeOwnership: async () => {},
      readersForScope: () => [{
        name: "always_changing_reader",
        read: async () => {
          repeatedReaderAttempts += 1;
          const result = emptySupplyStateReaderResult();
          result.dependencies = [dependency(`v${repeatedReaderAttempts}`)];
          return result;
        },
      }],
      resolveDependencies: async (dependencies) => {
        const declared = dependencies[0]!;
        throw new SupplyStateDependencyDriftError(
          declared.key,
          declared.version,
          "newer",
          declared.valueHash,
          "newer-hash",
        );
      },
    }),
    SupplyStateDependencyDriftError,
  );
  assert.equal(repeatedReaderAttempts, 2, "Persistent drift was retried more than once.");
}

async function ownershipGuardContract() {
  const linkedSupplierId = "11111111-1111-4111-8111-111111111111";
  const otherSupplierId = "22222222-2222-4222-8222-222222222222";
  const linkedVendorId = "33333333-3333-4333-8333-333333333333";
  const supplierScope = {
    type: "supplier" as const,
    officeId: "office-a",
    companyId: "company-a",
    supplierId: linkedSupplierId,
    orderId: "44444444-4444-4444-8444-444444444444",
    vendorId: linkedVendorId,
  };
  const supplierOwnershipDependencies = {
    findWorkspace: async () => null,
    findCompany: async () => ({ id: "company-a" }),
    findWorkflowAccount: async () => ({ id: "customer-a", officeId: "office-a", companyId: "company-a" }),
    resolveCustomerId: () => "customer-a",
  };
  await assert.doesNotReject(() => assertSupplyStateScopeOwnership(supplierScope, {
    ...supplierOwnershipDependencies,
    getRequest: async () => ({
      vendors: [{ id: linkedVendorId, supplierRegistryId: linkedSupplierId }],
    }),
  } as never));
  await assert.rejects(
    () => assertSupplyStateScopeOwnership(supplierScope, {
      ...supplierOwnershipDependencies,
      getRequest: async () => ({
        vendors: [{ id: linkedVendorId, supplierRegistryId: otherSupplierId, name: "Same Supplier Name" }],
      }),
    } as never),
    /not linked to its scoped canonical supplier/i,
  );
  await assert.rejects(
    () => assertSupplyStateScopeOwnership({
      type: "item",
      officeId: "office-a",
      companyId: "company-a",
      workspaceId: "workspace-b",
      itemKey: "item-a",
    }, {
      findWorkspace: async () => ({ id: "workspace-b", companyId: "company-b" }) as never,
      findCompany: async () => ({ id: "company-a" }) as never,
    } as never),
    SupplyStateScopeOwnershipError,
  );
  await assert.rejects(
    () => assertSupplyStateScopeOwnership({
      type: "procurement_request",
      officeId: "office-a",
      companyId: "company-a",
      customerId: "customer-a",
      orderId: "order-a",
    }, {
      findWorkspace: async () => null,
      findCompany: async () => ({ id: "company-a" }) as never,
      findWorkflowAccount: async () => ({ companyId: "company-b" }),
      resolveCustomerId: () => "customer-a",
    } as never),
    SupplyStateScopeOwnershipError,
  );
  await assert.rejects(
    () => assertSupplyStateScopeOwnership({
      type: "supplier",
      officeId: "office-a",
      companyId: "company-a",
      workspaceId: "workspace-a",
      orderId: "order-a",
      vendorId: "vendor-a",
    }, {
      findWorkspace: async () => ({ id: "workspace-a", companyId: "company-a" }),
      findCompany: async () => ({ id: "company-a" }) as never,
      findWorkflowAccount: async () => ({ companyId: "company-b" }),
      resolveCustomerId: () => "customer-a",
    } as never),
    SupplyStateScopeOwnershipError,
  );
  await assert.rejects(
    () => assertSupplyStateScopeOwnership({
      type: "item",
      officeId: "office-a",
      companyId: "company-a",
      workspaceId: "workspace-missing",
      itemKey: "item-a",
    }, {
      findWorkspace: async () => null,
      findCompany: async () => ({ id: "company-a" }) as never,
    } as never),
    /workspace does not belong to its office/i,
  );
  let canonicalItemWhere: unknown = null;
  await assert.rejects(
    () => assertSupplyStateScopeOwnership({
      type: "item",
      officeId: "office-a",
      companyId: "company-a",
      workspaceId: "workspace-a",
      itemId: "canonical-item-foreign",
    }, {
      findWorkspace: async () => ({ id: "workspace-a", companyId: "company-a" }),
      findCompany: async () => ({ id: "company-a" }) as never,
      findItem: async (args) => {
        canonicalItemWhere = args.where;
        return null;
      },
    } as never),
    /item does not belong to its office and company/i,
  );
  assert.deepEqual(canonicalItemWhere, {
    id: "canonical-item-foreign",
    officeId: "office-a",
    companyId: "company-a",
  });
  await assert.rejects(
    () => assertSupplyStateScopeOwnership({
      type: "company",
      officeId: "office-a",
      companyId: "company-foreign",
    }, {
      findWorkspace: async () => null,
      findCompany: async () => null,
    } as never),
    /company does not belong to its office/i,
  );
  let projectionLookupTouched = false;
  await assert.rejects(
    () => getFreshStateProjection({
      scope: {
        type: "company",
        officeId: "office-a",
        companyId: "company-a",
        workspaceId: "workspace-b",
      },
      projectionsEnabled: true,
    }, {
      assertScopeOwnership: async () => { throw new Error("scope ownership mismatch"); },
      findUnique: async () => { projectionLookupTouched = true; return null; },
      upsert: async () => { throw new Error("unexpected"); },
      build: async () => build("unexpected"),
      checkFreshness: async () => { throw new Error("unexpected"); },
    } as never),
    /scope ownership mismatch/,
  );
  assert.equal(projectionLookupTouched, false, "Projection cache was consulted before scope ownership validation.");
}

async function projectionStoreGuardContract() {
  let upsertTouched = false;
  const writeDependencies = {
    assertScopeOwnership: async () => {},
    upsert: async () => {
      upsertTouched = true;
      throw new Error("Projection upsert must not run for an invalid build.");
    },
  };
  await assert.rejects(
    () => storeSupplyStateProjection({ ...build("v1"), payloadHash: "0".repeat(64) }, writeDependencies as never),
    /payload hash does not match/i,
  );
  assert.equal(upsertTouched, false);
  await assert.rejects(
    () => storeSupplyStateProjection({ ...build("v1"), sourceFingerprint: "0".repeat(64) }, writeDependencies as never),
    /source fingerprint does not match/i,
  );
  assert.equal(upsertTouched, false);

  let ownershipUpsertTouched = false;
  await assert.rejects(
    () => storeSupplyStateProjection(build("v1"), {
      assertScopeOwnership: async () => { throw new Error("foreign projection scope"); },
      upsert: async () => {
        ownershipUpsertTouched = true;
        throw new Error("unexpected");
      },
    } as never),
    /foreign projection scope/i,
  );
  assert.equal(ownershipUpsertTouched, false);
}

async function invalidationContract() {
  const updates: Array<Record<string, unknown>> = [];
  const candidates = [
    {
      id: "request-linked",
      dependencyManifest: [{ key: "company.context_document:company-a:document-a" }],
    },
    {
      id: "request-unrelated",
      dependencyManifest: [{ key: "company.context_document:company-a:document-b" }],
    },
  ];
  const invalidated = await invalidateCompanyContextDocumentStateProjections({
    officeId: "office-a",
    companyId: "company-a",
    documentId: "document-a",
  }, {
    findMany: async () => candidates,
    updateMany: async (args: Record<string, unknown>) => {
      updates.push(args);
      const where = args.where as Record<string, unknown>;
      return { count: where.id ? 1 : 2 };
    },
    now: () => new Date("2026-08-26T12:00:00.000Z"),
  } as never);
  assert.equal(invalidated.count, 3);
  assert.equal(updates.length, 2);
  assert.deepEqual(
    (updates[1]!.where as { id: { in: string[] } }).id.in,
    ["request-linked"],
    "Document invalidation dirtied an unrelated procurement request.",
  );

  const snapshotUpdates: Array<Record<string, unknown>> = [];
  await invalidatePublishedSupplySnapshotStateProjections({
    officeId: "office-a",
    workspaceId: "workspace-a",
  }, {
    findMany: async () => [],
    updateMany: async (args: Record<string, unknown>) => {
      snapshotUpdates.push(args);
      return { count: 2 };
    },
    now: () => new Date("2026-08-26T12:00:00.000Z"),
  } as never);
  const snapshotWhere = snapshotUpdates[0]!.where as {
    projectionType: { in: string[] };
    scopeType: { in: string[] };
  };
  assert.deepEqual(snapshotWhere.projectionType.in, ["item_supply_v1", "workspace_supply_v1"]);
  assert.deepEqual(snapshotWhere.scopeType.in, ["item", "workspace"]);

  const routedUpdates: Array<Record<string, unknown>> = [];
  const routed = await invalidateRoutedEmailThreadStateProjections({
    officeId: "office-a",
    companyId: "company-a",
    threadId: "thread-a",
  }, {
    findThreadMessages: async () => [{
      id: "message-a",
      externalId: "provider-a",
      gmailMessageId: null,
      rfcMessageId: null,
    }],
    findMany: async () => [
      {
        id: "request-linked",
        dependencyManifest: [{
          key: "procurement.vendor_latest_message:customer:order:vendor-a",
          evidenceRefs: [{ kind: "procurement_message", id: "message-a" }],
        }],
      },
      {
        id: "supplier-linked-by-thread",
        dependencyManifest: [{ key: "email.thread:thread-a", evidenceRefs: [] }],
      },
      {
        id: "request-unrelated",
        dependencyManifest: [{
          key: "procurement.vendor_latest_message:customer:order:vendor-b",
          evidenceRefs: [{ kind: "procurement_message", id: "message-b" }],
        }],
      },
    ],
    updateMany: async (args: Record<string, unknown>) => {
      routedUpdates.push(args);
      return { count: 2 };
    },
    now: () => new Date("2026-08-26T12:00:00.000Z"),
  } as never);
  assert.equal(routed.count, 2);
  assert.deepEqual(
    ((routedUpdates[0]!.where as { id: { in: string[] } }).id.in),
    ["request-linked", "supplier-linked-by-thread"],
    "Routed email invalidation dirtied an unrelated supplier or request projection.",
  );
}

function boundedFreshnessHeadContract() {
  const companyHead = {
    ...dependency("company-v1"),
    key: "company.identity:company-a",
    policy: "STRICT" as const,
  };
  const orderHead = {
    ...dependency("order-v1"),
    key: "procurement.order:customer-a:order-a",
  };
  const contextHead = {
    ...dependency("context-v1"),
    key: "procurement.order_request_context:customer-a:order-a",
  };
  const immutableDetails = Array.from({ length: 100 }, (_, index) => ({
    ...dependency(`detail-${index}`),
    key: `company.context_document:company-a:document-${index}`,
  }));
  assert.deepEqual(
    projectionFreshnessHeadDependencies([companyHead, orderHead, contextHead, ...immutableDetails])
      .map((entry) => entry.key),
    [companyHead.key, orderHead.key, contextHead.key],
    "Projection freshness reread immutable detail facts instead of bounded semantic heads.",
  );
}

async function workerContract() {
  const parsed = parseSupplyStateProjectionJobPayload("office-a", {
    scope,
    compilerVersion: "supply-world-state-v1.2",
  });
  assert.equal(supplyStateScopeRef(parsed.scope), supplyStateScopeRef(scope));
  assert.throws(
    () => parseSupplyStateProjectionJobPayload("office-b", {
      scope,
      compilerVersion: "supply-world-state-v1.2",
    }),
    /office does not match/,
  );
  assert.equal(
    supplyStateProjectionJobDedupeKey({ scope }),
    "state-projection:office-a:company_context_v1:company:company=company-a;workspace=workspace-a:supply-world-state-v1.2",
  );
  const previousRuntime = process.env.SUPPLY_STATE_RUNTIME_ENABLED;
  const previousProjections = process.env.SUPPLY_STATE_PROJECTIONS_ENABLED;
  process.env.SUPPLY_STATE_RUNTIME_ENABLED = "false";
  process.env.SUPPLY_STATE_PROJECTIONS_ENABLED = "true";
  try {
    assert.equal(
      await enqueueSupplyStateProjectionRebuildIfEnabled({ scope }),
      null,
      "Disabled runtime rollout queued a projection job.",
    );
    assert.deepEqual(
      await runSupplyStateProjectionRebuildJob({ officeId: "office-a", payload: { invalid: true } }),
      { skipped: true, reason: "runtime_disabled" },
      "A queued rebuild ignored the disabled runtime flag.",
    );
    process.env.SUPPLY_STATE_RUNTIME_ENABLED = "true";
    process.env.SUPPLY_STATE_PROJECTIONS_ENABLED = "false";
    assert.deepEqual(
      await runSupplyStateProjectionRebuildJob({ officeId: "office-a", payload: { invalid: true } }),
      { skipped: true, reason: "projections_disabled" },
      "A queued rebuild ignored the disabled projection flag.",
    );
  } finally {
    if (previousRuntime == null) delete process.env.SUPPLY_STATE_RUNTIME_ENABLED;
    else process.env.SUPPLY_STATE_RUNTIME_ENABLED = previousRuntime;
    if (previousProjections == null) delete process.env.SUPPLY_STATE_PROJECTIONS_ENABLED;
    else process.env.SUPPLY_STATE_PROJECTIONS_ENABLED = previousProjections;
  }
}

async function main() {
  await projectionCacheContract();
  await compileConsistencyContract();
  await ownershipGuardContract();
  await projectionStoreGuardContract();
  await invalidationContract();
  boundedFreshnessHeadContract();
  await workerContract();
  console.log(JSON.stringify({
    ok: true,
    cases: [
      "projection build and hit",
      "relevant and unrelated freshness",
      "live fallback",
      "internal-only access",
      "precise invalidation",
      "tenant-safe worker payload",
      "whole-compile drift retry",
      "scope ownership before cache lookup",
      "projection write hash and ownership guards",
      "queued worker rollout flags",
    ],
  }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
