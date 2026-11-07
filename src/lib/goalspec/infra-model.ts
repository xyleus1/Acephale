import Ajv2020 from "ajv/dist/2020";
import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import { canonical, copy, hash } from "./canonical";

export interface InfraFunctionTool {
  type: "function";
  function: { name: string; description?: string; parameters: Record<string, unknown>; strict?: boolean };
}
export interface InfraWireCall { id: string; type: "function"; function: { name: string; arguments: string } }
export type InfraChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: InfraWireCall[]; refusal?: string | null }
  | { role: "tool"; tool_call_id: string; content: string };
export type InfraAssistantMessage = Extract<InfraChatMessage, { role: "assistant" }>;
export interface InfraModelRequest {
  id: string;
  messages: InfraChatMessage[];
  tools?: InfraFunctionTool[];
  maxOutputTokens: number;
  seed?: number;
  signal?: AbortSignal;
  responseFormat?: { name: string; schema: Record<string, unknown>; strict: true };
  // Only complete old assistant/tool groups may be optional. All user and policy messages remain mandatory.
  optionalGroups?: { id: string; messageIndexes: number[] }[];
}
export interface InfraUsage { prompt_tokens: number; completion_tokens: number; total_tokens: number }
export interface InfraModelResult {
  model: string;
  text: string;
  calls: { id: string; name: string; arguments: Record<string, unknown> }[];
  continuation: InfraAssistantMessage;
  usage: InfraUsage | null;
  status: "completed";
  refusals: string[];
  inputHash: string;
  inputTokens: number;
  compiler: { version: "goalspec-local-input-v1"; selectedMessageIndexes: number[]; omittedGroups: string[]; tokenizerCalls: number };
  timing: { totalMs: number; tokenizerMs: number; dispatchToHeadersMs: number; firstTokenMs: number | null; generationMs: number };
}
export interface InfraModelEvent {
  type: string; requestId: string; model: string; clockId: string; utc: string; monotonicNs: string;
  [key: string]: unknown;
}
export interface LocalChatModelConfiguration {
  baseUrl: string;
  model: string;
  contextWindow?: number;
  inputBudget?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  stream?: boolean;
  fetch?: typeof globalThis.fetch;
  record?: (event: InfraModelEvent) => void;
}

const clockId = `node:${process.pid}:${randomUUID()}`;
const ajv = new Ajv2020({ strict: false, allErrors: true });
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const milliseconds = (start: bigint) => Number(process.hrtime.bigint() - start) / 1e6;
const safeInteger = (value: unknown, minimum = 0): value is number => Number.isSafeInteger(value) && Number(value) >= minimum;

export class InfraModelError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "InfraModelError"; }
}
function fail(code: string, message: string): never { throw new InfraModelError(code, message); }

/** Reject protocol errors before tokenization, including fabricated tool results and reused IDs. */
export function validateInfraMessages(messages: readonly InfraChatMessage[]): void {
  if (!Array.isArray(messages) || !messages.length) fail("invalid_history", "Actor history is empty");
  const seen = new Set<string>(), pending = new Set<string>();
  for (const message of messages) {
    if (!message || !["system", "user", "assistant", "tool"].includes(message.role)) fail("invalid_history", "Unknown message role");
    if (message.role === "tool") {
      if (typeof message.content !== "string" || !pending.delete(message.tool_call_id)) fail("invalid_history", "Tool result has no matching real call ID");
      continue;
    }
    if (pending.size) fail("invalid_history", "Unresolved calls before a non-tool message");
    if (message.role !== "assistant") {
      if (typeof message.content !== "string") fail("invalid_history", "Message content must be text");
      continue;
    }
    if (message.content !== null && typeof message.content !== "string") fail("invalid_history", "Assistant content must be text or null");
    for (const call of message.tool_calls ?? []) {
      if (!call.id || seen.has(call.id) || call.type !== "function" || !call.function?.name) fail("invalid_history", "Invalid or duplicate tool call ID");
      parseObjectArguments(call.function.arguments);
      seen.add(call.id); pending.add(call.id);
    }
  }
  if (pending.size) fail("invalid_history", "Unresolved calls at actor checkpoint");
  canonical(messages);
}

function parseObjectArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") fail("malformed_arguments", "Tool arguments must be serialized JSON");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { fail("malformed_arguments", "Tool arguments are malformed JSON"); }
  if (!isObject(value)) fail("malformed_arguments", "Tool arguments must be a JSON object");
  try { return copy(value); } catch { return fail("malformed_arguments", "Tool arguments are outside the canonical JSON domain"); }
}

function parseUsage(value: unknown): InfraUsage | null {
  if (value == null) return null;
  if (!isObject(value) || !safeInteger(value.prompt_tokens) || !safeInteger(value.completion_tokens)
    || !safeInteger(value.total_tokens) || value.total_tokens !== value.prompt_tokens + value.completion_tokens) {
    fail("invalid_usage", "Provider returned invalid token usage");
  }
  return { prompt_tokens: value.prompt_tokens, completion_tokens: value.completion_tokens, total_tokens: value.total_tokens };
}

/** One physical generation attempt. No automatic retries or model substitutions. */
export class LocalChatModelPort {
  readonly model: string;
  readonly inputBudget: number;
  readonly contextWindow: number;
  private readonly endpoint: URL;
  private readonly transport: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly maxOutputTokens: number;
  private readonly stream: boolean;
  private readonly client: OpenAI;
  constructor(private readonly configuration: LocalChatModelConfiguration) {
    this.endpoint = new URL(configuration.baseUrl);
    if (!["http:", "https:"].includes(this.endpoint.protocol) || this.endpoint.username || this.endpoint.password
      || this.endpoint.search || this.endpoint.hash) fail("configuration", "Model endpoint must be a credential-free HTTP URL");
    this.endpoint.pathname = this.endpoint.pathname.replace(/\/v1\/?$/, "").replace(/\/$/, "");
    this.model = configuration.model;
    this.contextWindow = configuration.contextWindow ?? 32768;
    this.inputBudget = configuration.inputBudget ?? 28672;
    this.maxOutputTokens = configuration.maxOutputTokens ?? 4096;
    this.timeoutMs = configuration.timeoutMs ?? 120000;
    this.stream = configuration.stream ?? true;
    if (!this.model || !safeInteger(this.contextWindow, 1) || !safeInteger(this.inputBudget, 1)
      || !safeInteger(this.maxOutputTokens, 1) || this.inputBudget + this.maxOutputTokens > this.contextWindow
      || !safeInteger(this.timeoutMs, 1)) fail("configuration", "Invalid model context or deadline configuration");
    this.transport = configuration.fetch ?? globalThis.fetch;
    this.client = new OpenAI({ apiKey: "local-no-secret", baseURL: this.url("/v1"),
      maxRetries: 0, timeout: this.timeoutMs, fetch: this.transport });
  }

  private emit(id: string, type: string, detail: Record<string, unknown> = {}) {
    this.configuration.record?.({ ...detail, type, requestId: id, model: this.model, clockId,
      utc: new Date().toISOString(), monotonicNs: process.hrtime.bigint().toString() });
  }
  private url(path: string) { return `${this.endpoint.toString().replace(/\/$/, "")}${path}`; }

  /** Uses the serving tokenizer and frozen template; does not dispatch generation. */
  async measureInputTokens(messages: InfraChatMessage[], signal?: AbortSignal, tools: InfraFunctionTool[] = []): Promise<number> {
    validateInfraMessages(messages);
    const requestId = `measure:${randomUUID()}`, started = process.hrtime.bigint();
    const deadline = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    combined.throwIfAborted();
    this.emit(requestId, "model_tokenizer_started", { purpose: "candidate_window" });
    const response = await this.transport(this.url("/tokenize"), { method: "POST", signal: combined,
      headers: { "content-type": "application/json" }, body: JSON.stringify({ model: this.model, messages,
        ...(tools.length ? { tools } : {}), add_generation_prompt: true, add_special_tokens: false,
        chat_template_kwargs: { enable_thinking: false } }) });
    if (!response.ok) fail("tokenizer_http", `Tokenizer returned HTTP ${response.status}`);
    const value: unknown = await response.json();
    if (!isObject(value) || !safeInteger(value.count) || !safeInteger(value.max_model_len, 1)
      || !Array.isArray(value.tokens) || value.tokens.length !== value.count
      || value.tokens.some(token => !safeInteger(token))) fail("tokenizer_protocol", "Invalid tokenizer response");
    if (value.max_model_len < this.contextWindow) fail("tokenizer_context", "Serving context is smaller than the manifest context");
    this.emit(requestId, "model_tokenizer_completed", { purpose: "candidate_window", inputTokens: value.count, latencyMs: milliseconds(started) });
    return value.count;
  }

  async complete(request: InfraModelRequest): Promise<InfraModelResult> {
    const started = process.hrtime.bigint();
    if (!request.id || !safeInteger(request.maxOutputTokens, 1) || request.maxOutputTokens > this.maxOutputTokens
      || request.seed !== undefined && !safeInteger(request.seed)) fail("invalid_request", "Invalid model request identity or output budget");
    validateInfraMessages(request.messages);
    const tools = copy(request.tools ?? []);
    const validators = new Map<string, ReturnType<typeof ajv.compile>>();
    for (const tool of tools) {
      if (tool.type !== "function" || !tool.function?.name || validators.has(tool.function.name)
        || !isObject(tool.function.parameters)) fail("invalid_tools", "Tool definitions must have unique function names and schemas");
      validators.set(tool.function.name, ajv.compile(tool.function.parameters));
    }
    const outputValidator = request.responseFormat ? ajv.compile(request.responseFormat.schema) : undefined;
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.signal?.addEventListener("abort", abort, { once: true });
    if (request.signal?.aborted) controller.abort();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
    timer.unref();
    let dispatched = false, tokenizerCalls = 0, tokenizerMs = 0, inputTokens = 0;
    const selected = new Set(request.messages.map((_, index) => index));
    const omittedGroups: string[] = [];
    try {
      this.emit(request.id, "model_request_received", { stream: this.stream, attempt: 0 });
      const optionalGroups = copy(request.optionalGroups ?? []);
      const optionalIndexes = new Set<number>();
      const groupIds = new Set<string>();
      const lastTool = request.messages.map(message => message.role).lastIndexOf("tool");
      for (const group of optionalGroups) {
        if (!group.id || groupIds.has(group.id) || !group.messageIndexes.length) fail("invalid_compiler_group", "Optional groups need unique identities and messages");
        groupIds.add(group.id);
        for (const index of group.messageIndexes) {
          if (!safeInteger(index) || index >= request.messages.length || optionalIndexes.has(index)
            || ["system", "user"].includes(request.messages[index].role) || index === lastTool) {
            fail("invalid_compiler_group", "Policy, requirements, and latest decision evidence are mandatory");
          }
          optionalIndexes.add(index);
        }
        validateInfraMessages(request.messages.filter((_, index) => !group.messageIndexes.includes(index)));
      }
      let messages: InfraChatMessage[] = [];
      while (true) {
        controller.signal.throwIfAborted();
        messages = request.messages.filter((_, index) => selected.has(index)).map(copy);
        validateInfraMessages(messages);
        const tokenStarted = process.hrtime.bigint();
        this.emit(request.id, "model_tokenizer_started", { attempt: tokenizerCalls });
        const response = await this.transport(this.url("/tokenize"), { method: "POST", signal: controller.signal,
          headers: { "content-type": "application/json" }, body: JSON.stringify({ model: this.model, messages,
            ...(tools.length ? { tools } : {}), add_generation_prompt: true, add_special_tokens: false,
            chat_template_kwargs: { enable_thinking: false } }) });
        tokenizerCalls++;
        if (!response.ok) fail("tokenizer_http", `Tokenizer returned HTTP ${response.status}`);
        const tokenization: unknown = await response.json();
        tokenizerMs += milliseconds(tokenStarted);
        if (!isObject(tokenization) || !safeInteger(tokenization.count) || !safeInteger(tokenization.max_model_len, 1)
          || !Array.isArray(tokenization.tokens) || tokenization.tokens.length !== tokenization.count
          || tokenization.tokens.some(token => !safeInteger(token))) fail("tokenizer_protocol", "Invalid tokenizer response");
        if (tokenization.max_model_len < this.contextWindow) fail("tokenizer_context", "Serving context is smaller than the manifest context");
        inputTokens = tokenization.count;
        this.emit(request.id, "model_tokenizer_completed", { inputTokens, latencyMs: milliseconds(tokenStarted) });
        if (inputTokens <= this.inputBudget && inputTokens + request.maxOutputTokens <= this.contextWindow) break;
        const next = optionalGroups.shift();
        if (!next) fail("context_budget", "Mandatory actor input exceeds the tokenizer budget");
        next.messageIndexes.forEach(index => selected.delete(index)); omittedGroups.push(next.id);
      }
      const input = { model: this.model, messages, ...(tools.length ? { tools } : {}), chat_template_kwargs: { enable_thinking: false } };
      const inputHash = hash(input);
      const body = { ...input, max_tokens: request.maxOutputTokens, temperature: 0, top_p: 1, seed: request.seed ?? 0,
        ...(tools.length ? { tool_choice: "auto" } : {}), stream: this.stream,
        ...(this.stream ? { stream_options: { include_usage: true } } : {}),
        ...(request.responseFormat ? { response_format: { type: "json_schema", json_schema: request.responseFormat } } : {}) };
      controller.signal.throwIfAborted();
      const dispatchStart = process.hrtime.bigint();
      this.emit(request.id, "model_dispatch", { inputHash, inputTokens, omittedGroups, attempt: 0 });
      dispatched = true;
      // The supported SDK owns HTTP transport. Keep the bounded protocol parser,
      // including terminal SSE and real call-ID validation, on its raw response.
      let response: Response;
      try {
        response = await this.client.chat.completions.create(body as OpenAI.Chat.ChatCompletionCreateParams,
          { signal: controller.signal }).asResponse();
      } catch (error) {
        if (error instanceof OpenAI.APIError && error.status) fail("model_http", `Model returned HTTP ${error.status}`);
        throw error;
      }
      const dispatchToHeadersMs = milliseconds(dispatchStart);
      const providerRequestId = response.headers.get("x-request-id");
      this.emit(request.id, "model_response_headers", { status: response.status, providerRequestId, latencyMs: dispatchToHeadersMs });
      if (!response.ok) fail("model_http", `Model returned HTTP ${response.status}`);
      let firstTokenMs: number | null = null;
      const firstToken = () => {
        if (firstTokenMs !== null) return;
        firstTokenMs = milliseconds(dispatchStart);
        this.emit(request.id, "model_first_token", { latencyMs: firstTokenMs });
      };
      const wire = this.stream ? await readStream(response, this.model, firstToken, controller.signal)
        : readCompletion(await response.json(), this.model);
      controller.signal.throwIfAborted();
      const generationMs = milliseconds(dispatchStart);
      this.emit(request.id, "model_generation_completed", { finishReason: wire.finishReason, usage: wire.usage,
        latencyMs: generationMs, hasRefusal: !!wire.message.refusal });
      if (wire.usage && wire.usage.prompt_tokens !== inputTokens) fail("tokenizer_mismatch", "Generation token usage differs from the compiled tokenizer input");
      if (!["stop", "tool_calls"].includes(wire.finishReason)) fail("incomplete_response", `Model response ended with ${wire.finishReason}`);
      const calls = (wire.message.tool_calls ?? []).map(call => {
        const args = parseObjectArguments(call.function.arguments);
        const validate = validators.get(call.function.name);
        if (!validate || !validate(args)) fail("tool_schema", "Model tool call violates the advertised schema");
        return { id: call.id, name: call.function.name, arguments: args };
      });
      if (calls.length && wire.finishReason !== "tool_calls" || !calls.length && wire.finishReason === "tool_calls") fail("inconsistent_finish", "Finish reason disagrees with tool calls");
      if (new Set(calls.map(call => call.id)).size !== calls.length || calls.some(call => !call.id)) fail("duplicate_calls", "Model returned duplicate or missing call IDs");
      const priorIds = new Set(request.messages.flatMap(message => message.role === "assistant" ? (message.tool_calls ?? []).map(call => call.id) : []));
      if (calls.some(call => priorIds.has(call.id))) fail("duplicate_calls", "Model reused a historical call ID");
      const text = wire.message.content ?? "";
      const refusals = wire.message.refusal ? [wire.message.refusal] : [];
      if (refusals.length && calls.length) fail("refusal_with_calls", "Refused output cannot dispatch tools");
      if (outputValidator && !refusals.length) {
        let value: unknown;
        try { value = JSON.parse(text); } catch { fail("output_schema", "Model response is not structured JSON"); }
        if (calls.length || !outputValidator(value)) fail("output_schema", "Model response violates the requested output schema");
      }
      const result: InfraModelResult = { model: this.model, text, calls, continuation: copy(wire.message), usage: wire.usage,
        refusals, status: "completed", inputHash, inputTokens,
        compiler: { version: "goalspec-local-input-v1", selectedMessageIndexes: [...selected], omittedGroups, tokenizerCalls },
        timing: { totalMs: milliseconds(started), tokenizerMs, dispatchToHeadersMs, firstTokenMs, generationMs } };
      this.emit(request.id, "model_completed", { inputHash, inputTokens, providerRequestId,
        responseHash: hash(result.continuation), usage: result.usage, timing: result.timing });
      return result;
    } catch (error) {
      const code = controller.signal.aborted ? timedOut ? "timeout" : "cancelled"
        : error instanceof InfraModelError ? error.code : "transport_or_protocol";
      this.emit(request.id, code === "cancelled" ? "model_cancelled" : "model_failed", { code, dispatched,
        cancellationConfirmed: false, latencyMs: milliseconds(started), tokenizerCalls });
      if (controller.signal.aborted) throw new InfraModelError(code, `Model request ${code}`);
      if (error instanceof InfraModelError) throw error;
      throw new InfraModelError(code, "Local model transport or protocol failed");
    } finally { clearTimeout(timer); request.signal?.removeEventListener("abort", abort); }
  }
}

interface WireResult { message: InfraAssistantMessage; finishReason: string; usage: InfraUsage | null }
function readCompletion(value: unknown, model: string): WireResult {
  if (!isObject(value) || value.model !== model) fail("model_identity", "Provider returned an unexpected model");
  if (!Array.isArray(value.choices) || value.choices.length !== 1 || !isObject(value.choices[0])) fail("response_protocol", "Expected one model choice");
  const choice = value.choices[0];
  if (choice.index !== 0 || !isObject(choice.message) || choice.message.role !== "assistant"
    || typeof choice.finish_reason !== "string") fail("response_protocol", "Invalid assistant choice");
  const message = parseAssistant(choice.message);
  return { message, finishReason: choice.finish_reason, usage: parseUsage(value.usage) };
}
function parseAssistant(value: Record<string, unknown>): InfraAssistantMessage {
  if (value.content !== null && typeof value.content !== "string" || value.refusal != null && typeof value.refusal !== "string") fail("response_protocol", "Invalid assistant content");
  const message: InfraAssistantMessage = { role: "assistant", content: value.content as string | null };
  if (typeof value.refusal === "string") message.refusal = value.refusal;
  if (value.tool_calls != null) {
    if (!Array.isArray(value.tool_calls)) fail("response_protocol", "Invalid tool call list");
    message.tool_calls = value.tool_calls.map(call => {
      if (!isObject(call) || typeof call.id !== "string" || !call.id || call.type !== "function" || !isObject(call.function)
        || typeof call.function.name !== "string" || !call.function.name || typeof call.function.arguments !== "string") fail("response_protocol", "Invalid tool call");
      return { id: call.id, type: "function", function: { name: call.function.name, arguments: call.function.arguments } };
    });
  }
  return message;
}
async function readStream(response: Response, model: string, firstToken: () => void, signal: AbortSignal): Promise<WireResult> {
  if (!response.headers.get("content-type")?.includes("text/event-stream") || !response.body) fail("stream_protocol", "Expected an SSE response; configure stream=false explicitly for nonstreaming servers");
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "", text = "", refusal = "", finishReason: string | null = null, done = false, usage: InfraUsage | null = null;
  const calls = new Map<number, InfraWireCall>();
  const consume = (event: string) => {
    const data = event.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
    if (!data) return;
    if (done) fail("stream_protocol", "Data followed the completed stream");
    if (data === "[DONE]") { done = true; return; }
    let value: unknown;
    try { value = JSON.parse(data); } catch { fail("stream_protocol", "Malformed stream JSON"); }
    if (!isObject(value) || value.model !== model) fail("model_identity", "Provider returned an unexpected model");
    if (value.usage != null) usage = parseUsage(value.usage);
    if (!Array.isArray(value.choices) || value.choices.length > 1) fail("stream_protocol", "Expected one streamed choice");
    if (!value.choices.length) return;
    const choice: unknown = value.choices[0];
    if (!isObject(choice) || choice.index !== 0 || !isObject(choice.delta)) fail("stream_protocol", "Invalid stream choice");
    const delta = choice.delta;
    if (delta.role != null && delta.role !== "assistant") fail("stream_protocol", "Unexpected stream role");
    if (delta.reasoning || delta.reasoning_content) fail("unexpected_reasoning", "Serving emitted reasoning despite the frozen disabled-thinking profile");
    if (finishReason !== null && (delta.content || delta.refusal || delta.tool_calls)) fail("stream_protocol", "Content followed the finish reason");
    if (delta.content != null) {
      if (typeof delta.content !== "string") fail("stream_protocol", "Invalid content delta");
      text += delta.content; if (delta.content) firstToken();
    }
    if (delta.refusal != null) {
      if (typeof delta.refusal !== "string") fail("stream_protocol", "Invalid refusal delta");
      refusal += delta.refusal; if (delta.refusal) firstToken();
    }
    if (delta.tool_calls != null) {
      if (!Array.isArray(delta.tool_calls)) fail("stream_protocol", "Invalid tool delta list");
      for (const item of delta.tool_calls) {
        if (!isObject(item) || !safeInteger(item.index) || item.index > 127) fail("stream_protocol", "Invalid tool delta index");
        const call = calls.get(item.index) ?? { id: "", type: "function" as const, function: { name: "", arguments: "" } };
        if (item.type != null && item.type !== "function") fail("stream_protocol", "Invalid tool delta type");
        if (item.id != null) {
          if (typeof item.id !== "string" || call.id && call.id !== item.id) fail("stream_protocol", "Tool ID changed during streaming");
          call.id = item.id;
        }
        if (item.function != null) {
          if (!isObject(item.function)) fail("stream_protocol", "Invalid function delta");
          for (const key of ["name", "arguments"] as const) {
            if (item.function[key] != null) {
              if (typeof item.function[key] !== "string") fail("stream_protocol", "Invalid function string delta");
              call.function[key] += item.function[key];
            }
          }
        }
        calls.set(item.index, call); firstToken();
      }
    }
    if (choice.finish_reason != null) {
      if (typeof choice.finish_reason !== "string" || finishReason !== null) fail("stream_protocol", "Invalid finish reason");
      finishReason = choice.finish_reason;
    }
  };
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) { buffer += decoder.decode(); break; }
      buffer += decoder.decode(chunk.value, { stream: true });
      if (buffer.length > 4 * 1024 * 1024 || text.length + refusal.length > 4 * 1024 * 1024) fail("response_size", "Model response exceeds the bounded parser limit");
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) { consume(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2); }
    }
    if (buffer.trim()) consume(buffer);
    if (!done || !finishReason) fail("incomplete_response", "Model stream ended without a terminal event");
    const ordered = [...calls].sort(([a], [b]) => a - b);
    if (ordered.some(([index], position) => index !== position)) fail("stream_protocol", "Tool call indexes are not contiguous");
    const message = parseAssistant({ role: "assistant", content: text || (calls.size ? null : ""),
      ...(calls.size ? { tool_calls: ordered.map(([, call]) => call) } : {}), ...(refusal ? { refusal } : {}) });
    return { message, finishReason, usage };
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
