"use client";

import {
  Check,
  ChevronRight,
  FileText,
  LoaderCircle,
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

const STARTING_MESSAGES: ChatMessage[] = [];

type AutomationChatResponse = {
  result?: {
    action: "create" | "update" | "reply";
    reply: string;
    automation: Pick<AutomationDefinition, "name" | "purpose" | "steps"> | null;
  };
  error?: string;
};

export function SupplyOsAutomations({ company }: { company: string }) {
  const [automations, setAutomations] = useState(BUILT_IN_AUTOMATIONS);
  const [selectedId, setSelectedId] = useState(BUILT_IN_AUTOMATIONS[0].id);
  const [messages, setMessages] = useState(STARTING_MESSAGES);
  const [message, setMessage] = useState("");
  const [isDrafting, setIsDrafting] = useState(false);
  const selectedAutomation = useMemo(
    () => automations.find((automation) => automation.id === selectedId) ?? automations[0],
    [automations, selectedId],
  );

  function selectAutomation(automation: AutomationDefinition) {
    setSelectedId(automation.id);
  }

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const instruction = message.trim();
    if (!instruction || isDrafting) return;

    const operatorMessage: ChatMessage = {
      id: `operator-${Date.now()}`,
      role: "operator",
      body: instruction,
    };
    const nextMessages = [...messages, operatorMessage];
    setMessages(nextMessages);
    setMessage("");
    setIsDrafting(true);

    try {
      const response = await fetch("/api/supply-os/automations/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          company,
          instruction,
          selectedAutomation: {
            name: selectedAutomation.name,
            purpose: selectedAutomation.purpose,
            steps: selectedAutomation.steps,
          },
          messages: messages.map(({ role, body }) => ({ role, body })),
        }),
      });
      const payload = await response.json().catch(() => null) as AutomationChatResponse | null;
      if (!response.ok || !payload?.result) {
        throw new Error(payload?.error || "Workflow drafting failed.");
      }

      const { action, automation, reply } = payload.result;
      if (action === "create" && automation) {
        const id = `draft-${Date.now()}`;
        setAutomations((current) => [...current, {
          ...automation,
          id,
          icon: Sparkles,
          source: "chat draft",
        }]);
        setSelectedId(id);
      } else if (action === "update" && automation) {
        setAutomations((current) => current.map((item) => item.id === selectedAutomation.id
          ? { ...item, ...automation, source: "chat draft" }
          : item));
      }
      setMessages((current) => [...current, {
        id: `derya-${Date.now()}`,
        role: "derya",
        body: reply,
      }]);
    } catch (error) {
      setMessage(instruction);
      setMessages((current) => [...current, {
        id: `derya-${Date.now()}`,
        role: "derya",
        body: error instanceof Error ? error.message : "Workflow drafting failed.",
      }]);
    } finally {
      setIsDrafting(false);
    }
  }

  return (
    <section className={`${styles.workspace} supply-os-workspace`} aria-label="Automations workspace">
      <section className={styles.chatPane} aria-label={`Workflow editor for ${company}`}>
        <div className={styles.conversation} aria-live="polite" aria-busy={isDrafting}>
          {messages.map((chatMessage) => (
            <article key={chatMessage.id} data-role={chatMessage.role}>
              <p>{chatMessage.body}</p>
            </article>
          ))}
        </div>

        <form className={styles.composer} onSubmit={submitMessage}>
          <div>
            <textarea
              id="automation-message"
              aria-label="Automation instruction"
              rows={3}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Describe a workflow or change a step"
              disabled={isDrafting}
            />
            <button type="submit" disabled={!message.trim() || isDrafting} aria-label="Send automation instruction">
              {isDrafting
                ? <LoaderCircle className={styles.spinner} size={17} aria-hidden="true" />
                : <Send size={17} aria-hidden="true" />}
            </button>
          </div>
        </form>
      </section>

      <aside className={styles.libraryPane} aria-label="Automation drafts">
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
                disabled={isDrafting}
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
