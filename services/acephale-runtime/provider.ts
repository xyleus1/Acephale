import OpenAI from "openai";
import type { Response } from "openai/resources/responses/responses";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { BudgetLedger, type Allocation } from "../../src/lib/acephale/budget";
import { ResponsesModelPort, RESEARCH_MODELS, providerFailure } from "../../src/lib/acephale/model";
import { countTokens } from "../../src/lib/acephale/tokens";

// Standard public endpoint prices, verified 2026-09-14 against official model pages.
// Units are microdollars per token; cached input and reasoning output are included.
export const PRICE_SOURCE = "https://developers.openai.com/api/docs/pricing";
export const RATES: Record<string, { input: number; cached: number; output: number }> = {
  [RESEARCH_MODELS.actor]: { input: 2.5, cached: 0.25, output: 15 },
  [RESEARCH_MODELS.goal]: { input: 0.4, cached: 0.1, output: 1.6 },
};
export function maximumCost(model: string, input: number, output: number) {
  const rate = RATES[model];
  if (!rate || !Number.isInteger(input) || input < 0 || !Number.isInteger(output) || output < 0) throw new Error("Unsupported price calculation");
  return Math.ceil(input * rate.input + output * rate.output);
}
export function responseCost(response: Response) {
  const rate = RATES[response.model];
  const usage = response.usage;
  if (!rate || !usage || response.service_tier && !["default", "auto"].includes(response.service_tier)) throw new Error("Unpriced provider response");
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  if ([usage.input_tokens, usage.output_tokens, cached].some(n => !Number.isSafeInteger(n) || n < 0) || cached > usage.input_tokens) throw new Error("Invalid usage");
  return Math.ceil((usage.input_tokens - cached) * rate.input + cached * rate.cached + usage.output_tokens * rate.output);
}

export function assertResearchHostReady(now = Date.now()) {
  const path = process.env.ACEPHALE_HOST_STATUS_FILE;
  if (!path) return; // Service deployments may supply their own host management.
  let status: { healthy?: boolean; state?: string; networkConnected?: boolean; observedAtUnixMs?: number; maxStatusAgeMs?: number; heartbeatSequence?: number };
  try {
    let latest = path, sequence: number | undefined;
    if (statSync(path).isDirectory()) {
      // Immutable publications avoid replacing a Windows reader's open file.
      // Temporary writes are invisible; a broken newest publication never falls
      // back to an older healthy heartbeat. Files remain until the run closes.
      const name = readdirSync(path).filter(name => /^\d{16}\.json$/.test(name)).sort().at(-1);
      if (!name) throw new Error("No host heartbeat published");
      latest = join(path, name); sequence = Number(name.slice(0, 16));
    }
    status = JSON.parse(readFileSync(latest, "utf8"));
    if (sequence !== undefined && (!Number.isSafeInteger(sequence) || sequence < 1 || status?.heartbeatSequence !== sequence)) throw new Error("Host heartbeat sequence mismatch");
  } catch { throw new Error("Research host status unavailable"); }
  if (!status || typeof status !== "object" || status.healthy !== true || status.networkConnected !== true
    || typeof status.observedAtUnixMs !== "number" || !Number.isFinite(status.observedAtUnixMs) || status.observedAtUnixMs <= 0
    || typeof status.maxStatusAgeMs !== "number" || !Number.isFinite(status.maxStatusAgeMs) || status.maxStatusAgeMs <= 0) throw new Error("Invalid research host status");
  const age = now - (status.observedAtUnixMs ?? 0);
  if (status.state !== "healthy" || age < -1_000 || age > Math.min(status.maxStatusAgeMs, 3_000)) throw new Error("Research host is degraded or its heartbeat is stale");
}
export class TrialLedger extends BudgetLedger {
  constructor(private global: BudgetLedger, readonly parentId: string, private allocation: Allocation) { super(); }
  reserve(id: string, allocation: Allocation, maximum: number) {
    if (allocation !== this.allocation) throw new Error("Trial allocation mismatch");
    this.global.reserveChild(this.parentId, `${this.parentId}/${id}`, maximum);
  }
  settle(id: string, actual: number) { this.global.settle(`${this.parentId}/${id}`, actual); }
  snapshot() { return this.global.snapshot().filter(row => row.parentId === this.parentId); }
}
export function researchClient(apiKey: string, fetch?: typeof globalThis.fetch) {
  // All research roles use the same transport policy. Closing each HTTP/1.1
  // connection prevents later reuse of that socket, without a second paid
  // attempt. Start each cohort in a new process so no older pooled socket is
  // inherited. Remote TCP/TLS overhead is not measured by the localhost test.
  return new OpenAI({ apiKey, baseURL: "https://api.openai.com/v1", maxRetries: 0, timeout: 120_000,
    defaultHeaders: { Connection: "close" }, ...(fetch ? { fetch } : {}) });
}
export function researchProvider(ledger: BudgetLedger, allocation: Allocation, record: (event: unknown) => void) {
  if (!process.env.OPENAI_API_KEY) throw new Error("Configure OPENAI_API_KEY securely before research dispatch");
  const client = researchClient(process.env.OPENAI_API_KEY);
  const model = new ResponsesModelPort(params => client.responses.create({ ...params, service_tier: "default" }), ledger, responseCost, record, assertResearchHostReady);
  return { model, embed: createBudgetedEmbedding(client, ledger, allocation, record) };
}
export function createBudgetedEmbedding(client: Pick<OpenAI, "embeddings">, ledger: BudgetLedger, allocation: Allocation,
  record: (event: unknown) => void, hostReady: () => void = assertResearchHostReady) {
  return async function embed(text: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    // cl100k token IDs are measured by the API; byte count is a conservative bound
    // for text UTF-8 tokenization and prevents a cheaper unbounded reservation.
    const upperTokens = Buffer.byteLength(text, "utf8");
    if (!text || upperTokens > 8192 || countTokens(text) > 8192) throw new Error("Embedding input exceeds budget");
    const id = `embedding:${randomUUID()}`;
    hostReady();
    ledger.reserve(id, allocation, Math.ceil(upperTokens * 0.02));
    const start = Date.now();
    let response;
    try { response = await client.embeddings.create({ model: RESEARCH_MODELS.embedding, input: text, dimensions: 1536, encoding_format: "float" }, { signal }); }
    catch (error) { record({ type: "embedding_failed", id, latencyMs: Date.now() - start, reservationRetained: true, cancelled: signal?.aborted === true, ...providerFailure(error) }); throw new Error("Embedding request failed; cost reservation retained"); }
    const cost = Math.ceil(response.usage.total_tokens * 0.02);
    ledger.settle(id, cost);
    record({ type: "embedding", id, model: response.model, dimensions: 1536, latencyMs: Date.now() - start, usage: response.usage, costMicrodollars: cost });
    signal?.throwIfAborted();
    const vector = response.data[0]?.embedding;
    if (response.model !== RESEARCH_MODELS.embedding || response.data.length !== 1 || vector?.length !== 1536 || vector.some(n => !Number.isFinite(n))) throw new Error("Unexpected embedding response");
    return vector;
  };
}
