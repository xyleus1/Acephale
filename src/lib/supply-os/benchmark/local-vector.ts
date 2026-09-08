import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
  mkdir,
  open,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { basename, dirname, join, relative, resolve } from "node:path";

import { canonicalTypesForSearch, normalizeSourceType } from "@/lib/memory/canonical-types";
import { exactEntityScopes } from "@/lib/memory/retrievers/lexical";
import type {
  HybridMemorySearchInput,
  HybridMemorySearchResult,
} from "@/lib/memory/retrievers/types";
import type {
  VectorMemoryQuery,
  VectorMemoryRetriever,
} from "@/lib/memory/retrievers/vector";
import type { BenchmarkConfig } from "./config";
import type { BenchmarkSqlClient } from "./database";
import {
  BENCHMARK_SEED_VERSION,
  type BenchmarkProfile,
} from "./types";
import {
  benchmarkProfilePrefix,
  benchmarkRetrievableCountPlan,
} from "./generate";

export const BENCHMARK_VECTOR_RUNTIME_PACKAGE = "@huggingface/transformers" as const;
export const BENCHMARK_VECTOR_RUNTIME_VERSION = "4.2.0" as const;
export const BENCHMARK_VECTOR_MODEL_ID = "Xenova/all-MiniLM-L6-v2" as const;
export const BENCHMARK_VECTOR_MODEL_REVISION = "cb3d680149bf9a3209564e1b27ab3bb355b65707" as const;
export const BENCHMARK_VECTOR_MODEL_DTYPE = "q8" as const;
export const BENCHMARK_VECTOR_DIMENSIONS = 384 as const;
export const BENCHMARK_VECTOR_INDEX_SCHEMA_VERSION = 1 as const;
const VECTOR_BUILD_BATCH_SIZE = 64;
const VECTOR_ROW_BATCH_SIZE = 2_000;

type TransformerTensor = {
  data: ArrayLike<number>;
  dims: number[];
};

type TransformerPipeline = (
  input: string | string[],
  options: { pooling: "mean"; normalize: true },
) => Promise<TransformerTensor>;

type TransformersModule = {
  env: {
    allowLocalModels: boolean;
    allowRemoteModels: boolean;
    cacheDir: string;
  };
  pipeline(
    task: "feature-extraction",
    model: string,
    options: {
      revision?: string;
      dtype: string;
      local_files_only?: boolean;
    },
  ): Promise<TransformerPipeline>;
};

type VectorChunkRow = {
  id: string;
  officeId: string;
  text: string;
  objectId: string;
  objectOfficeId: string;
  sourceType: string;
  sourceExternalId: string;
  canonicalType: string;
  title: string | null;
  entityType: string | null;
  entityId: string | null;
  companyId: string | null;
  contactId: string | null;
  inquiryId: string | null;
  jobId: string | null;
  emailThreadId: string | null;
  emailMessageId: string | null;
  jobDocumentId: string | null;
  strategyAssessmentId: string | null;
  agentProposalId: string | null;
  occurredAt: Date;
};

type VectorMentionRow = {
  objectId: string | null;
  chunkId: string | null;
  entityType: string;
  entityId: string;
};

export type BenchmarkVectorIndexEntry = Omit<VectorChunkRow, "text" | "occurredAt"> & {
  occurredAt: string;
  mentions: Array<{ entityType: string; entityId: string }>;
};

type VectorIndexEntry = BenchmarkVectorIndexEntry;

type VectorAsset = {
  path: string;
  bytes: number;
  sha256: string;
};

export type BenchmarkVectorIndexManifest = {
  schemaVersion: 1;
  profile: BenchmarkProfile;
  databaseName: string;
  seedVersion: string;
  model: {
    id: string;
    revision: string;
    dtype: string;
    dimensions: number;
    runtimePackage: string;
    runtimeVersion: string;
    files: VectorAsset[];
  };
  chunkCount: number;
  corpusFingerprint: string;
  vectorFile: VectorAsset;
  metadataFile: VectorAsset;
  buildMs: number;
  builtAt: string;
};

export type BenchmarkVectorPreparation = {
  manifest: BenchmarkVectorIndexManifest;
  reused: boolean;
  runtimeInstalled: boolean;
};

type LocalVectorPaths = {
  root: string;
  runtimeRoot: string;
  runtimeNodeModules: string;
  modelCache: string;
  indexRoot: string;
  manifest: string;
  metadata: string;
  vectors: string;
};

function vectorPaths(config: BenchmarkConfig, profile: BenchmarkProfile): LocalVectorPaths {
  const root = resolve(config.outputDir, "vector-runtime");
  const modelKey = [
    basename(BENCHMARK_VECTOR_MODEL_ID),
    BENCHMARK_VECTOR_MODEL_REVISION.slice(0, 12),
    BENCHMARK_VECTOR_MODEL_DTYPE,
    `${BENCHMARK_VECTOR_DIMENSIONS}d`,
  ].join("-");
  const indexRoot = join(root, "indexes", profile, modelKey);
  return {
    root,
    runtimeRoot: join(root, "npm"),
    runtimeNodeModules: join(root, "npm", "node_modules"),
    modelCache: join(root, "model-cache"),
    indexRoot,
    manifest: join(indexRoot, "manifest.json"),
    metadata: join(indexRoot, "metadata.json"),
    vectors: join(indexRoot, "vectors.f32"),
  };
}

function sha256Buffer(value: Buffer | Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

async function hashFile(path: string): Promise<VectorAsset> {
  const handle = await open(path, "r");
  const digest = createHash("sha256");
  let bytes = 0;
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    while (true) {
      const read = await handle.read(buffer, 0, buffer.length, null);
      if (!read.bytesRead) break;
      digest.update(buffer.subarray(0, read.bytesRead));
      bytes += read.bytesRead;
    }
  } finally {
    await handle.close();
  }
  return { path, bytes, sha256: digest.digest("hex") };
}

async function filesRecursively(root: string): Promise<string[]> {
  const output: string[] = [];
  const visit = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) output.push(path);
    }
  };
  await visit(root);
  return output.sort();
}

async function modelAssets(paths: LocalVectorPaths) {
  const assets: VectorAsset[] = [];
  for (const path of await filesRecursively(paths.modelCache)) {
    const asset = await hashFile(path);
    assets.push({ ...asset, path: relative(paths.modelCache, path).replaceAll("\\", "/") });
  }
  if (!assets.length) throw new Error("The pinned benchmark embedding model cache is empty.");
  return assets;
}

async function runtimePackageJson(paths: LocalVectorPaths) {
  const packagePath = join(
    paths.runtimeNodeModules,
    "@huggingface",
    "transformers",
    "package.json",
  );
  const parsed = JSON.parse(await readFile(packagePath, "utf8")) as { version?: string };
  if (parsed.version !== BENCHMARK_VECTOR_RUNTIME_VERSION) {
    throw new Error(
      `Benchmark vector runtime must be ${BENCHMARK_VECTOR_RUNTIME_PACKAGE}@${BENCHMARK_VECTOR_RUNTIME_VERSION}.`,
    );
  }
  return packagePath;
}

async function npmInstallRuntime(paths: LocalVectorPaths) {
  await mkdir(paths.runtimeRoot, { recursive: true });
  const configuredNpmCli = process.env.npm_execpath?.trim();
  const npmCli = configuredNpmCli && /npm-cli\.js$/i.test(configuredNpmCli)
    ? configuredNpmCli
    : join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(process.execPath, [
      npmCli,
      "install",
      "--prefix",
      paths.runtimeRoot,
      "--no-save",
      "--package-lock=false",
      "--no-audit",
      "--no-fund",
      `${BENCHMARK_VECTOR_RUNTIME_PACKAGE}@${BENCHMARK_VECTOR_RUNTIME_VERSION}`,
    ], { stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`Benchmark vector runtime installation exited with code ${code ?? "unknown"}.`));
    });
  });
  await runtimePackageJson(paths);
}

async function loadTransformers(paths: LocalVectorPaths, allowRemoteModels: boolean) {
  const packagePath = await runtimePackageJson(paths);
  const requireFromRuntime = createRequire(packagePath);
  const entryPath = requireFromRuntime.resolve(BENCHMARK_VECTOR_RUNTIME_PACKAGE);
  const imported = await import(pathToFileURL(entryPath).href) as unknown as TransformersModule;
  imported.env.cacheDir = paths.modelCache;
  imported.env.allowLocalModels = true;
  imported.env.allowRemoteModels = allowRemoteModels;
  return imported;
}

export function benchmarkVectorModelLoadRequest(input: {
  modelCache: string;
  allowRemoteModels: boolean;
}) {
  if (input.allowRemoteModels) {
    return {
      model: BENCHMARK_VECTOR_MODEL_ID,
      options: {
        revision: BENCHMARK_VECTOR_MODEL_REVISION,
        dtype: BENCHMARK_VECTOR_MODEL_DTYPE,
      },
    } as const;
  }
  return {
    model: join(
      resolve(input.modelCache),
      ...BENCHMARK_VECTOR_MODEL_ID.split("/"),
      BENCHMARK_VECTOR_MODEL_REVISION,
    ),
    options: {
      dtype: BENCHMARK_VECTOR_MODEL_DTYPE,
      local_files_only: true,
    },
  } as const;
}

async function loadEmbeddingPipeline(paths: LocalVectorPaths, allowRemoteModels: boolean) {
  const transformers = await loadTransformers(paths, allowRemoteModels);
  const request = benchmarkVectorModelLoadRequest({
    modelCache: paths.modelCache,
    allowRemoteModels,
  });
  const extractor = await transformers.pipeline(
    "feature-extraction",
    request.model,
    request.options,
  );
  return extractor;
}

function embeddingRows(tensor: TransformerTensor, expectedCount: number) {
  const dimensions = tensor.dims.at(-1);
  if (dimensions !== BENCHMARK_VECTOR_DIMENSIONS) {
    throw new Error(
      `Embedding model returned ${dimensions ?? "unknown"} dimensions, expected ${BENCHMARK_VECTOR_DIMENSIONS}.`,
    );
  }
  if (tensor.data.length !== expectedCount * BENCHMARK_VECTOR_DIMENSIONS) {
    throw new Error("Embedding model returned an unexpected tensor shape.");
  }
  return Float32Array.from(tensor.data);
}

async function embed(extractor: TransformerPipeline, texts: string[]) {
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  return embeddingRows(output, texts.length);
}

async function loadChunkBatch(
  database: BenchmarkSqlClient,
  officePrefix: string,
  afterId: string | null,
) {
  return database.$queryRawUnsafe<VectorChunkRow[]>(`
    SELECT
      chunk.id,
      chunk."officeId",
      chunk.text,
      object.id AS "objectId",
      object."officeId" AS "objectOfficeId",
      object."sourceType",
      object."sourceExternalId",
      object."canonicalType",
      object.title,
      object."entityType",
      object."entityId",
      object."companyId",
      object."contactId",
      object."inquiryId",
      object."jobId",
      object."emailThreadId",
      object."emailMessageId",
      object."jobDocumentId",
      object."strategyAssessmentId",
      object."agentProposalId",
      object."occurredAt"
    FROM public."KnowledgeChunk" AS chunk
    JOIN public."KnowledgeObject" AS object ON object.id = chunk."objectId"
    WHERE chunk."officeId" LIKE $1
      AND ($2::text IS NULL OR chunk.id > $2)
    ORDER BY chunk.id
    LIMIT ${VECTOR_ROW_BATCH_SIZE}
  `, `${officePrefix}%`, afterId);
}

async function loadMentions(database: BenchmarkSqlClient, officePrefix: string) {
  return database.$queryRawUnsafe<VectorMentionRow[]>(`
    SELECT "objectId", "chunkId", "entityType", "entityId"
    FROM public."EntityMention"
    WHERE "officeId" LIKE $1
    ORDER BY id
  `, `${officePrefix}%`);
}

function mentionMap(rows: VectorMentionRow[]) {
  const output = new Map<string, Array<{ entityType: string; entityId: string }>>();
  for (const row of rows) {
    for (const key of [row.objectId, row.chunkId]) {
      if (!key) continue;
      const values = output.get(key) ?? [];
      if (!values.some((value) => value.entityType === row.entityType && value.entityId === row.entityId)) {
        values.push({ entityType: row.entityType, entityId: row.entityId });
      }
      output.set(key, values);
    }
  }
  return output;
}

function vectorIndexEntry(row: VectorChunkRow, mentions: ReturnType<typeof mentionMap>): VectorIndexEntry {
  const combined = [...(mentions.get(row.objectId) ?? []), ...(mentions.get(row.id) ?? [])];
  const seen = new Set<string>();
  return {
    id: row.id,
    officeId: row.officeId,
    objectId: row.objectId,
    objectOfficeId: row.objectOfficeId,
    sourceType: row.sourceType,
    sourceExternalId: row.sourceExternalId,
    canonicalType: row.canonicalType,
    title: row.title,
    entityType: row.entityType,
    entityId: row.entityId,
    companyId: row.companyId,
    contactId: row.contactId,
    inquiryId: row.inquiryId,
    jobId: row.jobId,
    emailThreadId: row.emailThreadId,
    emailMessageId: row.emailMessageId,
    jobDocumentId: row.jobDocumentId,
    strategyAssessmentId: row.strategyAssessmentId,
    agentProposalId: row.agentProposalId,
    occurredAt: row.occurredAt.toISOString(),
    mentions: combined.filter((mention) => {
      const key = `${mention.entityType}\u0000${mention.entityId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  };
}

function updateCorpusFingerprint(
  digest: ReturnType<typeof createHash>,
  row: VectorChunkRow,
  mentions: ReturnType<typeof mentionMap>,
) {
  const entry = vectorIndexEntry(row, mentions);
  digest.update(JSON.stringify({
    ...entry,
    mentions: [...entry.mentions].sort((left, right) => (
      left.entityType.localeCompare(right.entityType) || left.entityId.localeCompare(right.entityId)
    )),
    textHash: sha256Buffer(row.text),
  }));
  digest.update("\n");
}

async function currentCorpusFingerprint(input: {
  database: BenchmarkSqlClient;
  profile: BenchmarkProfile;
}) {
  const officePrefix = benchmarkProfilePrefix(input.profile);
  const mentions = mentionMap(await loadMentions(input.database, officePrefix));
  const digest = createHash("sha256");
  let count = 0;
  let afterId: string | null = null;
  while (true) {
    const rows = await loadChunkBatch(input.database, officePrefix, afterId);
    if (!rows.length) break;
    for (const row of rows) updateCorpusFingerprint(digest, row, mentions);
    count += rows.length;
    afterId = rows.at(-1)!.id;
  }
  return { count, fingerprint: digest.digest("hex") };
}

async function readManifest(paths: LocalVectorPaths) {
  return JSON.parse(await readFile(paths.manifest, "utf8")) as BenchmarkVectorIndexManifest;
}

async function validateAsset(root: string, expected: VectorAsset) {
  const path = resolve(root, expected.path);
  if (path !== root && !path.startsWith(`${root}\\`) && !path.startsWith(`${root}/`)) {
    throw new Error("Benchmark vector asset path escaped its expected root.");
  }
  const actual = await hashFile(path);
  if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) {
    throw new Error(`Benchmark vector asset integrity check failed for ${expected.path}.`);
  }
}

async function validateManifest(
  config: BenchmarkConfig,
  profile: BenchmarkProfile,
  paths: LocalVectorPaths,
  manifest: BenchmarkVectorIndexManifest,
  database: BenchmarkSqlClient,
) {
  const expectedChunks = benchmarkRetrievableCountPlan(profile).knowledgeChunks;
  if (
    manifest.schemaVersion !== BENCHMARK_VECTOR_INDEX_SCHEMA_VERSION
    || manifest.profile !== profile
    || manifest.databaseName !== config.databaseName
    || manifest.seedVersion !== BENCHMARK_SEED_VERSION
    || manifest.chunkCount !== expectedChunks
    || manifest.model.id !== BENCHMARK_VECTOR_MODEL_ID
    || manifest.model.revision !== BENCHMARK_VECTOR_MODEL_REVISION
    || manifest.model.dtype !== BENCHMARK_VECTOR_MODEL_DTYPE
    || manifest.model.dimensions !== BENCHMARK_VECTOR_DIMENSIONS
    || manifest.model.runtimePackage !== BENCHMARK_VECTOR_RUNTIME_PACKAGE
    || manifest.model.runtimeVersion !== BENCHMARK_VECTOR_RUNTIME_VERSION
  ) {
    throw new Error("Benchmark vector index manifest does not match the pinned benchmark configuration.");
  }
  await runtimePackageJson(paths);
  await Promise.all([
    validateAsset(paths.indexRoot, manifest.vectorFile),
    validateAsset(paths.indexRoot, manifest.metadataFile),
    ...manifest.model.files.map((asset) => validateAsset(paths.modelCache, asset)),
  ]);
  const currentCorpus = await currentCorpusFingerprint({ database, profile });
  if (
    currentCorpus.count !== manifest.chunkCount
    || currentCorpus.fingerprint !== manifest.corpusFingerprint
  ) {
    throw new Error("Benchmark vector index is stale relative to the canonical KnowledgeChunk corpus.");
  }
}

export async function installLocalBenchmarkVectorRuntime(input: {
  config: BenchmarkConfig;
  profile: BenchmarkProfile;
}) {
  const paths = vectorPaths(input.config, input.profile);
  try {
    await runtimePackageJson(paths);
    return { installed: false, runtimeRoot: paths.runtimeRoot };
  } catch {
    await npmInstallRuntime(paths);
    return { installed: true, runtimeRoot: paths.runtimeRoot };
  }
}

export async function prepareLocalBenchmarkVectorIndex(input: {
  config: BenchmarkConfig;
  database: BenchmarkSqlClient;
  profile: BenchmarkProfile;
  installRuntime?: boolean;
  downloadModel?: boolean;
  rebuild?: boolean;
  onProgress?: (progress: Readonly<Record<string, unknown>>) => void;
}): Promise<BenchmarkVectorPreparation> {
  const paths = vectorPaths(input.config, input.profile);
  let runtimeInstalled = false;
  try {
    await runtimePackageJson(paths);
  } catch {
    if (!input.installRuntime) {
      throw new Error(
        `Pinned local vector runtime is missing. Run npm run benchmark:vector:prepare -- --profile=${input.profile}.`,
      );
    }
    await npmInstallRuntime(paths);
    runtimeInstalled = true;
  }

  if (!input.rebuild) {
    try {
      const manifest = await readManifest(paths);
      await validateManifest(input.config, input.profile, paths, manifest, input.database);
      return { manifest, reused: true, runtimeInstalled };
    } catch (error) {
      if (!input.downloadModel) throw error;
    }
  }

  await mkdir(paths.indexRoot, { recursive: true });
  await mkdir(paths.modelCache, { recursive: true });
  const buildStartedAt = performance.now();
  const extractor = await loadEmbeddingPipeline(paths, Boolean(input.downloadModel));
  const modelFiles = await modelAssets(paths);
  const mentions = mentionMap(await loadMentions(input.database, benchmarkProfilePrefix(input.profile)));
  const metadata: VectorIndexEntry[] = [];
  const corpusDigest = createHash("sha256");
  const vectorHandle = await open(paths.vectors, "w");
  let chunkCount = 0;
  let afterId: string | null = null;
  try {
    while (true) {
      const rows = await loadChunkBatch(
        input.database,
        benchmarkProfilePrefix(input.profile),
        afterId,
      );
      if (!rows.length) break;
      for (let offset = 0; offset < rows.length; offset += VECTOR_BUILD_BATCH_SIZE) {
        const batch = rows.slice(offset, offset + VECTOR_BUILD_BATCH_SIZE);
        const vectors = await embed(extractor, batch.map((row) => row.text));
        await vectorHandle.write(Buffer.from(vectors.buffer, vectors.byteOffset, vectors.byteLength));
        for (const row of batch) {
          updateCorpusFingerprint(corpusDigest, row, mentions);
          metadata.push(vectorIndexEntry(row, mentions));
        }
        chunkCount += batch.length;
        input.onProgress?.({
          event: "vector_index_progress",
          profile: input.profile,
          chunkCount,
          expectedChunkCount: benchmarkRetrievableCountPlan(input.profile).knowledgeChunks,
        });
      }
      afterId = rows.at(-1)!.id;
    }
  } finally {
    await vectorHandle.close();
  }

  const expectedChunks = benchmarkRetrievableCountPlan(input.profile).knowledgeChunks;
  if (chunkCount !== expectedChunks) {
    throw new Error(`Vector index read ${chunkCount} chunks, expected ${expectedChunks}.`);
  }
  await writeFile(paths.metadata, JSON.stringify(metadata));
  const [vectorAsset, metadataAsset] = await Promise.all([
    hashFile(paths.vectors),
    hashFile(paths.metadata),
  ]);
  const manifest: BenchmarkVectorIndexManifest = {
    schemaVersion: BENCHMARK_VECTOR_INDEX_SCHEMA_VERSION,
    profile: input.profile,
    databaseName: input.config.databaseName,
    seedVersion: BENCHMARK_SEED_VERSION,
    model: {
      id: BENCHMARK_VECTOR_MODEL_ID,
      revision: BENCHMARK_VECTOR_MODEL_REVISION,
      dtype: BENCHMARK_VECTOR_MODEL_DTYPE,
      dimensions: BENCHMARK_VECTOR_DIMENSIONS,
      runtimePackage: BENCHMARK_VECTOR_RUNTIME_PACKAGE,
      runtimeVersion: BENCHMARK_VECTOR_RUNTIME_VERSION,
      files: modelFiles,
    },
    chunkCount,
    corpusFingerprint: corpusDigest.digest("hex"),
    vectorFile: { ...vectorAsset, path: basename(paths.vectors) },
    metadataFile: { ...metadataAsset, path: basename(paths.metadata) },
    buildMs: Math.max(0, performance.now() - buildStartedAt),
    builtAt: new Date().toISOString(),
  };
  await writeFile(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
  await validateManifest(input.config, input.profile, paths, manifest, input.database);
  return { manifest, reused: false, runtimeInstalled };
}

function asDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function rowHasEntity(
  row: VectorIndexEntry,
  entityTypes: string[],
  entityId: string,
  directField?: string,
) {
  if (entityTypes.includes(row.entityType ?? "") && row.entityId === entityId) return true;
  if (row.mentions.some((mention) => entityTypes.includes(mention.entityType) && mention.entityId === entityId)) {
    return true;
  }
  if (!directField) return false;
  return (row as unknown as Record<string, unknown>)[directField] === entityId;
}

export function benchmarkVectorIndexRowMatchesScope(
  row: BenchmarkVectorIndexEntry,
  input: HybridMemorySearchInput,
) {
  return compileBenchmarkVectorScopeFilter(input)(row);
}

/** Compile query-invariant filters once, without retaining any corpus rows. */
export function compileBenchmarkVectorScopeFilter(input: HybridMemorySearchInput) {
  const officeId = input.officeId;
  const scopes = exactEntityScopes(input);
  if (input.companyId) scopes.unshift({ entityTypes: ["company"], entityId: input.companyId, directField: "companyId" });
  if (input.jobId) scopes.unshift({ entityTypes: ["job"], entityId: input.jobId, directField: "jobId" });
  if (input.inquiryId) scopes.unshift({ entityTypes: ["inquiry"], entityId: input.inquiryId, directField: "inquiryId" });
  const canonicalTypes = new Set(canonicalTypesForSearch(input.canonicalTypes ?? []));
  const sourceTypes = new Set((input.sourceTypes ?? []).map(normalizeSourceType).filter(Boolean));
  const from = asDate(input.dateRange?.from);
  const to = asDate(input.dateRange?.to);
  return (row: BenchmarkVectorIndexEntry) => {
    if (row.officeId !== officeId || row.objectOfficeId !== officeId) return false;
    for (const scope of scopes) {
      if (!rowHasEntity(row, scope.entityTypes, scope.entityId, scope.directField)) return false;
    }
    if (canonicalTypes.size && !canonicalTypes.has(row.canonicalType)) return false;
    if (sourceTypes.size && !sourceTypes.has(normalizeSourceType(row.sourceType))) return false;
    const occurredAt = asDate(row.occurredAt);
    return Boolean(occurredAt) && (!from || occurredAt! >= from) && (!to || occurredAt! <= to);
  };
}

type ScoredIndex = { index: number; score: number };

function heapSwap(heap: ScoredIndex[], left: number, right: number) {
  [heap[left], heap[right]] = [heap[right]!, heap[left]!];
}

function heapPush(heap: ScoredIndex[], value: ScoredIndex, limit: number) {
  if (heap.length < limit) {
    heap.push(value);
    let index = heap.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (heap[parent]!.score <= heap[index]!.score) break;
      heapSwap(heap, parent, index);
      index = parent;
    }
    return;
  }
  if (value.score <= heap[0]!.score) return;
  heap[0] = value;
  let index = 0;
  while (true) {
    const left = (index * 2) + 1;
    const right = left + 1;
    let smallest = index;
    if (left < heap.length && heap[left]!.score < heap[smallest]!.score) smallest = left;
    if (right < heap.length && heap[right]!.score < heap[smallest]!.score) smallest = right;
    if (smallest === index) return;
    heapSwap(heap, index, smallest);
    index = smallest;
  }
}

function dot(vectors: Float32Array, rowIndex: number, query: Float32Array) {
  const offset = rowIndex * BENCHMARK_VECTOR_DIMENSIONS;
  let score = 0;
  for (let index = 0; index < BENCHMARK_VECTOR_DIMENSIONS; index += 1) {
    score += vectors[offset + index]! * query[index]!;
  }
  return score;
}

function pointerResult(row: VectorIndexEntry, score: number): HybridMemorySearchResult {
  return {
    officeId: row.officeId,
    kind: "chunk",
    objectId: row.objectId,
    chunkId: row.id,
    eventId: null,
    sourceType: row.sourceType,
    sourceExternalId: row.sourceExternalId,
    canonicalType: row.canonicalType,
    title: row.title,
    excerpt: "",
    score: Math.max(0, score),
    occurredAt: new Date(row.occurredAt),
    entityType: row.entityType,
    entityId: row.entityId,
    companyId: row.companyId,
    jobId: row.jobId,
    inquiryId: row.inquiryId,
    emailThreadId: row.emailThreadId,
    reasons: ["retriever:local_minilm_vector_pointer"],
    evidence: [{
      refType: "knowledge_chunk",
      knowledgeObjectId: row.objectId,
      knowledgeChunkId: row.id,
      entityType: row.entityType,
      entityId: row.entityId,
      sourceType: row.sourceType,
      sourceExternalId: row.sourceExternalId,
      canonicalType: row.canonicalType,
      title: row.title,
      occurredAt: new Date(row.occurredAt),
    }],
  };
}

export async function createLocalBenchmarkVectorRetriever(input: {
  config: BenchmarkConfig;
  database: BenchmarkSqlClient;
  profile: BenchmarkProfile;
}): Promise<VectorMemoryRetriever & { manifest: BenchmarkVectorIndexManifest }> {
  const paths = vectorPaths(input.config, input.profile);
  const manifest = await readManifest(paths).catch(() => {
    throw new Error(
      `Benchmark vector index is missing. Run npm run benchmark:vector:prepare -- --profile=${input.profile}.`,
    );
  });
  await validateManifest(input.config, input.profile, paths, manifest, input.database);
  const [metadataText, vectorBuffer, extractor] = await Promise.all([
    readFile(paths.metadata, "utf8"),
    readFile(paths.vectors),
    loadEmbeddingPipeline(paths, false),
  ]);
  const metadata = JSON.parse(metadataText) as VectorIndexEntry[];
  const expectedVectorBytes = metadata.length * BENCHMARK_VECTOR_DIMENSIONS * Float32Array.BYTES_PER_ELEMENT;
  if (vectorBuffer.byteLength !== expectedVectorBytes || metadata.length !== manifest.chunkCount) {
    throw new Error("Benchmark vector index files have incompatible dimensions.");
  }
  const vectors = vectorBuffer.byteOffset % Float32Array.BYTES_PER_ELEMENT === 0
    ? new Float32Array(
      vectorBuffer.buffer,
      vectorBuffer.byteOffset,
      vectorBuffer.byteLength / Float32Array.BYTES_PER_ELEMENT,
    )
    : (() => {
      const aligned = new Float32Array(vectorBuffer.byteLength / Float32Array.BYTES_PER_ELEMENT);
      new Uint8Array(aligned.buffer).set(vectorBuffer);
      return aligned;
    })();
  const name = [
    "local",
    BENCHMARK_VECTOR_MODEL_ID,
    BENCHMARK_VECTOR_MODEL_REVISION.slice(0, 12),
    BENCHMARK_VECTOR_MODEL_DTYPE,
    `${BENCHMARK_VECTOR_DIMENSIONS}d`,
  ].join(":");
  return {
    name,
    manifest,
    async retrieve(query: VectorMemoryQuery) {
      const queryText = query.input.query?.trim();
      if (!queryText || query.input.includeChunks === false) return [];
      const queryVector = await embed(extractor, [queryText]);
      const heap: ScoredIndex[] = [];
      const limit = Math.max(1, Math.min(500, Math.floor(query.limit)));
      const matchesScope = compileBenchmarkVectorScopeFilter(query.input);
      for (let index = 0; index < metadata.length; index += 1) {
        const row = metadata[index]!;
        if (!matchesScope(row)) continue;
        heapPush(heap, { index, score: dot(vectors, index, queryVector) }, limit);
      }
      return heap
        .sort((left, right) => right.score - left.score || metadata[left.index]!.id.localeCompare(metadata[right.index]!.id))
        .map((entry) => pointerResult(metadata[entry.index]!, entry.score));
    },
  };
}

export async function inspectLocalBenchmarkVectorIndex(input: {
  config: BenchmarkConfig;
  database: BenchmarkSqlClient;
  profile: BenchmarkProfile;
}) {
  const paths = vectorPaths(input.config, input.profile);
  const manifest = await readManifest(paths);
  await validateManifest(input.config, input.profile, paths, manifest, input.database);
  const vectorStat = await stat(paths.vectors);
  return {
    manifest,
    indexRoot: paths.indexRoot,
    vectorBytes: vectorStat.size,
  };
}
