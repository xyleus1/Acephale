"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  chatWithAgent,
  type AgentToolTrace,
  type ChatMsg,
} from "@/lib/agent-chat";
import { AgentMessageContent } from "@/components/agent-message-content";
import { AgentToolTraceList } from "@/components/agent-tool-trace-list";
import { Icon } from "@/components/icon";
import {
  CAMPAIGN_APPLY_COMMAND,
  CAMPAIGN_DESK_SCOPE,
  CAMPAIGN_GREENLIGHT_COMMAND,
} from "@/lib/campaign-desk-scope";
import styles from "./supply-os-outreach.module.css";

type CampaignChatItem = ChatMsg & {
  id: string;
  toolTrace?: AgentToolTrace[];
};

const SUGGESTED_PROMPTS = [
  "Plan an outreach campaign for a research list",
  "List outreach campaigns",
  "Greenlight the pending campaign",
] as const;

const CAMPAIGN_MUTATING_TOOL_NAMES = new Set([
  "plan_outreach_campaign",
  "pause_outreach_campaign",
  "resume_outreach_campaign",
  "cancel_outreach_campaign",
  "run_outreach_campaign_now",
]);

function nextMessageId(role: ChatMsg["role"]) {
  return `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function SupplyOsOutreach() {
  const router = useRouter();
  const [messages, setMessages] = useState<CampaignChatItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const latestMessageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (messages.length === 0) return;
    window.requestAnimationFrame(() => {
      latestMessageRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, [messages.length]);

  async function send(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if (!text || busy) return;

    const history: ChatMsg[] = messages.map(({ role, content }) => ({
      role,
      content,
    }));
    const userMessage: CampaignChatItem = {
      id: nextMessageId("user"),
      role: "user",
      content: text,
    };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setBusy(true);
    if (inputRef.current) inputRef.current.style.height = "auto";

    try {
      const result = await chatWithAgent(
        history,
        text,
        undefined,
        undefined,
        CAMPAIGN_DESK_SCOPE,
      );
      const refreshForCampaignCommand =
        CAMPAIGN_APPLY_COMMAND.test(text) ||
        CAMPAIGN_GREENLIGHT_COMMAND.test(text);
      const refreshForCampaignTool = result.toolTrace?.some(
        (trace) => trace.ok && CAMPAIGN_MUTATING_TOOL_NAMES.has(trace.name),
      );
      if (refreshForCampaignCommand || refreshForCampaignTool) {
        router.refresh();
      }
      setMessages([
        ...nextMessages,
        {
          id: nextMessageId("assistant"),
          role: "assistant",
          content: result.reply,
          toolTrace: result.toolTrace,
        },
      ]);
    } catch (error) {
      setMessages([
        ...nextMessages,
        {
          id: nextMessageId("assistant"),
          role: "assistant",
          content: `I could not complete that campaign request. ${
            error instanceof Error ? error.message : "Try the request again."
          }`,
        },
      ]);
    } finally {
      setBusy(false);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  function onInputChange(event: ChangeEvent<HTMLTextAreaElement>) {
    setInput(event.target.value);
    const textarea = event.target;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }

  return (
    <section className={styles.desk} data-campaign-chat>
      <section
        className={styles.conversation}
        aria-label="Outreach conversation"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyMark}>
              <Icon name="sparkles" size={19} />
            </div>
            <span className={styles.emptyLabel}>Derya Outreach</span>
            <h2>What should we work on?</h2>
            <p>
              Plan campaigns from office research lists, review the proposed
              audience and message, then explicitly greenlight approved work.
            </p>
            <div
              className={styles.suggestions}
              aria-label="Suggested outreach prompts"
            >
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => void send(prompt)}
                  disabled={busy}
                >
                  <span>{prompt}</span>
                  <Icon name="arrow-right" size={14} />
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((message, index) => {
          const isLatest = index === messages.length - 1;
          return (
            <div
              key={message.id}
              ref={isLatest ? latestMessageRef : undefined}
              className={`${styles.message} ${
                message.role === "user"
                  ? styles.userMessage
                  : styles.assistantMessage
              }`}
            >
              {message.role === "assistant" ? (
                <span className={styles.avatar} aria-hidden>
                  D
                </span>
              ) : null}
              <div className={styles.messageStack}>
                <div className={styles.messageBody}>
                  <AgentMessageContent content={message.content} />
                </div>
                {message.role === "assistant" ? (
                  <AgentToolTraceList
                    trace={message.toolTrace}
                    variant="conversation"
                  />
                ) : null}
              </div>
            </div>
          );
        })}

        {busy ? (
          <div
            ref={latestMessageRef}
            className={`${styles.message} ${styles.assistantMessage}`}
          >
            <span className={styles.avatar} aria-hidden>
              D
            </span>
            <div className={`${styles.messageBody} ${styles.thinking}`}>
              <span />
              <span />
              <span />
              <em>Checking campaign rules and audience</em>
            </div>
          </div>
        ) : null}
      </section>

      <div className={styles.composerDock}>
        <div className={styles.composer}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={onInputChange}
            onKeyDown={onKeyDown}
            placeholder="Ask about campaigns, research lists, or approval..."
            aria-label="Ask Derya Outreach"
            rows={1}
            disabled={busy}
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy || !input.trim()}
            aria-label="Send outreach request"
          >
            <Icon name="arrow-right" size={17} />
          </button>
        </div>
        <div className={styles.composerMeta}>
          <span>Enter to send, Shift+Enter for a new line</span>
        </div>
      </div>
    </section>
  );
}
