"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { chatWithAgent, type AgentToolTrace, type ChatMsg } from "@/lib/agent-chat";
import { AgentPagePresenceLayer, type AgentPageAction } from "@/components/agent-page-presence";
import { AgentToolTraceList } from "@/components/agent-tool-trace-list";
import { cuesForToolTrace, inferPageCues, type AgentPageCue } from "@/lib/agent-page-cues";
import { Icon } from "@/components/icon";

type ChatItem = ChatMsg & {
  toolTrace?: AgentToolTrace[];
};

const AGENT_TOOLS = [
  {
    label: "Brain read",
    icon: "shield",
    prompt: "Inspect the commercial brain for this job. Start with the decision contract, weakest proof gap, next safe move, and stop condition.",
  },
  {
    label: "Run desk",
    icon: "grid",
    prompt: "List the decision queue and tell me the highest-priority commercial actions.",
  },
  {
    label: "Pricing queue",
    icon: "shield",
    prompt: "List the pricing brain queue. Start with the operator playbook: exact ask or first move, safety rule, stop condition, and review link for the top RFQ.",
  },
  {
    label: "Qualify RFQ",
    icon: "list",
    prompt: "Run a readiness audit and list what is missing before this RFQ can go to forwarders.",
  },
  {
    label: "Pricing check",
    icon: "check",
    prompt: "Check target price, received pricing, margin, and next pricing action.",
  },
  {
    label: "What-if",
    icon: "dollar",
    prompt: "Simulate pricing: what if the customer target is USD 2300 and the buy cost is USD 2000?",
  },
  {
    label: "Follow-ups",
    icon: "mail-out",
    prompt: "Find stale customer or forwarder follow-ups that need attention.",
  },
  {
    label: "Customer reply",
    icon: "mail",
    prompt: "Draft a concise customer reply from the current RFQ/pricing status.",
  },
] as const;

export function AgentChatWidget() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pageAction, setPageAction] = useState<AgentPageAction | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const pageCueTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, busy, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    return () => {
      if (pageCueTimerRef.current) window.clearTimeout(pageCueTimerRef.current);
    };
  }, []);

  function showPageCues(cues: readonly AgentPageCue[], durationMs = Math.min(14000, cues.length * 2500 + 2200)) {
    if (cues.length === 0) return;
    if (pageCueTimerRef.current) {
      window.clearTimeout(pageCueTimerRef.current);
    }
    setPageAction({
      id: Date.now(),
      cues: [...cues],
    });
    pageCueTimerRef.current = window.setTimeout(() => {
      setPageAction(null);
      pageCueTimerRef.current = null;
    }, durationMs);
  }

  // The dashboard root has a permanent agent panel embedded in the page,
  // so suppress the floating pill there. Must come AFTER all hooks (Rules of Hooks).
  if (pathname === "/dashboard") return null;

  async function send(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if (!text || busy) return;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    showPageCues(inferPageCues(text), 9000);

    const history: ChatMsg[] = messages.map(({ role, content }) => ({ role, content }));
    const next: ChatItem[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setBusy(true);
    try {
      const res = await chatWithAgent(history, text);
      setMessages([...next, { role: "assistant", content: res.reply, toolTrace: res.toolTrace }]);
      const actualCues = cuesForToolTrace(res.toolTrace);
      if (actualCues.length > 0) {
        showPageCues(actualCues);
      }
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

  if (!open) {
    return (
      <>
        <AgentPagePresenceLayer action={pageAction} listenForExternalCues />
        <button
          onClick={() => setOpen(true)}
          className="agent-fab"
          aria-label="Open agent"
          title="Open agent (Cmd+J)"
        >
          <Icon name="sparkles" size={14} strokeWidth={2.25} />
          <span>Desk Assistant</span>
          <span className="agent-fab-dot" aria-hidden />
        </button>
      </>
    );
  }

  return (
    <>
      <AgentPagePresenceLayer action={pageAction} listenForExternalCues />
      <div className="agent-panel" role="dialog" aria-label="Desk assistant">
        <header className="agent-panel-header">
          <div className="agent-title-lockup">
            <span className="agent-avatar">A</span>
            <div>
              <div className="agent-panel-title">Desk Assistant</div>
              <div className="agent-panel-subtitle">RFQs, target price, forwarder replies</div>
            </div>
          </div>
          <button onClick={() => setOpen(false)} className="agent-panel-close" aria-label="Close">
            <Icon name="x" size={14} strokeWidth={2.5} />
          </button>
        </header>

        <div ref={scrollRef} className="agent-panel-body">
          {messages.length === 0 && (
            <div className="agent-empty">
              <div className="agent-empty-title">Start with the commercial gap.</div>
              <p className="agent-empty-copy">
                Paste an RFQ, ask what is missing, check target price, or draft the next customer/forwarder reply.
              </p>
              <div className="agent-capability-grid compact" aria-label="Desk assistant tools">
                {AGENT_TOOLS.map((tool) => (
                  <button
                    key={tool.label}
                    className="agent-tool-button"
                    onClick={() => send(tool.prompt)}
                    disabled={busy}
                    title={tool.prompt}
                  >
                    <Icon name={tool.icon} size={13} strokeWidth={2} />
                    <span>{tool.label}</span>
                  </button>
                ))}
              </div>
              <div className="agent-suggestion-list">
                {[
                  "List the decision queue.",
                  "List the pricing brain queue.",
                  "What is missing before this RFQ can go out?",
                  "What if target is USD 2300 and buy cost is USD 2000?",
                  "Find stale forwarder replies.",
                ].map((q) => (
                  <button
                    key={q}
                    className="agent-suggestion"
                    onClick={() => { setInput(q); setTimeout(() => inputRef.current?.focus(), 0); }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`agent-msg agent-msg-${m.role}`}>
              {m.role === "assistant" && <span className="agent-msg-avatar">A</span>}
              <div className="agent-msg-stack">
                <div className="agent-msg-body">{m.content}</div>
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

        <footer className="agent-panel-footer">
          <textarea
            ref={inputRef}
            value={input}
            onChange={onInputChange}
            onKeyDown={onKeyDown}
            placeholder="Paste mail, ask what's missing, or check pricing..."
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
        </footer>
      </div>
    </>
  );
}
