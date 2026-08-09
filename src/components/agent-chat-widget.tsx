"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { chatWithAgent, type AgentToolTrace, type ChatMsg } from "@/lib/agent-chat";
import { AgentToolTraceList } from "@/components/agent-tool-trace-list";
import { AgentMessageContent } from "@/components/agent-message-content";
import { Icon } from "@/components/icon";

type ChatItem = ChatMsg & {
  toolTrace?: AgentToolTrace[];
};

const AGENT_TOOLS = [
  {
    label: "Decision review",
    icon: "shield",
    prompt: "Review this job. Start with missing proof, the next allowed action, and the stop condition.",
  },
  {
    label: "Run desk",
    icon: "grid",
    prompt: "List the decision queue and tell me the highest-priority commercial actions.",
  },
  {
    label: "Pricing queue",
    icon: "shield",
    prompt: "List the pricing queue and the next action for each RFQ.",
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
  const routeJobIdRaw = pathname.match(/^\/dashboard\/jobs\/([^/]+)/)?.[1];
  const routeJobId = routeJobIdRaw && routeJobIdRaw !== "new" ? routeJobIdRaw : undefined;
  const isLoadWorkspace = Boolean(routeJobId);
  const isDashboardWorkbench = pathname === "/dashboard";
  const searchParams = useSearchParams();
  // Mirror the brain page's section parsing: only the default (chat) view embeds
  // its own chat; the todos/news/map sections still need the floating dock.
  const brainSection = searchParams.get("section");
  const isCompanyBrainPage =
    pathname.startsWith("/dashboard/brain") &&
    brainSection !== "todos" && brainSection !== "news" && brainSection !== "map";
  const isIntelPage =
    pathname === "/dashboard/intel" ||
    pathname.startsWith("/dashboard/intel/");
  const [open, setOpen] = useState(true);
  const [dashboardAgentChecked, setDashboardAgentChecked] = useState(!isDashboardWorkbench);
  const [hasEmbeddedWorkbenchAgent, setHasEmbeddedWorkbenchAgent] = useState(false);
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, busy, open]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("agent-dock-open");
      if (saved !== null) setOpen(saved !== "false");
    } catch {
      // Storage can be unavailable in locked-down browser contexts; default open is acceptable.
    }
  }, []);

  useEffect(() => {
    if (!isDashboardWorkbench) {
      setDashboardAgentChecked(true);
      setHasEmbeddedWorkbenchAgent(false);
      return;
    }

    setDashboardAgentChecked(false);
    let frame = window.requestAnimationFrame(() => {
      const next = Boolean(document.querySelector(".workbench-agent"));
      setHasEmbeddedWorkbenchAgent((current) => (current === next ? current : next));
      setDashboardAgentChecked(true);
    });

    const observer = new MutationObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const next = Boolean(document.querySelector(".workbench-agent"));
        setHasEmbeddedWorkbenchAgent((current) => (current === next ? current : next));
        setDashboardAgentChecked(true);
      });
    });

    observer.observe(document.querySelector(".page-container") ?? document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [isDashboardWorkbench]);

  const suppressedByWorkbenchAgent = isDashboardWorkbench && (!dashboardAgentChecked || hasEmbeddedWorkbenchAgent);

  useEffect(() => {
    const active =
      open &&
      !suppressedByWorkbenchAgent &&
      !isLoadWorkspace &&
      !isCompanyBrainPage &&
      !isIntelPage;
    document.documentElement.classList.toggle("agent-dock-open", active);
    return () => {
      document.documentElement.classList.remove("agent-dock-open");
    };
  }, [open, suppressedByWorkbenchAgent, isLoadWorkspace, isCompanyBrainPage, isIntelPage]);

  function setDockOpen(next: boolean) {
    setOpen(next);
    try {
      window.localStorage.setItem("agent-dock-open", String(next));
    } catch {
      // The dock state is a convenience preference, not required app state.
    }
    if (next) window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  // The Context chat view is the chat, so the floating dock would duplicate it.
  if (isCompanyBrainPage || isIntelPage) return null;
  if (isLoadWorkspace) return null;

  // The dashboard root sometimes has a permanent embedded agent. Suppress the
  // global dock only in that state; the empty dashboard still needs an agent.
  if (suppressedByWorkbenchAgent) return null;

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
      // Page scope: the server tailors context to the page the dock is on
      // (e.g. the Incoming RFQs board snapshot), so "the loads in front of
      // me" means what the operator actually sees.
      const query = searchParams.toString();
      const scopePage = `${pathname}${query ? `?${query}` : ""}`;
      const res = await chatWithAgent(history, text, routeJobId, undefined, scopePage);
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
      <button
        onClick={() => setDockOpen(true)}
        className="agent-fab"
        aria-label="Open agent"
        title="Open agent (Cmd+J)"
      >
        <Icon name="sparkles" size={14} strokeWidth={2.25} />
        <span>Desk Assistant</span>
        <span className="agent-fab-dot" aria-hidden />
      </button>
    );
  }

  return (
    <>
      <div className="agent-panel" role="dialog" aria-label="Desk assistant">
        <header className="agent-panel-header">
          <div className="agent-title-lockup">
            <span className="agent-avatar">A</span>
            <div>
              <div className="agent-panel-kicker">Agent</div>
              <div className="agent-panel-title">Desk Assistant</div>
            </div>
          </div>
          <button onClick={() => setDockOpen(false)} className="agent-panel-close" aria-label="Close">
            <Icon name="x" size={14} strokeWidth={2.5} />
          </button>
        </header>

        <div ref={scrollRef} className="agent-panel-body">
          {messages.length === 0 && (
            <div className="agent-empty">
              <div className="agent-empty-title">What needs review?</div>
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
                  "List the pricing queue.",
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
