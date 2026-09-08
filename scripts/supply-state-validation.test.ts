import assert from "node:assert/strict";
import {
  canonicalizeSupplyStateValue,
  hashSupplyStateDependencies,
  hashSupplyStateValue,
  hashSupplyWorldStatePacket,
} from "../src/lib/supply-os/state-runtime/canonicalize";
import {
  createSupplyStateFactRegistry,
  readSupplyStateDependency,
  SupplyStateFactRegistry,
  type SupplyStateFactRegistryEntry,
} from "../src/lib/supply-os/state-runtime/fact-registry";
import { validateSupplyStateAssertionForAction } from "../src/lib/supply-os/state-runtime/enforcement";
import {
  supplyStateScopeRef,
  type SupplyStateDependency,
  type SupplyWorldStatePacket,
} from "../src/lib/supply-os/state-runtime/types";
import {
  validateSupplyStateRead,
  SupplyStateValidationError,
} from "../src/lib/supply-os/state-runtime/validate";
import {
  getSupplyStateMetricSummaries,
  incrementSupplyStateMetric,
  resetSupplyStateInstrumentationForTests,
} from "../src/lib/supply-os/state-runtime/instrumentation";

type FactState = {
  exists: boolean;
  version: string | null;
  value: unknown;
  entityRef?: string;
  unavailable?: boolean;
};

const facts = new Map<string, FactState>();
const readCounts = new Map<string, number>();

const entry: SupplyStateFactRegistryEntry = {
  prefix: "test.fact:",
  source: "APP_DB",
  defaultPolicy: "STRICT",
  canonicalize: canonicalizeSupplyStateValue,
  hash: hashSupplyStateValue,
  evidence: (current) => current.evidenceRefs ?? [],
  readCurrent: async (context, key, suffix) => {
    assert.equal(context.officeId, "office-1");
    readCounts.set(key, (readCounts.get(key) ?? 0) + 1);
    const state = facts.get(key);
    if (!state || state.unavailable) throw new Error("test source unavailable");
    return {
      exists: state.exists,
      entityType: "TestFact",
      entityRef: state.entityRef ?? suffix,
      value: state.value,
      version: state.version,
      evidenceRefs: state.exists ? [{ kind: "knowledge_object", id: suffix }] : [],
    };
  },
};

const advisoryEntry: SupplyStateFactRegistryEntry = {
  ...entry,
  prefix: "test.context:",
  defaultPolicy: "ADVISORY",
};

const registry = new SupplyStateFactRegistry([entry, advisoryEntry]);

function manifestDependency(
  key: string,
  state: FactState,
  policy: SupplyStateDependency["policy"] = "STRICT",
): SupplyStateDependency {
  const entityRef = key.slice(key.indexOf(":") + 1);
  return {
    key,
    source: "APP_DB",
    entityType: "TestFact",
    entityRef,
    version: state.version ?? hashSupplyStateValue(state.value),
    valueHash: hashSupplyStateValue(state.value),
    policy,
    reason: `The semantic value of ${key} must remain current.`,
    evidenceRefs: [{ kind: "knowledge_object", id: entityRef }],
  };
}

function databaseFor(
  manifest: SupplyStateDependency[],
  options: { officeId?: string; storedManifest?: SupplyStateDependency[] } = {},
) {
  const scope = {
    type: "procurement_request" as const,
    officeId: "office-1",
    companyId: "company-1",
    customerId: "customer-1",
    orderId: "order-1",
    workspaceId: "workspace-1",
  };
  const packet: SupplyWorldStatePacket = {
    schemaVersion: 1,
    compilerVersion: "supply-state-v1-test",
    scope,
    objective: "Validate a supplier action.",
    compiledAt: "2026-08-26T12:00:00.000Z",
    currentState: {},
    derivedState: {},
    openLoops: [],
    uncertainties: [],
    evidenceRefs: manifest.flatMap((dependency) => dependency.evidenceRefs),
    dependencies: manifest,
    sourceFingerprint: hashSupplyStateDependencies(manifest),
    packetHash: "0".repeat(64),
    diagnostics: { projectionHit: false, sourceCounts: {}, timingsMs: {} },
  };
  packet.packetHash = hashSupplyWorldStatePacket(packet);
  return {
    supplyStateRead: {
      findFirst: async (args: { where: { id: string; officeId: string } }) => {
        if (args.where.id !== "state-read-1" || args.where.officeId !== (options.officeId ?? "office-1")) {
          return null;
        }
        return {
          officeId: "office-1",
          dependencyManifest: options.storedManifest ?? manifest,
          evidenceRefs: packet.evidenceRefs,
          packet,
          workspaceId: "workspace-1",
          scopeType: "procurement_request",
          scopeRef: supplyStateScopeRef(scope),
          objective: packet.objective,
          compilerVersion: "supply-state-v1-test",
          sourceFingerprint: packet.sourceFingerprint,
          packetHash: packet.packetHash,
        };
      },
    },
  };
}

async function validate(manifest: SupplyStateDependency[]) {
  return validateSupplyStateRead(
    { officeId: "office-1", stateReadId: "state-read-1" },
    {
      database: databaseFor(manifest) as never,
      registry,
      assertScopeOwnership: async () => {},
      now: () => new Date("2026-08-26T12:05:00.000Z"),
    },
  );
}

async function canonicalCompanySemanticValidation() {
  let company = {
    id: "company-1",
    name: "Canonical Company",
    status: "IN_PROGRESS",
    crmNotes: "Original note",
    updatedAt: new Date("2026-08-26T12:00:00.000Z"),
  };
  const companyRegistry = createSupplyStateFactRegistry({
    appDb: {
      company: {
        findFirst: async (args: {
          where: Record<string, unknown>;
          select: Record<string, boolean>;
        }) => {
          assert.deepEqual(args.where, { id: "company-1", officeId: "office-1" });
          assert.deepEqual(args.select, { id: true, name: true, status: true });
          return company;
        },
      },
    } as never,
  });
  const original = await readSupplyStateDependency({
    registry: companyRegistry,
    key: "company.identity:company-1",
    context: { officeId: "office-1" },
  });
  assert.equal(original.policy, "STRICT");

  const validateCompany = () => validateSupplyStateRead(
    { officeId: "office-1", stateReadId: "state-read-1" },
    {
      database: databaseFor([original]) as never,
      registry: companyRegistry,
      assertScopeOwnership: async () => {},
      now: () => new Date("2026-08-26T12:05:00.000Z"),
    },
  );

  company = {
    ...company,
    crmNotes: "Changed note that is outside the strict semantic selector",
    updatedAt: new Date("2026-08-26T12:04:00.000Z"),
  };
  const unrelatedChange = await validateCompany();
  assert.equal(unrelatedChange.valid, true);
  assert.deepEqual(unrelatedChange.changedStrict, []);

  company = { ...company, status: "WORKED" };
  const statusChange = await validateCompany();
  assert.equal(statusChange.valid, false);
  assert.deepEqual(statusChange.changedStrict.map((change) => change.key), ["company.identity:company-1"]);

  company = { ...company, status: "IN_PROGRESS", name: "Renamed Canonical Company" };
  const identityChange = await validateCompany();
  assert.equal(identityChange.valid, false);
  assert.deepEqual(identityChange.changedStrict.map((change) => change.key), ["company.identity:company-1"]);
}

async function main() {
  resetSupplyStateInstrumentationForTests();
  await canonicalCompanySemanticValidation();
  const assertionMismatch = () => { throw new Error("Synthetic action binding mismatch."); };
  const offAssertion = validateSupplyStateAssertionForAction({
    officeId: "office-1",
    action: "test.action_binding",
    assertion: assertionMismatch,
    environment: {
      SUPPLY_STATE_RUNTIME_ENABLED: "true",
      SUPPLY_STATE_VALIDATION_MODE: "off",
    },
  });
  assert.equal(offAssertion.valid, false);
  assert.equal(offAssertion.blocked, false, "Off mode must never block an action assertion mismatch.");
  const shadowAssertion = validateSupplyStateAssertionForAction({
    officeId: "office-1",
    action: "test.action_binding",
    assertion: assertionMismatch,
    environment: {
      SUPPLY_STATE_RUNTIME_ENABLED: "true",
      SUPPLY_STATE_VALIDATION_MODE: "shadow",
    },
  });
  assert.equal(shadowAssertion.valid, false);
  assert.equal(shadowAssertion.blocked, false, "Shadow mode must observe but never block an action assertion mismatch.");
  const enforcedAssertion = validateSupplyStateAssertionForAction({
    officeId: "office-1",
    action: "test.action_binding",
    assertion: assertionMismatch,
    environment: {
      SUPPLY_STATE_RUNTIME_ENABLED: "true",
      SUPPLY_STATE_VALIDATION_MODE: "enforce",
    },
  });
  assert.equal(enforcedAssertion.valid, false);
  assert.equal(enforcedAssertion.blocked, true, "Enforce mode must block an action assertion mismatch.");
  assert.match(enforcedAssertion.error?.message ?? "", /synthetic action binding mismatch/i);
  const disabledAssertion = validateSupplyStateAssertionForAction({
    officeId: "office-1",
    action: "test.action_binding",
    assertion: assertionMismatch,
    environment: {
      SUPPLY_STATE_RUNTIME_ENABLED: "false",
      SUPPLY_STATE_VALIDATION_MODE: "enforce",
    },
  });
  assert.equal(disabledAssertion.blocked, false, "A disabled runtime must not enforce an action assertion mismatch.");
  const vendorKey = "test.fact:vendor-1";
  const otherSupplierKey = "test.fact:vendor-2";
  const advisoryKey = "test.context:workspace-1";
  const original: FactState = {
    exists: true,
    version: "vendor-v1",
    value: { recipient: "supplier@example.com", quoteRecorded: false },
  };
  facts.set(vendorKey, original);
  facts.set(otherSupplierKey, {
    exists: true,
    version: "other-v1",
    value: { recipient: "other@example.com", quoteRecorded: false },
  });
  facts.set(advisoryKey, original);
  const strictDependency = manifestDependency(vendorKey, original);

  readCounts.clear();
  facts.set(otherSupplierKey, {
    exists: true,
    version: "other-v2",
    value: { recipient: "new-other@example.com", quoteRecorded: true },
  });
  const valid = await validate([strictDependency]);
  assert.deepEqual(valid, {
    valid: true,
    checkedAt: "2026-08-26T12:05:00.000Z",
    changedStrict: [],
    changedAdvisory: [],
  });
  assert.equal(readCounts.get(vendorKey), 1);
  assert.equal(readCounts.has(otherSupplierKey), false, "unrelated dependencies must not be read");
  incrementSupplyStateMetric("false_conflict_test_count", { benchmark: true });
  assert.equal(
    getSupplyStateMetricSummaries().find((metric) => metric.name === "false_conflict_test_count")?.sum,
    1,
  );

  facts.set(vendorKey, {
    exists: true,
    version: "vendor-v2",
    value: { recipient: "supplier@example.com", quoteRecorded: true },
  });
  const strictChanged = await validate([strictDependency]);
  assert.equal(strictChanged.valid, false);
  assert.equal(strictChanged.changedStrict.length, 1);
  assert.equal(strictChanged.changedStrict[0]?.key, vendorKey);
  assert.equal(strictChanged.changedStrict[0]?.oldVersion, "vendor-v1");
  assert.equal(strictChanged.changedStrict[0]?.newVersion, "vendor-v2");

  const advisoryDependency = manifestDependency(advisoryKey, original, "ADVISORY");
  facts.set(advisoryKey, {
    exists: true,
    version: "context-v2",
    value: { recipient: "supplier@example.com", quoteRecorded: true },
  });
  const advisoryChanged = await validate([advisoryDependency]);
  assert.equal(advisoryChanged.valid, true);
  assert.equal(advisoryChanged.changedStrict.length, 0);
  assert.equal(advisoryChanged.changedAdvisory.length, 1);

  facts.set(vendorKey, { ...original, entityRef: "vendor-rebound" });
  const identityChanged = await validate([strictDependency]);
  assert.equal(identityChanged.valid, false);
  assert.equal(identityChanged.changedStrict[0]?.newHash, hashSupplyStateValue(original.value));

  const ownershipChanged = await validateSupplyStateRead(
    { officeId: "office-1", stateReadId: "state-read-1" },
    {
      database: databaseFor([strictDependency]) as never,
      registry,
      assertScopeOwnership: async () => {
        throw new Error("workspace ownership changed");
      },
      now: () => new Date("2026-08-26T12:05:00.000Z"),
    },
  );
  assert.equal(ownershipChanged.valid, false);
  assert.equal(ownershipChanged.changedStrict[0]?.key.startsWith("scope.ownership:"), true);
  assert.equal(ownershipChanged.changedStrict[0]?.newVersion, "UNAVAILABLE");

  facts.set(vendorKey, { exists: false, version: null, value: null });
  const missing = await validate([strictDependency]);
  assert.equal(missing.valid, false);
  assert.equal(missing.changedStrict[0]?.newVersion, "MISSING");
  assert.equal(missing.changedStrict[0]?.newHash, hashSupplyStateValue({ missing: vendorKey }));

  facts.set(vendorKey, { exists: false, version: null, value: null, unavailable: true });
  const unavailable = await validate([strictDependency]);
  assert.equal(unavailable.valid, false);
  assert.equal(unavailable.changedStrict[0]?.newVersion, "UNAVAILABLE");
  assert.equal(unavailable.changedStrict[0]?.newHash, hashSupplyStateValue({ unavailable: vendorKey }));

  facts.set(vendorKey, original);
  const duplicateManifest = [strictDependency, { ...strictDependency }];
  await assert.rejects(
    () => validateSupplyStateRead(
      { officeId: "office-1", stateReadId: "state-read-1" },
      { database: databaseFor(duplicateManifest) as never, registry },
    ),
    (error: unknown) => error instanceof SupplyStateValidationError && error.code === "invalid_manifest",
  );
  readCounts.clear();
  const consistentlyDowngradedManifest = [{ ...strictDependency, policy: "ADVISORY" as const }];
  await assert.rejects(
    () => validateSupplyStateRead(
      { officeId: "office-1", stateReadId: "state-read-1" },
      { database: databaseFor(consistentlyDowngradedManifest) as never, registry },
    ),
    (error: unknown) => error instanceof SupplyStateValidationError && error.code === "invalid_manifest",
  );
  assert.equal(
    readCounts.size,
    0,
    "A consistently downgraded registry-STRICT manifest reached fact validation.",
  );
  readCounts.clear();
  const downgradedStoredManifest = [{ ...strictDependency, policy: "ADVISORY" as const }];
  await assert.rejects(
    () => validateSupplyStateRead(
      { officeId: "office-1", stateReadId: "state-read-1" },
      {
        database: databaseFor([strictDependency], { storedManifest: downgradedStoredManifest }) as never,
        registry,
      },
    ),
    (error: unknown) => error instanceof SupplyStateValidationError && error.code === "invalid_manifest",
  );
  assert.equal(
    readCounts.size,
    0,
    "A policy-downgraded stored manifest reached fact validation instead of failing closed.",
  );
  await assert.rejects(
    () => validateSupplyStateRead(
      { officeId: "office-2", stateReadId: "state-read-1" },
      { database: databaseFor([strictDependency]) as never, registry },
    ),
    (error: unknown) => error instanceof SupplyStateValidationError && error.code === "not_found",
  );

  console.log("Supply state semantic validation contract passed.");
}

void main();
