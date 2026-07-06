"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { chatWithAgent, type AgentToolTrace, type ChatMsg } from "@/lib/agent-chat";
import { AgentToolTraceList } from "@/components/agent-tool-trace-list";
import { AgentMessageContent } from "@/components/agent-message-content";
import { Icon } from "@/components/icon";

export type FeedItem = {
  kind: "event";
  id: string;
  at: string; // ISO
  iconName: "inbox" | "sparkles" | "ship" | "box" | "check" | "file" | "file-check" | "mail-in" | "mail-out";
  who: "auto" | "manual";
  title: string;
  sub?: string;
};

function relTime(iso: string) {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

type ChatItem = ChatMsg & {
  id: string;
  at: string;
  toolTrace?: AgentToolTrace[];
};

const AGENT_TOOLS = [
  {
    label: "Brain",
    detail: "Contract + proof",
    icon: "shield",
    prompt: "Inspect the commercial brain for this job. Start with the decision contract, weakest proof gap, next safe move, and stop condition.",
  },
  {
    label: "Qualify",
    detail: "Missing RFQ facts",
    icon: "list",
    prompt: "Run a readiness audit for this job and list what is missing before this RFQ can go to forwarders.",
  },
  {
    label: "Price",
    detail: "Target + margin",
    icon: "check",
    prompt: "Check target price, received pricing, margin, and the next pricing action for this job.",
  },
  {
    label: "Replies",
    detail: "Stale threads",
    icon: "mail-out",
    prompt: "Find stale customer or forwarder follow-ups on this load.",
  },
  {
    label: "Customer",
    detail: "Draft reply",
    icon: "mail",
    prompt: "Draft a concise customer reply for this job based on the current RFQ/pricing status.",
  },
] as const;

export function JobConversationPanel({
  scopeJobId,
  scopeJobReference,
  feed,
  suggestions,
}: {
  scopeJobId: string;
  scopeJobReference: string;
  feed: FeedItem[];
  suggestions: string[];
}) {
  const router = useRouter();
  const [chat, setChat] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chat, busy]);

  async function send(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if (!text || busy) return;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";

    const history: ChatMsg[] = chat.map(({ role, content }) => ({ role, content }));
    const userItem: ChatItem = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
      at: new Date().toISOString(),
    };
    setChat((c) => [...c, userItem]);
    setBusy(true);
    try {
      const res = await chatWithAgent(history, text, scopeJobId);
      const assistantItem: ChatItem = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: res.reply,
        at: new Date().toISOString(),
        toolTrace: res.toolTrace,
      };
      setChat((c) => [...c, assistantItem]);
      if (res.ingestedInquiryId || res.refresh) router.refresh();
    } catch (err) {
      setChat((c) => [...c, {
        id: `err-${Date.now()}`,
        role: "assistant",
        content: `Something went wrong. ${err instanceof Error ? err.message : ""}`,
        at: new Date().toISOString(),
      }]);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }

  // Merge events + chat for chronological display
  type Item = ({ kind: "event" } & FeedItem) | ({ kind: "chat" } & ChatItem);
  const merged: Item[] = [
    ...feed.map((f) => ({ ...f } as Item)),
    ...chat.map((c) => ({ ...c, kind: "chat" as const })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  if (collapsed) {
    return (
      <>
        <div className="conversation-panel collapsed" aria-label="Collapsed desk assistant">
          <button
            type="button"
            className="conversation-rail-button"
            onClick={() => setCollapsed(false)}
            title="Show desk assistant"
            aria-label="Show desk assistant"
          >
            <span className="agent-avatar">A</span>
            <span className="conversation-rail-copy">
              <strong>Desk Assistant</strong>
              <small>{scopeJobReference}</small>
            </span>
            <Icon name="chevron-left" size={14} strokeWidth={2.25} />
          </button>
        </div>
      </>
    );
  }

  return (
    <div className="conversation-panel">
      <header className="conversation-header">
        <div className="conversation-title-lockup">
          <span className="agent-avatar">A</span>
          <div>
            <div className="conversation-kicker">Agent</div>
            <div className="conversation-title">Desk Assistant</div>
            <div className="conversation-subtitle">RFQs, target price, forwarder replies</div>
          </div>
        </div>
        <button
          type="button"
          className="conversation-collapse"
          onClick={() => setCollapsed(true)}
          title="Hide desk assistant"
          aria-label="Hide desk assistant"
        >
          <Icon name="x" size={15} strokeWidth={2.5} />
        </button>
      </header>

      <div className="conversation-tools" aria-label="Desk assistant tools">
        {AGENT_TOOLS.map((tool) => (
          <button
            key={tool.label}
            type="button"
            onClick={() => send(tool.prompt)}
            disabled={busy}
            title={tool.prompt}
            className="conversation-tool"
          >
            <Icon name={tool.icon} size={13} strokeWidth={2} />
            <span>
              <strong>{tool.label}</strong>
              <small>{tool.detail}</small>
            </span>
          </button>
        ))}
      </div>

      <div ref={scrollRef} className="conversation-body">
        {merged.length === 0 ? (
          <div className="conversation-empty">
            No activity yet on this job.
          </div>
        ) : (
          merged.map((item) =>
            item.kind === "event" ? (
              <div key={item.id} className="conv-event">
                <span className={`conv-event-icon ${item.who === "auto" ? "auto" : "manual"}`}>
                  <Icon name={item.iconName} size={12} strokeWidth={2} />
                </span>
                <div className="conv-event-main">
                  <div className="conv-event-head">
                    <span className="conv-event-title">{item.title}</span>
                    {item.who === "auto" && (
                      <span className="auto-tag">AUTO</span>
                    )}
                  </div>
                  {item.sub && (
                    <div className="conv-event-sub">
                      {item.sub}
                    </div>
                  )}
                </div>
                <span className="conv-event-time">{relTime(item.at)}</span>
              </div>
            ) : (
              <div key={item.id} className={`conv-chat conv-chat-${item.role}`}>
                {item.role === "assistant" && <span className="agent-msg-avatar">A</span>}
                <div className="conv-chat-stack">
                  <div className="conv-chat-body"><AgentMessageContent content={item.content} /></div>
                  {item.role === "assistant" && <AgentToolTraceList trace={item.toolTrace} variant="conversation" />}
                </div>
              </div>
            )
          )
        )}
        {busy && (
          <div className="conv-chat conv-chat-assistant">
            <span className="agent-msg-avatar">A</span>
            <div className="conv-chat-body agent-msg-thinking">
              <span /><span /><span />
            </div>
          </div>
        )}
      </div>

      <div className="conversation-compose">
        {chat.length === 0 && suggestions.length > 0 && (
          <div className="conv-suggestions">
            {suggestions.map((s) => (
              <button key={s} onClick={() => send(s)} disabled={busy}>{s}</button>
            ))}
          </div>
        )}
        <div className="conv-input-row">
          <textarea
            ref={inputRef}
            value={input}
            onChange={onChange}
            onKeyDown={onKeyDown}
            placeholder={`Paste mail, ask what's missing, or price ${scopeJobReference}...`}
            rows={1}
            disabled={busy}
          />
          <button
            onClick={() => send()}
            disabled={busy || !input.trim()}
            className="agent-send-btn"
            aria-label="Send"
          >
            <Icon name="arrow-right" size={14} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
}
