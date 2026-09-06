"use client";

import { ChevronDown, ChevronUp, Mail, Search, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import styles from "./supply-os-mail.module.css";

type MailThread = {
  id: string;
  subject: string;
  participants: string[];
  companyId: string | null;
  companyName: string | null;
  contactId: string | null;
  contactName: string | null;
  lastMessageAt: string;
  messageCount: number;
  lastDirection: "INBOUND" | "OUTBOUND" | null;
  mailbox: string | null;
};

type MailThreadDetail = MailThread & {
  truncated: boolean;
  messages: {
    id: string;
    direction: "INBOUND" | "OUTBOUND";
    fromEmail: string;
    toEmails: string[];
    subject: string | null;
    bodyText: string | null;
    sentAt: string;
    mailbox: string | null;
  }[];
};

type ListState = "loading" | "ready" | "error";

function relativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const minutes = Math.round((Date.now() - timestamp) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(timestamp));
}

function timestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function SupplyOsMail({ researchProjectId }: { researchProjectId: string }) {
  const [initialThreadId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("threadId");
  });
  const [threads, setThreads] = useState<MailThread[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [state, setState] = useState<ListState>("loading");
  const [error, setError] = useState("");
  const [appendError, setAppendError] = useState("");
  const [appendLoading, setAppendLoading] = useState(false);
  const [loadingCursor, setLoadingCursor] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MailThreadDetail | null>(null);
  const [detailState, setDetailState] = useState<"idle" | "loading" | "error">("idle");
  const [detailError, setDetailError] = useState("");
  const activeSearchRef = useRef("");
  const listRequestIdRef = useRef(0);
  const listReplacementRef = useRef(0);
  const detailRequestIdRef = useRef(0);
  const loadingCursorsRef = useRef(new Set<string>());
  const initialThreadHandledRef = useRef(false);

  const loadThreads = useCallback(async (
    query: string,
    options: { cursor?: string | null; append?: boolean } = {},
  ) => {
    const cursor = options.cursor ?? null;
    const append = options.append === true;
    const appendCursor = append ? cursor : null;
    if (append && appendCursor === null) return;
    if (appendCursor !== null && loadingCursorsRef.current.has(appendCursor)) return;
    const requestId = ++listRequestIdRef.current;
    if (!append) listReplacementRef.current += 1;
    if (appendCursor !== null) {
      loadingCursorsRef.current.add(appendCursor);
      setAppendLoading(true);
      setLoadingCursor(appendCursor);
      setAppendError("");
    } else {
      setState("loading");
      setError("");
      setAppendError("");
    }
    try {
      const params = new URLSearchParams({ limit: "25" });
      if (cursor) params.set("cursor", cursor);
      if (query) params.set("search", query);
      params.set("researchProjectId", researchProjectId);
      const response = await fetch(`/api/supply-os/mail?${params.toString()}`, {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      const body = await response.json().catch(() => ({})) as {
        threads?: MailThread[];
        nextCursor?: string | null;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || "Mail is unavailable.");
      if (requestId !== listRequestIdRef.current) return;
      setThreads((current) => append ? [...current, ...(body.threads ?? [])] : body.threads ?? []);
      setNextCursor(body.nextCursor ?? null);
      setState("ready");
    } catch (loadError) {
      if (requestId !== listRequestIdRef.current) return;
      const message = loadError instanceof Error ? loadError.message : "Mail is unavailable.";
      if (append) {
        setAppendError(message);
      } else {
        setError(message);
        setState("error");
      }
    } finally {
      if (appendCursor !== null) {
        loadingCursorsRef.current.delete(appendCursor);
        const nextLoadingCursor = loadingCursorsRef.current.values().next().value ?? null;
        setAppendLoading(loadingCursorsRef.current.size > 0);
        setLoadingCursor(nextLoadingCursor);
      }
    }
  }, [researchProjectId]);

  useEffect(() => {
    void loadThreads("");
  }, [loadThreads]);

  const openThread = useCallback(async (thread: MailThread) => {
    if (expandedId === thread.id) {
      detailRequestIdRef.current += 1;
      setExpandedId(null);
      setDetail(null);
      return;
    }
    const requestId = ++detailRequestIdRef.current;
    setExpandedId(thread.id);
    setDetail(null);
    setDetailState("loading");
    setDetailError("");
    try {
      const response = await fetch(`/api/supply-os/mail/${encodeURIComponent(thread.id)}?researchProjectId=${encodeURIComponent(researchProjectId)}`, {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      const body = await response.json().catch(() => ({})) as MailThreadDetail & { error?: string };
      if (!response.ok) throw new Error(body.error || "Mail thread is unavailable.");
      if (requestId !== detailRequestIdRef.current) return;
      setDetail(body);
      setDetailState("idle");
    } catch (loadError) {
      if (requestId !== detailRequestIdRef.current) return;
      setDetailError(loadError instanceof Error ? loadError.message : "Mail thread is unavailable.");
      setDetailState("error");
    }
  }, [expandedId, researchProjectId]);

  useEffect(() => {
    if (!initialThreadId || state !== "ready" || expandedId || initialThreadHandledRef.current) return;
    initialThreadHandledRef.current = true;
    const thread = threads.find((candidate) => candidate.id === initialThreadId);
    if (thread) {
      void openThread(thread);
      return;
    }
    const requestId = ++detailRequestIdRef.current;
    const listReplacementId = listReplacementRef.current;
    setExpandedId(initialThreadId);
    setDetail(null);
    setDetailState("loading");
    setDetailError("");
    void (async () => {
      try {
        const response = await fetch(`/api/supply-os/mail/${encodeURIComponent(initialThreadId)}?researchProjectId=${encodeURIComponent(researchProjectId)}`, {
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        const body = await response.json().catch(() => ({})) as MailThreadDetail & { error?: string };
        if (!response.ok) throw new Error(body.error || "Mail thread is unavailable.");
        if (requestId !== detailRequestIdRef.current || listReplacementId !== listReplacementRef.current) {
          if (requestId === detailRequestIdRef.current) {
            setExpandedId(null);
            setDetail(null);
            setDetailState("idle");
          }
          return;
        }
        setThreads((current) => current.some((candidate) => candidate.id === body.id) ? current : [body, ...current]);
        setDetail(body);
        setDetailState("idle");
      } catch {
        if (requestId !== detailRequestIdRef.current) return;
        setExpandedId(null);
        setDetail(null);
        setDetailState("idle");
      }
    })();
  }, [expandedId, initialThreadId, openThread, researchProjectId, state, threads]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = search.trim();
    activeSearchRef.current = query;
    detailRequestIdRef.current += 1;
    setExpandedId(null);
    setDetail(null);
    void loadThreads(query);
  }

  return (
    <section className={styles.mail} aria-label="Office mail">
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}><Mail size={14} /> Mail</span>
          <h2>Office mail</h2>
        </div>
        <form className={styles.search} onSubmit={submitSearch}>
          <Search size={16} aria-hidden="true" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search subject or participant"
            aria-label="Search mail"
          />
          <button type="submit">Search</button>
        </form>
      </header>

      {state === "loading" ? <div className={styles.state}>Loading mail...</div> : null}
      {state === "error" ? (
        <div className={styles.state} data-tone="error">
          <TriangleAlert size={18} />
          <span>{error}</span>
          <button type="button" onClick={() => void loadThreads(activeSearchRef.current)}>Retry</button>
        </div>
      ) : null}
      {state === "ready" && appendError ? <p className={styles.detailState}>{appendError}</p> : null}
      {state === "ready" && threads.length === 0 ? <div className={styles.state}>No mail found.</div> : null}

      {state === "ready" && threads.length > 0 ? (
        <div className={styles.threadList}>
          {threads.map((thread) => {
            const expanded = expandedId === thread.id;
            return (
              <article key={thread.id} className={styles.thread}>
                <button
                  type="button"
                  className={styles.threadButton}
                  aria-expanded={expanded}
                  onClick={() => void openThread(thread)}
                >
                  <span className={styles.threadMain}>
                    <strong>{thread.companyName ?? "Not linked to a company"}</strong>
                    <span className={styles.participants}>{thread.participants.join(", ") || "No participants"}</span>
                    <span className={styles.subject}>{thread.subject || "(No subject)"}</span>
                  </span>
                  <span className={styles.threadMeta}>
                    <span>{thread.mailbox ?? "Mailbox not recorded"}</span>
                    <span>{thread.messageCount} {thread.messageCount === 1 ? "message" : "messages"}</span>
                    <span>{relativeTime(thread.lastMessageAt)}</span>
                  </span>
                  {expanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
                </button>
                {expanded ? (
                  <div className={styles.detail}>
                    {detailState === "loading" ? <p className={styles.detailState}>Loading thread...</p> : null}
                    {detailState === "error" ? <p className={styles.detailState}>{detailError}</p> : null}
                    {detailState === "idle" && detail ? (
                      <div className={styles.messages}>
                        {detail.truncated ? <p className={styles.detailState}>Older messages are not shown.</p> : null}
                        {detail.messages.map((message) => (
                          <div key={message.id} className={styles.message}>
                            <header>
                              <strong>{message.direction === "OUTBOUND" ? "Sent" : "Received"}</strong>
                              <span>{message.mailbox ?? message.fromEmail}</span>
                              <time dateTime={message.sentAt}>{timestamp(message.sentAt)}</time>
                            </header>
                            <p>{message.bodyText ?? ""}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}

      {state === "ready" && nextCursor ? (
        <button
          type="button"
          className={styles.loadOlder}
          disabled={appendLoading && loadingCursor === nextCursor}
          onClick={() => void loadThreads(activeSearchRef.current, { cursor: nextCursor, append: true })}
        >
          {appendLoading && loadingCursor === nextCursor ? "Loading older..." : "Load older"}
        </button>
      ) : null}
    </section>
  );
}
