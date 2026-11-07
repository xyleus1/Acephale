import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { canonical, hash } from "../src/lib/acephale/canonical";
import { validateMemoryArtifact } from "../src/lib/acephale/experience-memory";
import { buildEpisodeEmbeddings, episodePrefixText, memoryRunHasKnownOutcome, validateEpisodeEmbeddings } from "../src/lib/acephale/episodic-retrieval";
import { publishEpisodicMemory } from "../src/lib/acephale/episodic-postgres";
import { researchDatabase } from "../src/lib/acephale/postgres-store";
import { DurableBudget } from "../services/acephale-runtime/durable-budget";
import { researchProvider, TrialLedger } from "../services/acephale-runtime/provider";
import { validateInfraLedgerCheckpoint } from "../services/acephale-runtime/infra-hosted-workers";
import { createHash } from "node:crypto";
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));

/** Explicit offline path: cache rows require exact prefix and encoder provenance. */
export async function embeddingsFromCache(memoryPath: string, modelVersion: string, cachePath: string, output: string) {
  if (existsSync(output)) throw new Error("New embedding output file required");
  const memory = validateMemoryArtifact(json(memoryPath)), cache = json(cachePath);
  if (cache.version !== 1 || cache.model !== "text-embedding-3-small" || cache.modelVersion !== modelVersion || !Array.isArray(cache.rows)) throw new Error("Embedding cache encoder mismatch");
  const rows = new Map<string, { text: string; vector: number[] }>();
  for (const row of cache.rows) {
    if (hash(row.text) !== row.textHash || hash(row.vector) !== row.vectorHash || rows.has(row.textHash)) throw new Error("Changed or repeated embedding cache row");
    rows.set(row.textHash, row);
  }
  const artifact = await buildEpisodeEmbeddings(memory, modelVersion, async text => {
    const row = rows.get(hash(text)); if (!row || row.text !== text) throw new Error("Required prefix absent from frozen cache"); return row.vector;
  }, new AbortController().signal);
  writeFileSync(output, canonical(artifact) + "\n", { flag: "wx" }); return { contentHash: artifact.contentHash, rows: artifact.rows.length };
}

/** This mode dispatches paid calls only when explicitly invoked with the existing shared ledger. */
export async function buildPaidEmbeddings(memoryPath: string, modelVersion: string, ledgerPath: string, checkpointPath: string, output: string,
  providerFactory: typeof researchProvider = researchProvider) {
  if (existsSync(output) || !existsSync(ledgerPath) || !statSync(ledgerPath).isFile() || !statSync(ledgerPath).size) throw new Error("New output and existing nonempty shared ledger required");
  ledgerPath = resolve(ledgerPath);
  const memory = validateMemoryArtifact(json(memoryPath));
  const eligible = new Set(memory.runs.filter(memoryRunHasKnownOutcome).map(row => row.id));
  const texts = [...new Set(memory.episodes.filter(row => eligible.has(row.runId)).map(episodePrefixText))];
  if (!texts.length || !modelVersion) throw new Error("Eligible frozen training prefixes and explicit encoder version required");
  const maximum = texts.reduce((sum, text) => sum + Math.ceil(Buffer.byteLength(text, "utf8") * 0.02), 0);
  const parentId = `episodic-embeddings:${memory.contentHash}:${hash(modelVersion)}`;
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "plan.json"), canonical({ version: 1, memoryHash: memory.contentHash, model: "text-embedding-3-small", modelVersion,
    dimensions: 1536, maximumRequests: texts.length, maximumMicrodollars: maximum, retries: 0, allocation: "preparation" }) + "\n", { flag: "wx" });
  const budget = new DurableBudget(ledgerPath); let reserved = false;
  try {
    validateInfraLedgerCheckpoint(json(checkpointPath), budget.ledger, ledgerPath);
    if (providerFactory === researchProvider && !process.env.OPENAI_API_KEY) throw new Error("Configure OPENAI_API_KEY securely before embedding dispatch");
    budget.ledger.reserve(parentId, "preparation", maximum); reserved = true;
    writeFileSync(join(output, "provider-events.jsonl"), "", { flag: "wx" });
    const provider = providerFactory(new TrialLedger(budget.ledger, parentId, "preparation"), "preparation",
      event => appendFileSync(join(output, "provider-events.jsonl"), canonical(event) + "\n"));
    const artifact = await buildEpisodeEmbeddings(memory, modelVersion, provider.embed, new AbortController().signal);
    writeFileSync(join(output, "embeddings.json"), canonical(artifact) + "\n", { flag: "wx" });
    writeFileSync(join(output, "episode-embeddings.jsonl"), artifact.rows.map(row => canonical(row)).join("\n") + "\n", { flag: "wx" });
    const files = Object.fromEntries(["plan.json", "embeddings.json", "episode-embeddings.jsonl", "provider-events.jsonl"].map(name => {
      const bytes = readFileSync(join(output, name)); return [name, { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length }];
    }));
    const manifest = { version: "acephale-episode-embeddings-v1", complete: true, immutable: true, sourceMemoryHash: memory.contentHash,
      artifactHash: artifact.contentHash, rows: artifact.rows.length, model: artifact.model, modelVersion, dimensions: artifact.dimensions,
      projectionHash: artifact.projectionHash, files };
    writeFileSync(join(output, "manifest.json"), canonical({ ...manifest, contentHash: hash(manifest) }) + "\n", { flag: "wx" });
    return { contentHash: artifact.contentHash, rows: artifact.rows.length };
  } finally { if (reserved) budget.ledger.finishParent(parentId); budget.close(); }
}

if (process.argv[1]?.endsWith("acephale-infra-embeddings.ts")) void (async () => {
  const [mode, memoryPath, modelOrEmbeddings, input, output, paidOutput] = process.argv.slice(2);
  if (mode === "--from-cache" && output) console.log(JSON.stringify(await embeddingsFromCache(memoryPath, modelOrEmbeddings, input, output)));
  else if (mode === "--build-paid" && paidOutput) console.log(JSON.stringify(await buildPaidEmbeddings(memoryPath, modelOrEmbeddings, input, output, paidOutput)));
  else if (mode === "--publish" && modelOrEmbeddings) {
    const memory = validateMemoryArtifact(json(memoryPath)), embeddings = validateEpisodeEmbeddings(json(modelOrEmbeddings), memory);
    if (!process.env.ACEPHALE_RESEARCH_DATABASE_URL) throw new Error("Dedicated research database URL required");
    const db = researchDatabase(process.env.ACEPHALE_RESEARCH_DATABASE_URL);
    try { console.log(JSON.stringify(await publishEpisodicMemory(db, memory, embeddings))); } finally { await db.close(); }
  } else throw new Error("Usage: --from-cache MEMORY MODEL_VERSION CACHE NEW_OUTPUT | --build-paid MEMORY MODEL_VERSION EXISTING_LEDGER LEDGER_CHECKPOINT NEW_DIRECTORY | --publish MEMORY EMBEDDINGS");
})().catch(error => { console.error(error instanceof Error ? error.message : "Embedding build failed"); process.exitCode = 1; });
