import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, freemem, platform, release, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { LocalController } from "../../src/lib/goalspec/controller";
import { canonical } from "../../src/lib/goalspec/canonical";

// Predeclared repeat protocol: five full warmup passes, then five full measured
// passes over the same ordered 643 states. Every sample and pass is retained.
const [artifactPath, checkpointsPath, outputPath] = process.argv.slice(2).map(path => resolve(path));
if (!artifactPath || !checkpointsPath || !outputPath || existsSync(outputPath)) throw new Error("Provide model, checkpoints, and NEW output directory");
const file = (path: string) => ({ path: resolve(path), sha256: createHash("sha256").update(readFileSync(path)).digest("hex") });
const sources = [artifactPath, checkpointsPath, "outputs/goalspec-v4-tools/controller_component_benchmark.ts", "src/lib/goalspec/controller.ts",
  "src/lib/goalspec/controller-features.ts", "src/lib/goalspec/contracts/v4-controller.generated.ts", "src/lib/goalspec/contracts/validate.ts", "src/lib/goalspec/canonical.ts"].map(file);
const controller = new LocalController(JSON.parse(readFileSync(artifactPath, "utf8")));
const rows = readFileSync(checkpointsPath, "utf8").trim().split(/\r?\n/).map(line => JSON.parse(line));
if (rows.length !== 643 || controller.artifact.contentHash !== "f89c20b480f9b76ea0aa1308b389f268127e67cb379b815f0fb63ea793f718fb") throw new Error("Frozen benchmark population/model differs");
const startedAt = new Date().toISOString(), host = { platform: platform(), release: release(), node: process.version, arch: process.arch,
  cpuModel: cpus()[0]?.model, logicalCpus: cpus().length, totalMemoryBytes: totalmem(), freeMemoryBytesAtStart: freemem() };
for (let pass = 0; pass < 5; pass++) for (const row of rows) controller.decide(row.state, row.candidates);
const samples: { pass: number; index: number; groupId: string; candidateCount: number; elapsedMs: number }[] = [];
for (let pass = 0; pass < 5; pass++) for (const [index, row] of rows.entries()) {
  const start = performance.now(); controller.decide(row.state, row.candidates); const elapsedMs = performance.now() - start;
  samples.push({ pass, index, groupId: row.groupId, candidateCount: row.candidates.length, elapsedMs });
}
const summarize = (times: number[]) => { const sorted = [...times].sort((a, b) => a - b); return { samples: times.length,
  meanMs: times.reduce((sum, value) => sum + value, 0) / times.length, p50Ms: sorted[Math.floor(times.length * .5)],
  p95Ms: sorted[Math.floor(times.length * .95)], maximumMs: sorted.at(-1) }; };
const aggregate = summarize(samples.map(s => s.elapsedMs));
for (const source of sources) if (file(source.path).sha256 !== source.sha256) throw new Error("Benchmark input changed");
mkdirSync(outputPath, { recursive: true });
const sampleText = samples.map(canonical).join("\n") + "\n";
writeFileSync(join(outputPath, "samples.jsonl"), sampleText, { flag: "wx" });
const report = { version: "goalspec-controller-component-benchmark-v2", startedAt, closedAt: new Date().toISOString(), host, sources,
  artifactHash: controller.artifact.contentHash, warmupPasses: 5, measuredPasses: 5, statesPerPass: 643, ...aggregate, targetP95Ms: 10,
  targetMet: aggregate.p95Ms < 10, perPass: Array.from({ length: 5 }, (_, pass) => ({ pass, ...summarize(samples.filter(s => s.pass === pass).map(s => s.elapsedMs)) })),
  samplesSha256: createHash("sha256").update(sampleText).digest("hex"), providerCalls: 0, fitting: false,
  scope: "LocalController.decide only: validation, frozen features, dense scores, calibrated gates and ranking. Excludes frame/candidate construction, retrieval, actor, tools, environment and network. Repeated states are timing samples, not independent task samples.",
  previousRun: "research/goalspec/runs/local-v4-component-benchmark-20260916/latency.json, all previous results retained; this fixed rerun was declared before measurement, not selected from repeated attempts." };
writeFileSync(join(outputPath, "report.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ ...aggregate, targetMet: report.targetMet, outputPath }));
