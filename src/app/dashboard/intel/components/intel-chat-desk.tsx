"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  chatWithAgent,
  type AgentToolTrace,
  type ChatMsg,
} from "@/lib/agent-chat";
import { AgentMessageContent } from "@/components/agent-message-content";
import { AgentToolTraceList } from "@/components/agent-tool-trace-list";
import { Icon } from "@/components/icon";
import styles from "./intel-chat-desk.module.css";

type IntelChatItem = ChatMsg & {
  id: string;
  toolTrace?: AgentToolTrace[];
};

const HARDWARE_REPORT_TOOL = "get_hardware_import_report";

const SUGGESTED_QUESTIONS = [
  "Show me China to U.S. West Coast hardware imports over the last five years.",
  "Which hardware categories from China matter most for California startups?",
  "What can ImportGenius, TradeAtlas, or Trademo add to this research?",
  "What customs and product risks should I check before quoting a China hardware load?",
] as const;

function nextMessageId(role: ChatMsg["role"]) {
  return `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function IntelChatDesk({
  report,
  domesticTool,
  initialQuestion = "",
}: {
  report: ReactNode;
  domesticTool: ReactNode;
  initialQuestion?: string;
}) {
  const [messages, setMessages] = useState<IntelChatItem[]>([]);
  const [input, setInput] = useState(initialQuestion);
  const [busy, setBusy] = useState(false);
  const [reportMessageId, setReportMessageId] = useState<string | null>(null);
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
    const userMessage: IntelChatItem = {
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
        "/dashboard/intel"
      );
      const assistantMessage: IntelChatItem = {
        id: nextMessageId("assistant"),
        role: "assistant",
        content: result.reply,
        toolTrace: result.toolTrace,
      };
      setMessages([...nextMessages, assistantMessage]);
      if (
        result.toolTrace?.some(
          (tool) => tool.ok && tool.name === HARDWARE_REPORT_TOOL
        )
      ) {
        setReportMessageId(assistantMessage.id);
      }
    } catch (error) {
      setMessages([
        ...nextMessages,
        {
          id: nextMessageId("assistant"),
          role: "assistant",
          content: `I could not complete that research request. ${
            error instanceof Error ? error.message : "Try the question again."
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
    <main className={styles.desk} data-intel-chat>
      <header className={styles.deskHeader}>
        <div>
          <h1>Intelligence</h1>
          <span className={styles.headerStatus}>
            GPT-5.6 answers with cited freight evidence
          </span>
        </div>
        <a className={styles.shipmentLink} href="/dashboard/intel/load">
          <Icon name="ship" size={15} />
          Review a China load
        </a>
      </header>

      <section
        className={styles.conversation}
        aria-label="Intelligence conversation"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyMark}>
              <Icon name="sparkles" size={19} />
            </div>
            <span className={styles.emptyLabel}>Derya Intel</span>
            <h2>What do you need to know?</h2>
            <p>
              Ask about import history, gateways, hardware categories,
              customs risk, providers, lanes, or one real shipment. Derya
              answers first and opens the full sourced report only when it
              belongs in the answer.
            </p>
            <div
              className={styles.suggestions}
              aria-label="Suggested intelligence questions"
            >
              {SUGGESTED_QUESTIONS.map((question) => (
                <button
                  key={question}
                  type="button"
                  onClick={() => void send(question)}
                  disabled={busy}
                >
                  <span>{question}</span>
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
                {message.id === reportMessageId ? (
                  <section
                    className={styles.reportAttachment}
                    aria-label="Full cited hardware import report"
                  >
                    <div className={styles.attachmentHeader}>
                      <div>
                        <span>Attached evidence</span>
                        <strong>Full cited hardware import report</strong>
                      </div>
                      <a href="#sources">Jump to source ledger</a>
                    </div>
                    {report}
                  </section>
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
              <em>Checking the relevant sources and rules</em>
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
            placeholder="Ask about imports, customs, routes, providers, or paste a shipment question..."
            aria-label="Ask Derya Intelligence"
            rows={1}
            disabled={busy}
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy || !input.trim()}
            aria-label="Send intelligence question"
          >
            <Icon name="arrow-right" size={17} />
          </button>
        </div>
        <div className={styles.composerMeta}>
          <span>Enter to send, Shift+Enter for a new line</span>
          <details>
            <summary>Domestic trucking pre-flight</summary>
            <div className={styles.domesticTool}>{domesticTool}</div>
          </details>
        </div>
      </div>
    </main>
  );
}
