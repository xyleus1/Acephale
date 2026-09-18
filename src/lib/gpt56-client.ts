import OpenAI from "openai";
import type { EvidenceEnvelope } from "./goalspec/contracts/generated";

type RuntimeObservation = { context: string; evidence: EvidenceEnvelope[] };
type ServerContinuation = { output: unknown[]; observation?: RuntimeObservation };

// Next server-action arguments are untrusted at runtime even when the browser
// caller has a TypeScript type. Chat history carries plain dialogue only.
export function parseClientChatHistory(value: unknown): { role: "user" | "assistant"; content: string }[] {
  if (!Array.isArray(value)) throw new Error("Invalid chat history");
  return value.map(item => {
    if (!item || typeof item !== "object" || !["user", "assistant"].includes(item.role)
      || typeof item.content !== "string") throw new Error("Chat history must contain user or assistant text");
    return { role: item.role as "user" | "assistant", content: item.content };
  });
}

export const DERYA_AI_MODEL = "gpt-5.6" as const;
export const DERYA_AI_MODEL_LABEL = "GPT-5.6" as const;
export const DERYA_AI_IDENTITY_REPLY =
  `This Derya Desk Assistant runs on OpenAI ${DERYA_AI_MODEL_LABEL} through the Responses API.`;

export function isDeryaModelIdentityQuestion(input: string): boolean {
  return /\b(?:what|which)\s+(?:ai\s+)?model\b|\bmodel\s+(?:are|do)\s+you\b|\bare you\s+(?:claude|chatgpt|gpt)\b|\bwho made you\b/i.test(
    input
  );
}

type LegacyTextBlock = {
  type: "text";
  text: string;
  _openaiItem?: unknown;
};

type LegacyToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
  _openaiItem?: unknown;
};

type LegacyContentBlock = LegacyTextBlock | LegacyToolUseBlock;

type LegacyMessage = {
  role: "user" | "assistant";
  content: string | Array<Record<string, unknown>>;
};

type LegacyTool = {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
};

type LegacyCreateParams = {
  model?: string;
  max_tokens: number;
  system?: string | Array<{ type?: string; text?: string }>;
  messages: LegacyMessage[];
  tools?: LegacyTool[];
  runtimeObservation?: RuntimeObservation;
  runtimeContextMode?: "legacy" | "current-only";
};

export type Gpt56Message = {
  content: LegacyContentBlock[];
  stop_reason: "tool_use" | "end_turn";
  model: string;
};

function instructionsFromSystem(system: LegacyCreateParams["system"]): string | undefined {
  if (typeof system === "string") return system;
  if (!Array.isArray(system)) return undefined;
  const text = system
    .map((block) => typeof block?.text === "string" ? block.text : "")
    .filter(Boolean)
    .join("\n\n");
  return text || undefined;
}

function parseToolArguments(argumentsJson: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(argumentsJson);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Function arguments must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function responsesInputFromMessages(messages: LegacyMessage[], continuations: WeakMap<object, ServerContinuation>, mode: "legacy" | "current-only" = "legacy"): unknown[] {
  const input: unknown[] = [];

  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") throw new Error("Invalid chat message role");
    if (typeof message.content === "string") {
      input.push({ role: message.role, content: message.content });
      continue;
    }

    if (message.role === "assistant") {
      // Only this client's in-memory response objects own trusted metadata.
      // Private-looking properties and serialized copies carry no authority.
      const continuation = continuations.get(message.content);
      const observation = continuation?.observation;
      if (observation?.context && mode === "legacy") input.push({ role: "developer", content: observation.context });
      const originalOutput = continuation?.output;
      if (originalOutput?.length) {
        input.push(...structuredClone(originalOutput));
        continue;
      }

      for (const block of message.content) {
        if (block.type === "text" && typeof block.text === "string") {
          input.push({ role: "assistant", content: block.text });
        } else if (
          block.type === "tool_use"
          && typeof block.id === "string"
          && typeof block.name === "string"
        ) {
          input.push({
            type: "function_call",
            call_id: block.id,
            name: block.name,
            arguments: JSON.stringify(block.input ?? {}),
          });
        }
      }
      continue;
    }

    const textParts: string[] = [];
    for (const block of message.content) {
      if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
        input.push({
          type: "function_call_output",
          call_id: block.tool_use_id,
          output: typeof block.content === "string"
            ? block.content
            : JSON.stringify(block.content ?? null),
        });
      } else if (block.type === "text" && typeof block.text === "string") {
        textParts.push(block.text);
      }
    }
    if (textParts.length) input.push({ role: "user", content: textParts.join("\n") });
  }

  return input;
}

function responsesTools(tools: LegacyTool[] | undefined): unknown[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema,
    strict: false,
  }));
}

export default class Gpt56Client {
  private readonly client: OpenAI;
  private readonly continuations = new WeakMap<object, ServerContinuation>();

  readonly messages: {
    create: (params: LegacyCreateParams) => Promise<Gpt56Message>;
  };

  constructor(options: { apiKey: string; fetch?: typeof globalThis.fetch }) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      timeout: 45_000,
      maxRetries: 1,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
    this.messages = {
      create: (params) => this.createMessage(params),
    };
  }

  private async createMessage(params: LegacyCreateParams): Promise<Gpt56Message> {
    // Snapshot before dispatch, preserving exactly the observation this turn
    // saw even if a concurrent caller advances its runtime boundary.
    const observation = params.runtimeObservation?.context.trim()
      ? structuredClone(params.runtimeObservation) : undefined;
    const input = responsesInputFromMessages(params.messages, this.continuations, params.runtimeContextMode);
    if (observation) input.push({ role: "developer", content: observation.context });
    const response = await this.client.responses.create({
      model: params.model ?? DERYA_AI_MODEL,
      instructions: instructionsFromSystem(params.system),
      input: input as never,
      tools: responsesTools(params.tools) as never,
      max_output_tokens: Math.max(params.max_tokens, params.tools?.length ? 1_024 : 512),
      reasoning: { effort: params.tools?.length ? "medium" : "low" },
      store: false,
    });

    const content: LegacyContentBlock[] = [];
    const messageItem = response.output.find((item) => item.type === "message");
    if (response.output_text) {
      content.push({
        type: "text",
        text: response.output_text,
        _openaiItem: messageItem,
      });
    }

    for (const item of response.output) {
      if (item.type !== "function_call") continue;
      content.push({
        type: "tool_use",
        id: item.call_id,
        name: item.name,
        input: parseToolArguments(item.arguments),
        _openaiItem: item,
      });
    }

    Object.defineProperty(content, "_openaiOutput", {
      value: response.output,
      enumerable: false,
    });
    if (observation) Object.defineProperty(content, "_goalspecObservation", {
      value: structuredClone(observation),
      enumerable: false,
    });
    this.continuations.set(content, { output: structuredClone(response.output), observation });

    return {
      content,
      stop_reason: content.some((block) => block.type === "tool_use") ? "tool_use" : "end_turn",
      model: response.model,
    };
  }
}
