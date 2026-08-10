import OpenAI from "openai";
import { DERYA_AI_MODEL } from "@/lib/gpt56-client";

const MAX_INSTRUCTION_LENGTH = 2_000;
const MAX_COMPANY_LENGTH = 160;
const MAX_HISTORY_MESSAGES = 12;
const MAX_STEPS = 8;

export type AutomationChatMessage = {
  role: "operator" | "derya";
  body: string;
};

export type AutomationChatDraft = {
  name: string;
  purpose: string;
  steps: string[];
};

export type AutomationChatRequest = {
  company: string;
  instruction: string;
  selectedAutomation: AutomationChatDraft;
  messages: AutomationChatMessage[];
};

export type AutomationChatResult = {
  action: "create" | "update" | "reply";
  reply: string;
  automation: AutomationChatDraft | null;
};

const AUTOMATION_CHAT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["action", "reply", "automation"],
  properties: {
    action: { type: "string", enum: ["create", "update", "reply"] },
    reply: { type: "string" },
    automation: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["name", "purpose", "steps"],
          properties: {
            name: { type: "string" },
            purpose: { type: "string" },
            steps: {
              type: "array",
              minItems: 3,
              maxItems: MAX_STEPS,
              items: { type: "string" },
            },
          },
        },
      ],
    },
  },
} as const;

export class AutomationChatError extends Error {
  constructor(
    message: string,
    public readonly code: "invalid_input" | "unavailable" | "invalid_response",
  ) {
    super(message);
    this.name = "AutomationChatError";
  }
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string"
    ? value.replace(/\u2014/g, "-").replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeDraft(value: unknown): AutomationChatDraft | null {
  if (!isRecord(value)) return null;
  const name = cleanText(value.name, 80);
  const purpose = cleanText(value.purpose, 160);
  const steps = Array.isArray(value.steps)
    ? value.steps.map((step) => cleanText(step, 240)).filter(Boolean).slice(0, MAX_STEPS)
    : [];
  if (!name || !purpose || steps.length < 3) return null;
  return { name, purpose, steps };
}

export function normalizeAutomationChatRequest(value: unknown): AutomationChatRequest {
  if (!isRecord(value)) {
    throw new AutomationChatError("Automation instruction is required.", "invalid_input");
  }
  const company = cleanText(value.company, MAX_COMPANY_LENGTH);
  const instruction = cleanText(value.instruction, MAX_INSTRUCTION_LENGTH);
  const selectedAutomation = normalizeDraft(value.selectedAutomation);
  const messages = Array.isArray(value.messages)
    ? value.messages.slice(-MAX_HISTORY_MESSAGES).flatMap((message) => {
      if (!isRecord(message) || (message.role !== "operator" && message.role !== "derya")) return [];
      const body = cleanText(message.body, 1_000);
      return body ? [{ role: message.role, body } as AutomationChatMessage] : [];
    })
    : [];

  if (!company || !instruction || !selectedAutomation) {
    throw new AutomationChatError("Automation instruction is incomplete.", "invalid_input");
  }
  return { company, instruction, selectedAutomation, messages };
}

export function parseAutomationChatResult(value: unknown): AutomationChatResult {
  if (!isRecord(value) || !["create", "update", "reply"].includes(String(value.action))) {
    throw new AutomationChatError("The workflow draft could not be read.", "invalid_response");
  }
  const action = value.action as AutomationChatResult["action"];
  const reply = cleanText(value.reply, 360);
  const automation = value.automation === null ? null : normalizeDraft(value.automation);
  if (!reply || (action !== "reply" && !automation) || (action === "reply" && automation)) {
    throw new AutomationChatError("The workflow draft could not be read.", "invalid_response");
  }
  return { action, reply, automation };
}

function hasApprovalGate(draft: AutomationChatDraft) {
  return draft.steps.some((step) => /approval|review|sign.?off/i.test(step));
}

function requiresApprovalGate(draft: AutomationChatDraft) {
  return /send|message|email|outreach|file|filing|book|booking|purchase|spend|pay|write|record|customs/i.test(
    `${draft.name} ${draft.purpose} ${draft.steps.join(" ")}`,
  );
}

export function enforceAutomationApprovalBoundary(
  result: AutomationChatResult,
  selectedAutomation: AutomationChatDraft,
): AutomationChatResult {
  if (!result.automation) return result;
  const mustKeepExistingGate = result.action === "update" && hasApprovalGate(selectedAutomation);
  if ((!mustKeepExistingGate && !requiresApprovalGate(result.automation)) || hasApprovalGate(result.automation)) {
    return result;
  }
  return {
    ...result,
    automation: {
      ...result.automation,
      steps: [
        ...result.automation.steps.slice(0, MAX_STEPS - 1),
        "Wait for explicit operator approval",
      ],
    },
  };
}

export async function draftAutomationWithGpt(value: unknown): Promise<AutomationChatResult> {
  const input = normalizeAutomationChatRequest(value);
  if (!process.env.OPENAI_API_KEY) {
    throw new AutomationChatError("Workflow drafting is not configured.", "unavailable");
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 45_000, maxRetries: 1 });
  let response: Awaited<ReturnType<typeof client.responses.create>>;
  try {
    response = await client.responses.create({
      model: DERYA_AI_MODEL,
      reasoning: { effort: "medium" },
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "supply_os_automation_chat",
          strict: true,
          schema: AUTOMATION_CHAT_SCHEMA,
        },
      },
      instructions: [
        "You edit inactive freight and supply-chain workflow drafts inside Derya.",
        "Interpret the operator's latest instruction using the selected automation and recent conversation.",
        "Use action create for a distinct new workflow, update when changing the selected workflow, and reply only for a question that does not require changing a draft.",
        "For create or update, return the complete workflow with a specific two-to-seven-word name, one factual purpose sentence, and three to eight ordered action steps.",
        "Use concrete freight operations language. Do not write generic assistant filler, praise, slogans, or repeat the interface instructions.",
        "Never claim that you executed, sent, filed, booked, purchased, authorized spend, or changed a canonical record.",
        "External messages, customs filings, bookings, record writes, and spend must be prepared as drafts and followed by an explicit operator or licensed-review approval step.",
        "Do not silently remove an existing approval gate when updating a workflow.",
        "Keep the reply to one or two short sentences that state what changed or answer the question.",
        "Do not use the em dash character. Use a comma, period, colon, or plain hyphen.",
      ].join("\n"),
      input: JSON.stringify({
        company: input.company,
        selectedAutomation: input.selectedAutomation,
        recentConversation: input.messages,
        operatorInstruction: input.instruction,
      }),
      store: false,
    });
  } catch {
    throw new AutomationChatError("Workflow drafting did not finish. Try again.", "unavailable");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.output_text);
  } catch {
    throw new AutomationChatError("The workflow draft could not be read.", "invalid_response");
  }
  return enforceAutomationApprovalBoundary(parseAutomationChatResult(parsed), input.selectedAutomation);
}
