import type { Response, ResponseCreateParamsNonStreaming, ResponseInputItem } from "openai/resources/responses/responses";
import { copy } from "./canonical";
import { BudgetLedger, type Allocation } from "./budget";
import Ajv2020 from "ajv/dist/2020";

export const RESEARCH_MODELS = {
  actor: "gpt-5.4-2026-03-05", teacher: "gpt-5.4-2026-03-05",
  goal: "gpt-4.1-mini-2025-04-14", candidate: "gpt-4.1-mini-2025-04-14", user: "gpt-4.1-mini-2025-04-14",
  embedding: "text-embedding-3-small", dimensions: 1536,
} as const;
export interface ModelRequest {
  id: string; model: string; input: ResponseInputItem[]; instructions: string;
  tools?: ResponseCreateParamsNonStreaming["tools"]; maxOutputTokens: number;
  reasoning?: "low" | "medium" | "high";
  responseFormat?: { name: string; schema: Record<string, unknown>; strict: true };
  allocation: Allocation; maximumAttemptMicrodollars: number; retries: number;
  // Undefined preserves the legacy transport retry policy. A supplied list
  // restricts retries to transport failures without any recorded HTTP status.
  retryableCauseCodes?: readonly string[];
}
export interface ModelResult {
  model: string; continuation: ResponseInputItem[];
  calls: { id: string; name: string; arguments: Record<string, unknown> }[];
  text: string; status: string; refusals: string[]; usage: Response["usage"];
}
export interface ModelPort { complete(request: ModelRequest): Promise<ModelResult> }

// Keep operational diagnostics without copying request bodies, headers or keys.
export function providerFailure(error: unknown) {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const safe = (field: unknown) => typeof field === "string" && /^[A-Za-z0-9_.:-]{1,160}$/.test(field)
    && !/^sk-/.test(field) ? field : null;
  const className = (object: Record<string, unknown>) => safe(Object.getPrototypeOf(object)?.constructor?.name);
  const seen = new Set<unknown>([error]);
  let cause: unknown = value.cause, causeCode: string | null = null, causeType: string | null = null;
  for (let depth = 0; depth < 3 && cause && typeof cause === "object" && !seen.has(cause); depth++) {
    seen.add(cause);
    const nested = cause as Record<string, unknown>;
    causeCode ??= safe(nested.code);
    causeType ??= className(nested) ?? safe(nested.name);
    cause = nested.cause;
  }
  // SDK subclasses inherit Error.name, while the Node SDK spells requestID in
  // camel case. Preserve both the legacy name and the actual exception class.
  return { errorType: safe(value.name), errorClass: className(value),
    status: Number.isInteger(value.status) && Number(value.status) >= 100 && Number(value.status) <= 599 ? value.status : null,
    code: safe(value.code), requestId: safe(value.requestID) ?? safe(value.request_id) ?? safe(value._request_id),
    causeCode, causeType };
}

export function parseArguments(raw: string): Record<string, unknown> {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Tool arguments must be a JSON object");
  return copy(value) as Record<string, unknown>;
}

// The transport must disable SDK retries. Every physical attempt is reserved here.
export class ResponsesModelPort implements ModelPort {
  constructor(
    private transport: (params: ResponseCreateParamsNonStreaming) => Promise<Response>,
    private ledger: BudgetLedger,
    private billedCost: (response: Response) => number,
    private record: (event: Record<string, unknown>) => void,
    private beforeDispatch: () => void = () => {},
  ) {}
  async complete(request: ModelRequest): Promise<ModelResult> {
    if (!request.model || !Number.isInteger(request.retries) || request.retries < 0 || request.retries > 3 || !Number.isInteger(request.maxOutputTokens) || request.maxOutputTokens < 1) throw new Error("Invalid model request");
    if (request.retryableCauseCodes !== undefined && (!Array.isArray(request.retryableCauseCodes)
      || request.retryableCauseCodes.some(code => typeof code !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(code)))) throw new Error("Invalid retry cause policy");
    // Reserve all possible attempts before sending the first request.
    this.beforeDispatch();
    const reservation = request.id;
    this.ledger.reserve(reservation, request.allocation, request.maximumAttemptMicrodollars * (request.retries + 1));
    let actual = 0;
    let unknown = false;
    for (let attempt = 0; attempt <= request.retries; attempt++) {
      if (attempt > 0) {
        // Host health may change during the first request or retry delay. A
        // blocked retry is not another provider attempt; retain the unknown
        // request's existing maximum instead of fabricating usage settlement.
        try { this.beforeDispatch(); }
        catch (error) {
          this.record({ type: "model_retry_blocked", id: request.id, model: request.model, attempt,
            reason: "before_dispatch_failed", reservationRetained: true, ...providerFailure(error) });
          throw error;
        }
      }
      const started = Date.now();
      let response: Response;
      try {
        response = await this.transport({ model: request.model, instructions: request.instructions,
          input: copy(request.input), tools: request.tools, max_output_tokens: request.maxOutputTokens,
          ...(request.reasoning ? { reasoning: { effort: request.reasoning } } : {}),
          ...(request.responseFormat ? { text: { format: { type: "json_schema" as const, ...copy(request.responseFormat) } } } : {}), store: false });
      } catch (error) {
        unknown = true;
        const failure = providerFailure(error);
        this.record({ type: "model_attempt_failed", id: request.id, model: request.model, attempt, latencyMs: Date.now() - started, reservationRetained: true, ...failure });
        const filtered = request.retryableCauseCodes !== undefined;
        const code = failure.causeCode ?? failure.code;
        const eligible = !filtered || failure.status === null && code !== null && request.retryableCauseCodes!.includes(code);
        const retry = attempt < request.retries && eligible;
        const delayMs = retry && filtered ? 100 : 0;
        this.record({ type: "model_retry_decision", id: request.id, model: request.model, attempt, retry,
          reason: attempt >= request.retries ? "attempt_budget_exhausted" : !eligible ? "cause_not_retryable"
            : filtered ? "retryable_transport_cause" : "legacy_transport_retry",
          delayMs, causeCode: code, status: failure.status, reservationRetained: true });
        if (!retry) throw error;
        if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
      const cost = this.billedCost(response);
      if (!Number.isSafeInteger(cost) || cost < 0) throw new Error("Invalid billed cost; reservation retained");
      actual += cost;
      const refusals = response.output.flatMap(item => item.type === "message" ? item.content.flatMap(part => part.type === "refusal" ? [part.refusal] : []) : []);
      this.record({ type: "model_attempt", id: request.id, model: response.model, requestedModel: request.model, attempt, latencyMs: Date.now() - started, usage: response.usage ?? null, status: response.status, incomplete: response.incomplete_details ?? null, refusals, costMicrodollars: cost });
      if (!unknown) this.ledger.settle(reservation, actual);
      if (response.model !== request.model) throw new Error(`Provider returned unexpected model: ${response.model}`);
      const calls: ModelResult["calls"] = [];
      for (const item of response.output) {
        if (item.type === "function_call") {
          const args = parseArguments(item.arguments);
          if (request.tools) {
            const definition = request.tools.find(tool => tool.type === "function" && tool.name === item.name);
            if (!definition || definition.type !== "function" || !new Ajv2020({ strict: false }).compile(definition.parameters ?? {})(args)) throw new Error("Model tool call violates advertised schema");
          }
          calls.push({ id: item.call_id, name: item.name, arguments: args });
        }
      }
      if (new Set(calls.map(c => c.id)).size !== calls.length) throw new Error("Duplicate provider call IDs");
      // Incomplete responses are recorded but never dispatched as valid tool calls.
      if (response.status !== "completed") throw new Error(`Model response ${response.status}`);
      if (request.responseFormat && !refusals.length) {
        if (calls.length || !new Ajv2020({ strict: false }).compile(request.responseFormat.schema)(JSON.parse(response.output_text))) throw new Error("Model response violates requested output schema");
      }
      return { model: response.model, continuation: copy(response.output) as ResponseInputItem[], calls, text: response.output_text, status: response.status, refusals, usage: response.usage };
    }
    throw new Error("Unreachable");
  }
}
