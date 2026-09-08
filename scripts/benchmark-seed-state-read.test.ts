import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  procurementConversationFromLedgerMessages,
  type ProcurementLedgerConversationMessage,
} from "../src/lib/procurement-conversation-model";
import {
  benchmarkConversationMessageId,
  benchmarkScenarioContext,
  generateBenchmarkCorpus,
} from "../src/lib/supply-os/benchmark/generate";
import { COMMERCIAL_STATE_BENCHMARK_SCENARIOS } from "../src/lib/supply-os/benchmark/scenarios";
import {
  buildBenchmarkConcurrencyStateRead,
  readBenchmarkConcurrencyDependency,
} from "../src/lib/supply-os/benchmark/seed";
import { createSupplyStateFactRegistry, readSupplyStateDependency } from "../src/lib/supply-os/state-runtime/fact-registry";
import { validateSupplyStateRead } from "../src/lib/supply-os/state-runtime/validate";
import { supplyStateScopeRef, supplyStateWorkspaceId, type SupplyWorldStatePacket } from "../src/lib/supply-os/state-runtime/types";

// The seed CLI does not run with react-server conditions and must never load
// the product's database singleton before isolated benchmark bootstrapping.
const plainSeedImport = execFileSync(process.execPath, [
  "--import", "tsx", "--eval",
  `require('./src/lib/supply-os/benchmark/seed.ts');
   if (Object.keys(require.cache).some(path => path.endsWith(require('node:path').join('src', 'lib', 'prisma.ts')))) throw new Error('Product DB imported by seed');
   console.log('isolated seed import passed');`,
], { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } });
assert.match(plainSeedImport, /isolated seed import passed/);

async function main() {
  const profile = "graph-small";
  const corpus = generateBenchmarkCorpus(profile);
  const scenario = COMMERCIAL_STATE_BENCHMARK_SCENARIOS.find((entry) => entry.id === "shared-mailbox-ambiguous-cross-office")!;
  const context = benchmarkScenarioContext(profile, scenario);
  const freshCase = corpus.cases.find((entry) => entry.metadata.scenarioId === scenario.id
    && entry.metadata.actionConcurrency?.expectedValid === true)!;
  const staleCase = corpus.cases.find((entry) => entry.metadata.scenarioId === scenario.id
    && entry.metadata.actionConcurrency?.expectedValid === false)!;
  assert(freshCase && staleCase);
  const key = freshCase.metadata.actionConcurrency!.baselineDependencyKey;
  const base = {
    provider: "GMAIL", accountEmail: "buyer@example.test", providerThreadId: null,
    rfcMessageId: null, fromName: null, ccEmails: [], bodyTruncated: false,
  };
  const message = (input: Partial<ProcurementLedgerConversationMessage> & {
    providerMessageId: string;
    direction: "INBOUND" | "OUTBOUND";
    fromEmail: string;
    toEmails: string[];
    bodyText: string;
    sentAt: string;
  }): ProcurementLedgerConversationMessage => ({
    ...base, subject: "RFQ", ...input,
    id: benchmarkConversationMessageId({ ...context, ...base, providerMessageId: input.providerMessageId }),
  });
  const question = message({
    providerMessageId: "question", direction: "INBOUND", fromEmail: "supplier@example.test",
    toEmails: [base.accountEmail], bodyText: "Please send the drawings.", sentAt: "2026-09-08T10:00:00.000Z",
  });
  const answer = message({
    providerMessageId: "answer", direction: "OUTBOUND", fromEmail: base.accountEmail,
    toEmails: [question.fromEmail], bodyText: "The drawings are attached.", sentAt: "2026-09-08T10:02:00.000Z",
  });
  const notice = message({
    ...question, providerMessageId: "notice", subject: "Automatic reply: out of office",
    bodyText: "I am out of office and will return on Monday.", sentAt: "2026-09-08T10:03:00.000Z",
  });
  let messages = [question];
  const registry = createSupplyStateFactRegistry({
    appDb: {} as never,
    resolveWorkflowOffice: () => context.officeId,
    getProcurementRequest: async (customerId, orderId) => {
      assert.equal(customerId, context.customerId);
      assert.equal(orderId, context.orderId);
      return { id: context.orderId, vendors: [{ id: context.vendorId }] } as never;
    },
    getProcurementConversation: async (args) => {
      assert.deepEqual(args, {
        officeId: context.officeId, customerId: context.customerId,
        orderId: context.orderId, vendorId: context.vendorId,
      });
      return procurementConversationFromLedgerMessages(messages);
    },
  });
  const clients = {
    dashboard: {
      async $queryRawUnsafe(query: string, ...values: unknown[]) {
        assert.match(query, /FROM public\.procurement_communication_messages/);
        assert.match(query, /LIMIT 100/);
        assert.deepEqual(values, [context.customerId, context.orderId, context.vendorId]);
        return [...messages].reverse().map((entry) => ({ ...entry, sentAt: new Date(entry.sentAt) }));
      },
    },
  } as never;
  const validate = (packet: SupplyWorldStatePacket) => validateSupplyStateRead({
    officeId: context.officeId, stateReadId: "test-read",
  }, {
    database: {
      supplyStateRead: {
        findFirst: async () => ({
          officeId: context.officeId,
          workspaceId: supplyStateWorkspaceId(packet.scope),
          scopeType: packet.scope.type,
          scopeRef: supplyStateScopeRef(packet.scope),
          objective: packet.objective,
          compilerVersion: packet.compilerVersion,
          dependencyManifest: packet.dependencies,
          evidenceRefs: packet.evidenceRefs,
          sourceFingerprint: packet.sourceFingerprint,
          packetHash: packet.packetHash,
          packet,
        }),
      },
    } as never,
    registry,
    assertScopeOwnership: async () => {},
  });
  for (const transcript of [[question], [question, notice], [question, answer], [question, answer, notice], [notice]]) {
    messages = transcript;
    const seeded = await readBenchmarkConcurrencyDependency(clients, profile, freshCase);
    const current = await readSupplyStateDependency({ registry, key, context: { officeId: context.officeId } });
    assert.equal(seeded.valueHash, current.valueHash, "Seed controls must use the registry's exact current-message and anchor shape.");
    assert.equal(seeded.version, current.version);
    assert.deepEqual(seeded.evidenceRefs, current.evidenceRefs);
    const fresh = await validate(buildBenchmarkConcurrencyStateRead(freshCase, seeded));
    assert.equal(fresh.valid, true, "A freshly seeded matching control must not produce a false conflict.");
    const stale = await validate(buildBenchmarkConcurrencyStateRead(staleCase, seeded));
    assert.equal(stale.valid, false, "The intentional stale fixture must still fail semantic validation.");
    assert.deepEqual(stale.changedStrict.map((change) => change.key), [key]);
  }
  messages = [question, answer, notice];
  const anchored = buildBenchmarkConcurrencyStateRead(freshCase,
    await readBenchmarkConcurrencyDependency(clients, profile, freshCase));
  messages = [{ ...question, bodyText: "Please use the revised specification." }, answer, notice];
  assert.equal((await validate(anchored)).valid, false, "Changing a prior inbound anchor invalidates a CHASE control.");
  messages = [{ ...question, fromEmail: "replacement@example.test" }, answer, notice];
  assert.equal((await validate(anchored)).valid, false, "Changing the prior inbound recipient invalidates a CHASE control.");
  console.log("Benchmark seed state-read checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
