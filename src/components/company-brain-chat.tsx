"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { chatWithAgent, type AgentToolTrace, type ChatMsg } from "@/lib/agent-chat";
import { AgentToolTraceList } from "@/components/agent-tool-trace-list";
import { AgentMessageContent } from "@/components/agent-message-content";
import { Icon } from "@/components/icon";

type ChatItem = ChatMsg & {
  toolTrace?: AgentToolTrace[];
};

const BRAIN_SUGGESTIONS = [
  {
    label: "Decision queue",
    prompt: "List the decision queue and tell me the highest-priority commercial actions.",
  },
  {
    label: "Pricing queue",
    prompt: "List the pricing queue and the next action for each RFQ.",
  },
  {
    label: "Stale follow-ups",
    prompt: "Find stale customer or forwarder follow-ups that need attention.",
  },
  {
    label: "Blocked RFQs",
    prompt: "List RFQs blocked by missing proof and the next action for each.",
  },
  {
    label: "Qualify newest RFQ",
    prompt: "Run a readiness audit on the newest RFQ and list what is missing before it can go to forwarders.",
  },
] as const;

export function CompanyBrainChat() {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, busy]);

  async function send(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if (!text || busy) return;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";

    const history: ChatMsg[] = messages.map(({ role, content }) => ({ role, content }));
    const next: ChatItem[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setBusy(true);
    try {
      const res = await chatWithAgent(history, text);
      setMessages([...next, { role: "assistant", content: res.reply, toolTrace: res.toolTrace }]);
      if (res.ingestedInquiryId || res.refresh) {
        router.refresh();
      }
    } catch (err) {
      setMessages([...next, {
        role: "assistant",
        content: `Something went wrong. ${err instanceof Error ? err.message : ""}`,
      }]);
    } finally {
      setBusy(false);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  // Auto-resize textarea
  function onInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }

  return (
    <>
      <div className="brain-chat" aria-label="Context search">
        <div ref={scrollRef} className="brain-chat-scroll">
          {messages.length === 0 && !busy ? (
            <div className="brain-chat-empty">
              <h1 className="brain-chat-empty-title">Search company context</h1>
              <div className="brain-chip-row" aria-label="Suggested questions">
                {BRAIN_SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion.label}
                    type="button"
                    className="brain-chip"
                    onClick={() => send(suggestion.prompt)}
                    disabled={busy}
                    title={suggestion.prompt}
                  >
                    {suggestion.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="brain-chat-messages">
              {messages.map((m, i) => (
                <div key={i} className={`agent-msg agent-msg-${m.role}`}>
                  {m.role === "assistant" && <span className="agent-msg-avatar">A</span>}
                  <div className="agent-msg-stack">
                    <div className="agent-msg-body"><AgentMessageContent content={m.content} /></div>
                    {m.role === "assistant" && <AgentToolTraceList trace={m.toolTrace} />}
                  </div>
                </div>
              ))}

              {busy && (
                <div className="agent-msg agent-msg-assistant">
                  <span className="agent-msg-avatar">A</span>
                  <div className="agent-msg-body agent-msg-thinking">
                    <span /><span /><span />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="brain-composer">
          <textarea
            ref={inputRef}
            value={input}
            onChange={onInputChange}
            onKeyDown={onKeyDown}
            placeholder="Search companies, loads, and messages"
            rows={1}
            disabled={busy}
          />
          <button
            type="button"
            onClick={() => send()}
            disabled={busy || !input.trim()}
            className="brain-send-btn"
            aria-label="Send"
          >
            <Icon name="arrow-right" size={14} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </>
  );
}
