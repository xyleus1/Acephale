import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { performance } from "node:perf_hooks";
import { PrismaClient } from "@prisma/client";
import { hash } from "../src/lib/goalspec/canonical";
import type { Invocation } from "../src/lib/goalspec/contracts/generated";
import { DeryaReadExecutor, authorizeDeryaRead, auditedDeryaConnection, DERYA_READ_TOOLS, type DeryaReadTool } from "../src/lib/goalspec-adapters/derya-read-executor";
import { deryaProjection } from "../src/lib/goalspec-adapters/derya-projections";
import { captureEpochSnapshot, epochsEqual, DERYA_EPOCH_CONTRACT_HASH, DERYA_EPOCH_TABLES, type EpochReuseReceipt } from "../src/lib/goalspec-adapters/derya-epochs";

// No provider, credential discovery, external DB, synthetic sleeps, repository
// updates or post-result tuning. Run only in an otherwise idle local process.
const output = resolve(process.argv[2] ?? "");
if (!process.argv[2] || existsSync(output)) throw new Error("New output directory required");
const ownerUrl = process.env.GOALSPEC_TEST_DATABASE_URL, readerUrl = process.env.GOALSPEC_EPOCH_TEST_DATABASE_URL;
for (const url of [ownerUrl, readerUrl]) if (!url || new URL(url).hostname !== "127.0.0.1" || new URL(url).pathname !== "/goalspec_derya_v5_test") throw new Error("Dedicated goalspec_derya_v5_test loopback database required");
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const sources = ["scripts/goalspec-derya-v5-profile.ts", "scripts/goalspec-derya-v5-database.test.ts", "scripts/goalspec-derya-v5.test.ts", "src/lib/goalspec-adapters/derya-read-executor.ts", "src/lib/goalspec-adapters/derya-projections.ts", "src/lib/goalspec-adapters/derya-epochs.ts", "src/lib/goalspec/scheduler.ts", "src/lib/goalspec/canonical.ts", "src/lib/document-readiness.ts", "src/lib/inquiry-status.ts", "prisma/schema.prisma", "package-lock.json", "prisma/migrations/20260916180000_goalspec_read_epochs/migration.sql"].map(path => ({ path, sha256: sha(readFileSync(path)) }));
mkdirSync(output);
const save = (name: string, value: unknown) => writeFileSync(resolve(output, name), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
const stamp = hash({ output: relative(process.cwd(), output), version: "derya-real-read-profile-v5.1" }).slice(0, 14);
save("plan.json", { version: "derya-real-read-profile-v5.1", scenarioCount: 100, repetitions: 10, writerRepetitions: 3,
  sourceFiles: sources, isolatedMachineRequested: true, syntheticFixtures: true, noArtificialDelay: true,
  gate: "Per-tool validation p95 < full reread p95, all-nine-table maximum writer p95 overhead <= 5%; correctness required.",
  limitations: "Synthetic independent fixture scenarios, repeated timings are not independent tasks. No API or end-to-end task-success claim. Writer probe is a single-column UPDATE, not production workload certification." });
let sql = 0;
const db = auditedDeryaConnection(readerUrl!, () => { sql++; });
const writer = new PrismaClient({ datasources: { db: { url: ownerUrl } } });
const signal = new AbortController().signal;
type Fixture = { id: string; tool: DeryaReadTool; invocation: Invocation; principal: { id: string; officeId: string; accessKind: string }; ids: Record<string, string> };
type Sample = { scenario: string; tool: string; mode: string; repetition: number; latencyMs: number; clientSqlStatements?: number };
const fixtures: Fixture[] = [], samples: Sample[] = [], writerSamples: Sample[] = [];
const p = (values: number[], quantile: number) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * quantile) - 1)];
const statistics = (values: Sample[]) => ({ samples: values.length, scenarios: new Set(values.map(v => v.scenario)).size,
  p50Ms: p(values.map(v => v.latencyMs), .5), p95Ms: p(values.map(v => v.latencyMs), .95),
  meanClientSqlStatements: values[0]?.clientSqlStatements === undefined ? null : values.reduce((n, v) => n + v.clientSqlStatements!, 0) / values.length });
async function measure(f: Fixture, mode: string, repetition: number, fn: () => Promise<unknown>) {
  const startSql = sql, start = performance.now(); await fn();
  const sample = { scenario: f.id, tool: f.tool, mode, repetition, latencyMs: performance.now() - start, clientSqlStatements: sql - startSql };
  samples.push(sample); appendFileSync(resolve(output, "read-samples.jsonl"), `${JSON.stringify(sample)}\n`);
}
async function capture() {
  return db.$transaction(async tx => { await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY"); return captureEpochSnapshot(tx); }, { isolationLevel: "RepeatableRead" });
}
const fields: Record<string, string> = { User: "fullName", Job: "reference", Company: "name", Inquiry: "subject", CarrierQuote: "service", EmailThread: "subject", EmailMessage: "bodyText", JobMilestone: "note", JobDocument: "aiSummary" };
async function setTriggers(enabled: boolean) {
  for (const table of DERYA_EPOCH_TABLES) await writer.$executeRawUnsafe(`ALTER TABLE public."${table}" ${enabled ? "ENABLE ALWAYS" : "DISABLE"} TRIGGER goalspec_read_epoch_v1`);
}
async function main() {
  assert(await capture(), "Epoch coverage and least-privilege role required");
  // Every scenario has a separate office, user and entity graph. Cardinality and
  // values vary; no hidden outcomes or live company records are used.
  for (let index = 0; index < 100; index++) {
    const id = `${stamp}-${String(index).padStart(3, "0")}`;
    const office = await writer.office.create({ data: { name: `V5 profile ${id}` } });
    const user = await writer.user.create({ data: { officeId: office.id, email: `${id}@example.test`, passwordHash: "synthetic-unused", fullName: "Profile operator", canViewWholeOffice: true } });
    const company = await writer.company.create({ data: { officeId: office.id, name: `Fixture company ${index}` } });
    const inquiry = await writer.inquiry.create({ data: { officeId: office.id, subject: `Synthetic freight request ${index}`, type: index % 2 ? "FORWARDING" : "SOURCING", origin: "Los Angeles", destination: "Chicago", receivedAt: new Date("2026-09-01") } });
    const job = await writer.job.create({ data: { officeId: office.id, inquiryId: inquiry.id, companyId: company.id, type: inquiry.type, reference: `V5-${index}`, origin: "Los Angeles", destination: "Chicago", commodity: "Synthetic packaged goods" } });
    const quote = await writer.carrierQuote.create({ data: { inquiryId: inquiry.id, carrier: `Fixture carrier ${index}`, total40: 100 + index } });
    const thread = await writer.emailThread.create({ data: { officeId: office.id, inquiryId: inquiry.id, subject: "Synthetic quote", participants: "[]", supplierOffer: JSON.stringify({ supplierName: `Fixture supplier ${index}`, pricePerUnit: 20 + index }) } });
    const message = await writer.emailMessage.create({ data: { officeId: office.id, threadId: thread.id, direction: "INBOUND", fromEmail: "fixture@example.test", toEmails: "[]", bodyText: "Synthetic offer for the requested goods." } });
    const milestone = await writer.jobMilestone.create({ data: { jobId: job.id, type: "ETA", plannedAt: new Date("2026-10-01") } });
    const document = await writer.jobDocument.create({ data: { officeId: office.id, jobId: job.id, name: "Synthetic invoice", docType: "INVOICE", status: "UPLOADED" } });
    for (let variant = 0; variant < index % 7; variant++) {
      await writer.job.create({ data: { officeId: office.id, companyId: company.id, reference: `V5-${index}-${variant}`, commodity: `Fixture package ${variant}` } });
      await writer.jobDocument.create({ data: { officeId: office.id, jobId: job.id, name: `Synthetic document ${variant}`, docType: "OTHER" } });
    }
    const tool = DERYA_READ_TOOLS[index % 5];
    const fixture: Fixture = { id, tool, principal: { id: user.id, officeId: office.id, accessKind: "operator" },
      invocation: { tool, arguments: tool === "get_job" ? { job_id: job.id } : {}, scope: { tenantId: office.id, principalId: user.id,
        authorizationVersion: hash({ id: user.id, officeId: user.officeId, role: user.role, canViewWholeOffice: user.canViewWholeOffice }), environmentVersion: "derya-profile-v5.1", toolSchemaHash: "audited-five-v5.1" } },
      ids: { User: user.id, Job: job.id, Company: company.id, Inquiry: inquiry.id, CarrierQuote: quote.id, EmailThread: thread.id, EmailMessage: message.id, JobMilestone: milestone.id, JobDocument: document.id } };
    fixtures.push(fixture); appendFileSync(resolve(output, "fixtures.jsonl"), `${JSON.stringify(fixture)}\n`);
  }
  const equivalence: Record<string, unknown>[] = [];
  for (const f of fixtures) {
    const events: string[] = [];
    const base = new DeryaReadExecutor(db, deryaProjection, f.invocation.scope.toolSchemaHash, f.invocation.scope.environmentVersion, f.principal, () => {});
    const shadow = new DeryaReadExecutor(db, deryaProjection, f.invocation.scope.toolSchemaHash, f.invocation.scope.environmentVersion, f.principal, kind => events.push(kind), { mode: "shadow" });
    const initial = await shadow.read(f.invocation, signal);
    assert.deepEqual(await shadow.validate(f.invocation, initial, signal), await base.validate(f.invocation, initial, signal));
    const mutationTable = f.tool === "search_companies" ? "Company" : ["search_inquiries", "list_open_inquiries"].includes(f.tool) ? "Inquiry" : "Job";
    await writer.$executeRawUnsafe(`UPDATE public."${mutationTable}" SET "${fields[mutationTable]}" = $1 WHERE id = $2`, `Changed fixture ${f.id}`, f.ids[mutationTable]);
    const changed = await shadow.validate(f.invocation, initial, signal);
    assert.deepEqual(changed, await base.validate(f.invocation, initial, signal));
    assert.notDeepEqual(changed, initial); assert(events.includes("epoch_changed")); assert(!events.includes("epoch_shadow_mismatch"));
    equivalence.push({ scenario: f.id, tool: f.tool, independentFixture: true, currentHash: hash(changed), beforeHash: hash(initial), mutationTable, passed: true });
    appendFileSync(resolve(output, "equivalence.jsonl"), `${JSON.stringify(equivalence.at(-1))}\n`);
    const baselineEpoch = await capture(); assert(baselineEpoch);
    const epochProbe = () => db.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await authorizeDeryaRead(tx, { userId: f.principal.id, officeId: f.principal.officeId, accessKind: "operator" }, f.invocation.scope.authorizationVersion);
      const current = await captureEpochSnapshot(tx);
      assert(current && epochsEqual(baselineEpoch, current, f.tool));
    }, { isolationLevel: "RepeatableRead", timeout: 4_500, maxWait: 500 });
    await epochProbe(); await base.validate(f.invocation, changed, signal); // Excluded warmup, identical data.
    for (let repeat = 0; repeat < 10; repeat++) {
      const order = (Number.parseInt(hash([f.id, repeat]).slice(0, 8), 16) % 2) ? ["epoch_probe", "full_reread"] : ["full_reread", "epoch_probe"];
      for (const mode of order) await measure(f, mode, repeat, mode === "epoch_probe" ? epochProbe : () => base.validate(f.invocation, changed, signal));
    }
  }
  // Trigger toggles are isolated test administration, outside sample clocks.
  // All counters are restored before any subsequent read. No simultaneous read
  // benchmark or other service may use this dedicated fixture database here.
  try {
    for (let repeat = 0; repeat < 3; repeat++) {
      for (const enabled of repeat % 2 ? [true, false] : [false, true]) {
        await setTriggers(enabled);
        for (const table of DERYA_EPOCH_TABLES) {
          const statement = `UPDATE public."${table}" SET "${fields[table]}" = $1 WHERE id = $2`;
          await writer.$executeRawUnsafe(statement, `warm-${repeat}`, fixtures[0].ids[table]);
          for (const f of fixtures) {
            const start = performance.now(); await writer.$executeRawUnsafe(statement, `write-${repeat}-${enabled}-${f.id}`, f.ids[table]);
            const sample = { scenario: f.id, tool: table, mode: enabled ? "epochs_enabled" : "epochs_disabled", repetition: repeat, latencyMs: performance.now() - start };
            writerSamples.push(sample); appendFileSync(resolve(output, "writer-samples.jsonl"), `${JSON.stringify(sample)}\n`);
          }
        }
      }
    }
  } finally { await setTriggers(true); }
  const perTool = DERYA_READ_TOOLS.map(tool => ({ tool, full: statistics(samples.filter(s => s.tool === tool && s.mode === "full_reread")), epoch: statistics(samples.filter(s => s.tool === tool && s.mode === "epoch_probe")) }));
  const perWriter = DERYA_EPOCH_TABLES.map(table => {
    const baseline = statistics(writerSamples.filter(s => s.tool === table && s.mode === "epochs_disabled"));
    const enabled = statistics(writerSamples.filter(s => s.tool === table && s.mode === "epochs_enabled"));
    return { table, baseline, enabled, p95OverheadRatio: enabled.p95Ms / baseline.p95Ms - 1 };
  });
  const allowedTools = perTool.filter(row => row.epoch.p95Ms < row.full.p95Ms).map(row => row.tool);
  const writerOverheadRatio = Math.max(...perWriter.map(row => row.p95OverheadRatio));
  const performanceEvidence = { version: "derya-epoch-performance-v5.1", perTool, perWriter, allowedTools, writerOverheadRatio,
    gatePassed: allowedTools.length > 0 && writerOverheadRatio <= .05, totalIndependentScenarios: 100, repeatedReadSamples: samples.length,
    repeatedWriterSamples: writerSamples.length, latencyScope: "Local actual PostgreSQL transaction wall time, no actor/provider; epoch_probe excludes projection and does not expose an observation." };
  save("performance.json", performanceEvidence);
  const receiptEpoch = await capture(); assert(receiptEpoch);
  let receipt: EpochReuseReceipt | undefined;
  const demonstration: Record<string, unknown>[] = [];
  if (performanceEvidence.gatePassed) {
    receipt = { version: 1, contractHash: DERYA_EPOCH_CONTRACT_HASH, coverageHash: receiptEpoch.coverageHash, incarnation: receiptEpoch.incarnation,
      allowedTools, equivalencePassed: true, equivalenceEvidenceHash: sha(readFileSync(resolve(output, "equivalence.jsonl"))),
      performanceEvidenceHash: sha(readFileSync(resolve(output, "performance.json"))), validationSamples: samples.length / 2,
      writerSamples: writerSamples.length / 2, validationP95Ms: Math.max(...perTool.filter(row => allowedTools.includes(row.tool)).map(row => row.epoch.p95Ms)),
      fullReadP95Ms: Math.max(...perTool.filter(row => allowedTools.includes(row.tool)).map(row => row.full.p95Ms)), writerOverheadRatio };
    save("reuse-receipt.json", { receipt, trustedReceiptHash: hash(receipt) });
    for (const f of fixtures.filter(f => allowedTools.includes(f.tool))) {
      let projections = 0;
      const executor: DeryaReadExecutor = new DeryaReadExecutor(db, async (...args) => { projections++; return deryaProjection(...args); }, f.invocation.scope.toolSchemaHash, f.invocation.scope.environmentVersion,
        f.principal, () => {}, { mode: "verified-reuse", receipt, trustedReceiptHash: hash(receipt) });
      const initial: Awaited<ReturnType<DeryaReadExecutor["read"]>> = await executor.read(f.invocation, signal), start = performance.now();
      assert.deepEqual(await executor.validate(f.invocation, initial, signal), initial); assert.equal(projections, 1);
      demonstration.push({ scenario: f.id, tool: f.tool, projectionReads: projections, verifiedReuse: true, latencyMs: performance.now() - start });
    }
  }
  for (const source of sources) assert.equal(sha(readFileSync(source.path)), source.sha256, "Frozen profile source changed");
  const filenames = ["plan.json", "fixtures.jsonl", "equivalence.jsonl", "read-samples.jsonl", "writer-samples.jsonl", "performance.json", ...(receipt ? ["reuse-receipt.json"] : [])];
  save("report.json", { version: "derya-real-read-profile-v5.1", complete: true, scenarioCount: fixtures.length, equivalencePassed: equivalence.every(row => row.passed), performance: performanceEvidence,
    verifiedReuseEnabled: !!receipt, demonstration, fixturesRetained: true, fixtureDatabase: "goalspec_derya_v5_test", artifactFiles: filenames.map(path => ({ path, sha256: sha(readFileSync(resolve(output, path))) })),
    productionMode: "off", sourceFiles: sources, limitation: "Synthetic fixture microbenchmark; repeated samples are not tasks, and one-column writes do not establish production workload overhead. No task-accuracy, live-model latency or universal safety/performance claim." });
  console.log(JSON.stringify({ output, scenarios: fixtures.length, gatePassed: performanceEvidence.gatePassed, allowedTools, writerOverheadRatio, perTool }));
}
main().catch(error => { save("failure.json", { complete: false, error: error instanceof Error ? error.message : "Profile failed", samples: samples.length, writerSamples: writerSamples.length }); process.exitCode = 1; })
  .finally(async () => { await Promise.all([db.$disconnect(), writer.$disconnect()]); });
