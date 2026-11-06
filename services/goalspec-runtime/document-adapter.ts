import { createHash } from "node:crypto";
import { copy, hash } from "../../src/lib/goalspec/canonical";
import type { Candidate, ExecutionFrame, Invocation, Json, Scope } from "../../src/lib/goalspec/contracts/generated";
import { resolveSource } from "../../src/lib/goalspec/compiler";
import { ReadAuthorizationDeniedError, type ReadExecutor, type ReadValidation } from "../../src/lib/goalspec/scheduler";

export interface CorpusDocument { id: string; title: string; snippet: string; url: string; sha256: string; familyId: string }
export interface DocumentCorpus { version: 1; id: string; documents: CorpusDocument[]; contentHash: string }
export const DOCUMENT_TOOLS = [
  { type: "function" as const, function: { name: "search_documents", description: "Search the frozen public document index. Returns identifiers and snippets, not complete documents.", parameters: { type: "object", properties: { query: { type: "string", minLength: 1, maxLength: 2048 } }, required: ["query"], additionalProperties: false } } },
  { type: "function" as const, function: { name: "fetch_document", description: "Fetch a complete immutable document by a visible search-result identifier.", parameters: { type: "object", properties: { document_id: { type: "string", minLength: 1, maxLength: 256 } }, required: ["document_id"], additionalProperties: false } } },
];
export function verifyDocumentCorpus(input: DocumentCorpus): DocumentCorpus {
  const corpus = copy(input);
  const { contentHash, ...body } = corpus;
  if (corpus.version !== 1 || !corpus.id || !Array.isArray(corpus.documents) || !corpus.documents.length
    || corpus.documents.length > 10000 || hash(body) !== contentHash) throw new Error("Invalid document corpus hash");
  const ids = new Set<string>();
  for (const doc of corpus.documents) {
    const url = new URL(doc.url);
    if (!doc.id || !doc.familyId || !doc.title || typeof doc.snippet !== "string" || ids.has(doc.id)
      || !/^[a-f0-9]{64}$/.test(doc.sha256) || url.protocol !== "https:" || url.hostname !== "raw.githubusercontent.com"
      || url.username || url.password || url.port || url.search || url.hash
      || !/^\/[^/]+\/[^/]+\/[a-f0-9]{40}\/.+/.test(url.pathname)) throw new Error("Invalid immutable document source");
    ids.add(doc.id);
  }
  return corpus;
}
type DocumentObservation = { document_id: string; title: string; content: string; sha256: string; corpusHash: string };
export class DocumentReadExecutor implements ReadExecutor {
  readonly corpus: DocumentCorpus;
  private frame?: ExecutionFrame;
  private fetched = new Map<string, string>();
  private readonly documents: Map<string, CorpusDocument>;
  constructor(corpus: DocumentCorpus, private scope: Scope, private options: {
    fetch?: typeof fetch; authorize?: () => boolean; record?: (event: Record<string, unknown>) => void; maxBytes?: number;
  } = {}) {
    this.corpus = verifyDocumentCorpus(corpus);
    this.documents = new Map(this.corpus.documents.map(doc => [doc.id, doc]));
    if (scope.toolSchemaHash !== hash(DOCUMENT_TOOLS)) throw new Error("Document tool schema mismatch");
  }
  updateFrame(frame: ExecutionFrame) {
    if (hash(frame.scope) !== hash(this.scope)) throw new ReadAuthorizationDeniedError("Document scope changed");
    this.frame = copy(frame);
  }
  private allowed(i: Invocation) { return hash(i.scope) === hash(this.scope) && (this.options.authorize?.() ?? true); }
  private mayRead(i: Invocation): boolean {
    return this.allowed(i) && i.tool === "fetch_document" && Object.keys(i.arguments).length === 1
      && typeof i.arguments.document_id === "string" && this.documents.has(i.arguments.document_id)
      && !!this.frame && documentCandidates(this.frame, true).some(candidate => hash(candidate.invocation) === hash(i));
  }
  eligible(i: Invocation): boolean { return this.mayRead(i) && !!this.frame && documentCandidates(this.frame).some(candidate => hash(candidate.invocation) === hash(i)); }
  async read(i: Invocation, signal: AbortSignal): Promise<Json> {
    if (!this.mayRead(i)) throw new ReadAuthorizationDeniedError("Document invocation lacks current visible binding");
    signal.throwIfAborted();
    const doc = this.documents.get(i.arguments.document_id as string)!;
    const start = performance.now();
    this.options.record?.({ type: "document_physical_started", invocationHash: hash(i) });
    try {
      const response = await (this.options.fetch ?? fetch)(doc.url, { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]), redirect: "error", cache: "no-store" });
      if (!response.ok || !response.body) throw new Error(`Document HTTP failure ${response.status}`);
      const maxBytes = this.options.maxBytes ?? 1048576;
      if (Number(response.headers.get("content-length")) > maxBytes) { await response.body.cancel(); throw new Error("Document exceeds byte budget"); }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = []; let bytes = 0;
      try {
        for (;;) {
          const item = await reader.read(); if (item.done) break;
          bytes += item.value.byteLength;
          if (bytes > maxBytes) throw new Error("Document exceeds byte budget");
          chunks.push(item.value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      signal.throwIfAborted();
      const body = Buffer.concat(chunks);
      if (createHash("sha256").update(body).digest("hex") !== doc.sha256) throw new Error("Immutable document content changed");
      if (!this.mayRead(i)) throw new ReadAuthorizationDeniedError("Document authorization changed during read");
      const content = new TextDecoder("utf-8", { fatal: true }).decode(body);
      const observation: DocumentObservation = { document_id: doc.id, title: doc.title, content, sha256: doc.sha256, corpusHash: this.corpus.contentHash };
      this.fetched.set(hash(i), hash(observation));
      return observation;
    } finally { this.options.record?.({ type: "document_physical_completed", invocationHash: hash(i), latencyMs: performance.now() - start }); }
  }
  async validateFreshness(i: Invocation, previous: Json, signal: AbortSignal): Promise<ReadValidation> {
    signal.throwIfAborted();
    this.options.record?.({ type: "document_validation", invocationHash: hash(i), physicalQueries: 0 });
    if (!this.mayRead(i)) return { status: "denied", reason: "Document authorization or binding revoked" };
    const doc = this.documents.get(i.arguments.document_id as string)!;
    const value = previous as DocumentObservation | null;
    if (!value || typeof value !== "object" || typeof value.content !== "string" || value.document_id !== doc.id
      || value.corpusHash !== this.corpus.contentHash || value.sha256 !== doc.sha256
      || createHash("sha256").update(value.content, "utf8").digest("hex") !== doc.sha256
      || this.fetched.get(hash(i)) !== hash(previous)) return { status: "stale", reason: "Missing exact immutable read receipt" };
    return { status: "verified", observation: copy(previous) };
  }
  validationPhysicalCalls() { return 0; }
  async validate(i: Invocation, previous: Json, signal: AbortSignal): Promise<Json> {
    const result = await this.validateFreshness(i, previous, signal);
    if (result.status === "denied") throw new ReadAuthorizationDeniedError(result.reason);
    if (result.status === "stale") throw new Error("Stale document receipt");
    return result.observation;
  }
  search(i: Invocation): Json {
    if (!this.allowed(i) || i.tool !== "search_documents" || Object.keys(i.arguments).length !== 1
      || typeof i.arguments.query !== "string" || !i.arguments.query.trim() || i.arguments.query.length > 2048) throw new ReadAuthorizationDeniedError("Invalid document search");
    const terms = [...new Set(i.arguments.query.toLowerCase().match(/[a-z0-9_]+/g) ?? [])];
    return this.corpus.documents.map(doc => ({ doc, score: terms.reduce((sum, term) => sum + Number(`${doc.title} ${doc.snippet}`.toLowerCase().includes(term)), 0) }))
      .filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.doc.id.localeCompare(b.doc.id)).slice(0, 12)
      .map(({ doc }) => ({ document_id: doc.id, title: doc.title, snippet: doc.snippet }));
  }
}
export function documentCandidates(frame: ExecutionFrame, includeCompleted = false): Candidate[] {
  const found: Candidate[] = [];
  const completed = new Set(Object.entries(frame.sources).filter(([key]) => key.startsWith("observation:")).map(([, value]) => value)
    .filter((value): value is Record<string, Json> => !!value && typeof value === "object" && !Array.isArray(value)
      && typeof value.document_id === "string" && typeof value.content === "string" && typeof value.sha256 === "string")
    .map(value => value.document_id as string));
  for (const [sourceId, value] of Object.entries(frame.sources)) {
    if (!sourceId.startsWith("observation:") || !Array.isArray(value)) continue;
    for (let index = 0; index < value.length && found.length < 128; index++) {
      const row = value[index];
      if (!row || typeof row !== "object" || Array.isArray(row) || typeof row.document_id !== "string" || !includeCompleted && completed.has(row.document_id)) continue;
      const invocation: Invocation = { tool: "fetch_document", arguments: { document_id: row.document_id }, scope: copy(frame.scope) };
      found.push({ schemaVersion: 1, id: hash(invocation), invocation, probability: 0, bindings: [{ sourceId, path: [index, "document_id"] }], hop: 1, patternId: null });
    }
  }
  return [...new Map(found.map(candidate => [candidate.id, candidate])).values()];
}
export function validateDocumentBinding(candidate: Candidate, frame: ExecutionFrame): boolean {
  try {
    return candidate.invocation.tool === "fetch_document" && candidate.bindings.length === 1
      && candidate.bindings[0].sourceId.startsWith("observation:")
      && resolveSource(candidate.bindings[0], frame.sources) === candidate.invocation.arguments.document_id
      && documentCandidates(frame).some(item => hash(item.invocation) === hash(candidate.invocation));
  } catch { return false; }
}
