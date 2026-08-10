"use client";

import {
  Check,
  ChevronRight,
  FileText,
  LockKeyhole,
  MessageSquareText,
  Plus,
  Radar,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import styles from "./supply-os-automations.module.css";

type AutomationDefinition = {
  id: string;
  name: string;
  purpose: string;
  icon: LucideIcon;
  steps: string[];
  source: "built-in" | "chat draft";
};

type ChatMessage = {
  id: string;
  role: "operator" | "derya";
  body: string;
};

const BUILT_IN_AUTOMATIONS: AutomationDefinition[] = [
  {
    id: "bill-of-lading",
    name: "Complete bill of lading",
    purpose: "Prepare fields from approved shipment records",
    icon: FileText,
    source: "built-in",
    steps: [
      "Collect approved shipper, consignee, cargo, and routing fields",
      "Flag missing or conflicting shipment data",
      "Prepare a bill of lading draft",
      "Hold the draft for operator review",
    ],
  },
  {
    id: "supplier-search",
    name: "Find suppliers",
    purpose: "Build an evidence-linked qualification list",
    icon: Search,
    source: "built-in",
    steps: [
      "Define product, region, and capacity requirements",
      "Search approved public and company sources",
      "Attach source evidence to each candidate",
      "Rank candidates by fit and open checks",
      "Hold outreach for operator approval",
    ],
  },
  {
    id: "rate-request",
    name: "Request freight rates",
    purpose: "Prepare lane-specific carrier requests",
    icon: Send,
    source: "built-in",
    steps: [
      "Check origin, destination, mode, cargo, and ready date",
      "Build the carrier shortlist for the lane",
      "Prepare one comparable rate request",
      "Hold all messages for operator approval",
    ],
  },
  {
    id: "customs-check",
    name: "Check customs documents",
    purpose: "Find missing fields before filing",
    icon: ShieldCheck,
    source: "built-in",
    steps: [
      "Collect invoice, packing list, origin, and classification records",
      "Compare document fields for conflicts",
      "List missing data and unresolved classifications",
      "Hold filing for licensed review",
    ],
  },
  {
    id: "exception-watch",
    name: "Watch transport exceptions",
    purpose: "Surface late or conflicting milestones",
    icon: Radar,
    source: "built-in",
    steps: [
      "Read current planned and actual milestones",
      "Detect late, missing, or conflicting events",
      "Prepare an operator exception summary",
      "Hold customer and provider messages for approval",
    ],
  },
];

const STARTING_MESSAGES: ChatMessage[] = [
  {
    id: "intro",
    role: "derya",
    body: "What should this workflow do? Choose a template or describe it here, and I will draft the steps for review.",
  },
];

function draftName(message: string) {
  const normalized = message.trim().replace(/^(create|build|make|draft)\s+(a|an|new)?\s*/i, "");
  if (/bill of lading|\bbol\b/i.test(normalized)) return "Complete bill of lading";
  if (/supplier|vendor|source/i.test(normalized)) return "Find and qualify suppliers";
  if (/rate|quote|carrier/i.test(normalized)) return "Collect freight rates";
  if (/customs|tariff|classification|hts/i.test(normalized)) return "Check customs readiness";
  if (/track|milestone|exception|delay/i.test(normalized)) return "Monitor transport exceptions";
  const words = normalized.replace(/[^a-zA-Z0-9\s-]/g, "").split(/\s+/).filter(Boolean).slice(0, 7);
  return words.length ? `${words[0][0]?.toUpperCase() ?? ""}${words[0].slice(1)} ${words.slice(1).join(" ")}`.trim() : "New automation";
}

function draftSteps(message: string) {
  if (/bill of lading|\bbol\b/i.test(message)) return BUILT_IN_AUTOMATIONS[0].steps;
  if (/supplier|vendor|source/i.test(message)) return BUILT_IN_AUTOMATIONS[1].steps;
  if (/rate|quote|carrier/i.test(message)) return BUILT_IN_AUTOMATIONS[2].steps;
  if (/customs|tariff|classification|hts/i.test(message)) return BUILT_IN_AUTOMATIONS[3].steps;
  if (/track|milestone|exception|delay/i.test(message)) return BUILT_IN_AUTOMATIONS[4].steps;
  return [
    "Confirm the trigger, scope, and required records",
    "Collect evidence and identify missing inputs",
    "Prepare the operator output",
    "Hold external actions for operator approval",
  ];
}

function wantsNewAutomation(message: string) {
  return /\b(create|build|make|draft)\b/i.test(message);
}

export function SupplyOsAutomations({ company }: { company: string }) {
  const [automations, setAutomations] = useState(BUILT_IN_AUTOMATIONS);
  const [selectedId, setSelectedId] = useState(BUILT_IN_AUTOMATIONS[0].id);
  const [messages, setMessages] = useState(STARTING_MESSAGES);
  const [message, setMessage] = useState("");
  const selectedAutomation = useMemo(
    () => automations.find((automation) => automation.id === selectedId) ?? automations[0],
    [automations, selectedId],
  );

  function selectAutomation(automation: AutomationDefinition) {
    setSelectedId(automation.id);
    setMessages((current) => [
      ...current,
      {
        id: `selected-${automation.id}-${current.length}`,
        role: "derya",
        body: `${automation.name} selected. Its ${automation.steps.length} draft steps are open on the right.`,
      },
    ]);
  }

  function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const instruction = message.trim();
    if (!instruction) return;

    const operatorMessage: ChatMessage = {
      id: `operator-${Date.now()}`,
      role: "operator",
      body: instruction,
    };

    if (wantsNewAutomation(instruction)) {
      const name = draftName(instruction);
      const automation: AutomationDefinition = {
        id: `draft-${Date.now()}`,
        name,
        purpose: "Created in this browser session",
        icon: Sparkles,
        source: "chat draft",
        steps: [...draftSteps(instruction)],
      };
      setAutomations((current) => [...current, automation]);
      setSelectedId(automation.id);
      setMessages((current) => [
        ...current,
        operatorMessage,
        {
          id: `derya-${Date.now()}`,
          role: "derya",
          body: `${name} is drafted with ${automation.steps.length} steps. Nothing has been activated or sent.`,
        },
      ]);
      setMessage("");
      return;
    }

    if (/approval|review|sign.?off/i.test(instruction)) {
      setAutomations((current) => current.map((automation) => {
        if (automation.id !== selectedAutomation.id) return automation;
        if (automation.steps.some((step) => /approval|review/i.test(step))) return automation;
        return { ...automation, steps: [...automation.steps, "Wait for explicit operator approval"] };
      }));
      setMessages((current) => [
        ...current,
        operatorMessage,
        {
          id: `derya-${Date.now()}`,
          role: "derya",
          body: `The approval gate is included in ${selectedAutomation.name}. The draft is still inactive.`,
        },
      ]);
      setMessage("");
      return;
    }

    setAutomations((current) => current.map((automation) => automation.id === selectedAutomation.id
      ? { ...automation, steps: [...automation.steps, `Operator instruction: ${instruction}`], source: "chat draft" }
      : automation));
    setMessages((current) => [
      ...current,
      operatorMessage,
      {
        id: `derya-${Date.now()}`,
        role: "derya",
        body: `I added that instruction to ${selectedAutomation.name}. Review the updated steps on the right.`,
      },
    ]);
    setMessage("");
  }

  return (
    <section className={`${styles.workspace} supply-os-workspace`} aria-label="Automations workspace">
      <section className={styles.chatPane} aria-label={`Automation chat for ${company}`}>
        <header className={styles.paneHeader}>
          <span>
            <MessageSquareText size={18} aria-hidden="true" />
            <strong id="automation-chat-title">Automation chat</strong>
          </span>
        </header>

        <div className={styles.conversation} aria-live="polite">
          {messages.map((chatMessage) => (
            <article key={chatMessage.id} data-role={chatMessage.role}>
              <small>{chatMessage.role === "operator" ? "You" : "Derya"}</small>
              <p>{chatMessage.body}</p>
            </article>
          ))}
        </div>

        <form className={styles.composer} onSubmit={submitMessage}>
          <label className={styles.visuallyHidden} htmlFor="automation-message">Message</label>
          <div>
            <textarea
              id="automation-message"
              rows={3}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Create a supplier follow-up, add a review gate, or change a step"
            />
            <button type="submit" disabled={!message.trim()} aria-label="Send automation instruction">
              <Send size={16} aria-hidden="true" />
              Send
            </button>
          </div>
          <p><LockKeyhole size={13} aria-hidden="true" /> Browser draft. No message, filing, booking, record, or spend action is executed.</p>
        </form>
      </section>

      <aside className={styles.libraryPane} aria-labelledby="automation-library-title">
        <header className={styles.paneHeader}>
          <span>
            <strong id="automation-library-title">Automations</strong>
            <small>{automations.length}</small>
          </span>
          <button
            type="button"
            onClick={() => setMessage("Create a new automation that ")}
            aria-label="Start a new automation in chat"
          >
            <Plus size={16} aria-hidden="true" />
            New draft
          </button>
        </header>

        <div className={styles.automationList}>
          {automations.map((automation) => {
            const Icon = automation.icon;
            const selected = automation.id === selectedAutomation.id;
            return (
              <button
                key={automation.id}
                type="button"
                data-active={selected}
                aria-pressed={selected}
                onClick={() => selectAutomation(automation)}
              >
                <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
                <span>
                  <strong>{automation.name}</strong>
                  <small>{automation.purpose}</small>
                </span>
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            );
          })}
        </div>

        <section className={styles.stepPlan} aria-labelledby="automation-step-plan-title">
          <header>
            <span>
              <small>{selectedAutomation.source}</small>
              <strong id="automation-step-plan-title">{selectedAutomation.name}</strong>
            </span>
            <i>Draft</i>
          </header>
          <p className={styles.stepPurpose}>{selectedAutomation.purpose}</p>
          <ol>
            {selectedAutomation.steps.map((step, index) => (
              <li key={`${index}-${step}`}>
                <span>{index + 1}</span>
                <p>{step}</p>
                <Check size={14} aria-label="Draft step" />
              </li>
            ))}
          </ol>
        </section>
      </aside>
    </section>
  );
}
