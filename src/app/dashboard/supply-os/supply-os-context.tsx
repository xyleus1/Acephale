"use client";

import {
  ArrowUp,
  Box,
  Brain,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  ListTodo,
  LoaderCircle,
  MessageSquarePlus,
  MessagesSquare,
  Paperclip,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  Fragment,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { STALE_RUN_MS } from "@/lib/supply-os/context-prospecting-constants";
import styles from "./supply-os-context.module.css";

type ContextQuestion = {
  question: string;
  kind: "yes_no" | "options";
  options: string[];
};

type ContextThread = {
  id: string;
  title: string;
  createdAt: string;
};

type ContextMemory = {
  id: string;
  note: string;
  createdAt: string;
};

type ContextMessage = {
  id: string;
  role: string;
  body: string;
  citations?: Array<{ id: string; label: string }> | null;
  questions?: ContextQuestion[] | null;
  threadId?: string | null;
  createdAt: string;
};

type ContextDocument = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  summary: string | null;
  processingState: string;
  processingError: string | null;
  createdAt: string;
};

type ContextProcurementAction = {
  id: string;
  status: "PENDING" | "CREATING" | "CREATED" | "DISMISSED";
  draft: {
    material: string;
    specification: string | null;
    manufacturer: string | null;
    partNumber: string | null;
    quantity: number;
    unit: string;
    neededBy: string | null;
    deliveryLocation: string | null;
    notes: string | null;
  };
  citations: Array<{ id: string; label: string }>;
  order: null | {
    id?: string;
    status: string;
    workflowWakeRequested?: boolean;
  };
  createdAt: string;
};

type ContextProspectingAction = {
  id: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "DISMISSED";
  draft: {
    objective: string;
    segments: string[];
    regions: string[];
    productFocus: string;
    listSlug: string;
    notes: string;
  };
  citations: Array<{ id: string; label: string }>;
  stats: {
    queriesUsed: number;
    pagesFetched: number;
    candidatesFound: number;
    rowsCreated: number;
    rowsUpdated: number;
  };
  nextQueryOffset: number;
  exhausted: boolean;
  runningStartedAt: string | null;
  createdAt: string;
};

type ContextPayload = {
  workspace: { id: string; name: string };
  threads?: ContextThread[];
  memory?: ContextMemory[];
  messages: ContextMessage[];
  documents: ContextDocument[];
  procurementActions: ContextProcurementAction[];
  prospectingActions: ContextProspectingAction[];
};

type OptimisticMessage = ContextMessage & { pending: true };

const ACCEPTED_FILES = ".pdf,.md,.txt,.csv,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.zip,.stl";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const UPLOAD_CHUNK_BYTES = 3 * 1024 * 1024;
const PROCESSING_PHASES = [
  "Digesting company context",
  "Checking files and open requests",
  "Preparing clarifying questions",
  "Shaping the workflow",
] as const;

function fileExtension(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  return extension && extension !== name.toLowerCase() ? extension : "file";
}

function fileKind(document: ContextDocument) {
  const extension = fileExtension(document.name);
  if (["csv", "xls", "xlsx"].includes(extension)) return "sheet";
  if (["png", "jpg", "jpeg", "webp"].includes(extension)) return "image";
  if (extension === "zip") return "archive";
  if (extension === "stl") return "model";
  return "document";
}

function FileKindIcon({ document }: { document: ContextDocument }) {
  const kind = fileKind(document);
  const Icon = kind === "sheet"
    ? FileSpreadsheet
    : kind === "image"
      ? FileImage
      : kind === "archive"
        ? FileArchive
        : kind === "model"
          ? Box
          : FileText;
  return <span className={styles.fileIcon} data-kind={kind}><Icon size={21} aria-hidden="true" /></span>;
}

function formatBytes(size: number) {
  if (size < 1_024) return `${size} B`;
  if (size < 1_048_576) return `${Math.round(size / 1_024)} KB`;
  return `${(size / 1_048_576).toFixed(1)} MB`;
}

function documentState(document: ContextDocument) {
  if (document.processingState === "READY" || document.processingState === "EXTRACTED") return "Ready";
  if (document.processingState === "UNSUPPORTED") return "Stored";
  if (document.processingState === "FAILED") return "Could not parse";
  return "Processing";
}

function inlineMarkdown(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) => (
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={`${part}:${index}`}>{part.slice(2, -2)}</strong>
      : <Fragment key={`${part}:${index}`}>{part}</Fragment>
  ));
}

function prospectingRunIsStale(action: ContextProspectingAction, now: number) {
  if (action.status !== "RUNNING") return false;
  const started = action.runningStartedAt ? Date.parse(action.runningStartedAt) : Number.NaN;
  return !Number.isFinite(started) || now - started >= STALE_RUN_MS;
}

function documentCitations(citations: Array<{ id: string; label: string }> | null | undefined) {
  if (!Array.isArray(citations)) return [];
  return citations.filter((citation) => citation.id.startsWith("document:"));
}

function MessageBody({ body }: { body: string }) {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let bullets: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const value = paragraph.join("\n");
    blocks.push(<p key={`p:${blocks.length}`}>{inlineMarkdown(value)}</p>);
    paragraph = [];
  };
  const flushBullets = () => {
    if (!bullets.length) return;
    blocks.push(<ul key={`ul:${blocks.length}`}>{bullets.map((item, index) => <li key={`${item}:${index}`}>{inlineMarkdown(item)}</li>)}</ul>);
    bullets = [];
  };

  for (const line of lines) {
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      bullets.push(bullet[1]);
      continue;
    }
    flushBullets();
    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    paragraph.push(line);
  }
  flushBullets();
  flushParagraph();
  return <div className={styles.messageBody}>{blocks}</div>;
}

export function SupplyOsContext({
  workspaceId,
  apiBasePath,
  readOnly = false,
  messageRole = "OPERATOR",
  showOrderId = true,
  memoryEnabled = true,
  threadDeleteEnabled = true,
}: {
  workspaceId: string | null;
  apiBasePath?: string;
  readOnly?: boolean;
  messageRole?: "OPERATOR" | "CUSTOMER";
  showOrderId?: boolean;
  memoryEnabled?: boolean;
  threadDeleteEnabled?: boolean;
}) {
  const [data, setData] = useState<ContextPayload | null>(null);
  const [message, setMessage] = useState("");
  const [optimisticMessage, setOptimisticMessage] = useState<OptimisticMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [processingPhase, setProcessingPhase] = useState(0);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [uploadingNames, setUploadingNames] = useState<string[]>([]);
  const [filesOpen, setFilesOpen] = useState(true);
  const [drawerTab, setDrawerTab] = useState<"requests" | "files" | "memory">("requests");
  const [memoryDraft, setMemoryDraft] = useState("");
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [memoryBusyId, setMemoryBusyId] = useState<string | null>(null);
  const [threadsOpen, setThreadsOpen] = useState(true);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [threadBusy, setThreadBusy] = useState(false);
  const [questionAnswers, setQuestionAnswers] = useState<Record<number, string>>({});
  const [dragActive, setDragActive] = useState(false);
  const [, setStaleTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const streamEndRef = useRef<HTMLDivElement>(null);
  const dragDepthRef = useRef(0);
  const loadSeqRef = useRef(0);
  const contextApiBasePath = apiBasePath
    ?? `/api/supply-os/workspaces/${workspaceId ?? ""}/context`;

  const load = useCallback(async () => {
    if (!workspaceId) return;
    const seq = ++loadSeqRef.current;
    const threadQuery = `?thread=${encodeURIComponent(activeThreadId ?? "general")}`;
    const response = await fetch(`${contextApiBasePath}${threadQuery}`, { cache: "no-store" });
    const payload = await response.json().catch(() => null) as { context?: ContextPayload; error?: string } | null;
    if (!response.ok || !payload?.context) throw new Error(payload?.error || "Chat could not be loaded.");
    if (seq === loadSeqRef.current) setData(payload.context);
    return payload.context;
  }, [activeThreadId, contextApiBasePath, workspaceId]);

  useEffect(() => {
    setError(null);
    void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Chat could not be loaded."));
  }, [load]);

  useEffect(() => {
    if (window.matchMedia("(max-width: 900px)").matches) {
      setFilesOpen(false);
      setThreadsOpen(false);
    }
  }, []);

  useEffect(() => {
    if (!busy) {
      setProcessingPhase(0);
      return;
    }
    const timer = window.setInterval(
      () => setProcessingPhase((phase) => Math.min(phase + 1, PROCESSING_PHASES.length - 1)),
      2_400,
    );
    return () => window.clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    const deadlines = (data?.prospectingActions ?? [])
      .filter((action) => action.status === "RUNNING")
      .map((action) => {
        const started = action.runningStartedAt ? Date.parse(action.runningStartedAt) : Number.NaN;
        return Number.isFinite(started) ? started + STALE_RUN_MS : Date.now();
      });
    const nextDeadline = deadlines.length ? Math.min(...deadlines) : null;
    if (nextDeadline === null) return;
    const timer = window.setTimeout(
      () => setStaleTick(Date.now()),
      Math.max(1, nextDeadline - Date.now() + 1),
    );
    return () => window.clearTimeout(timer);
  }, [data?.prospectingActions]);

  const threads = useMemo<Array<{ id: string | null; title: string }>>(
    () => [{ id: null, title: "General" }, ...(data?.threads ?? []).map((thread) => ({ id: thread.id, title: thread.title }))],
    [data?.threads],
  );

  const messages = useMemo(() => {
    const threadMessages = (data?.messages ?? []).filter((entry) => (entry.threadId ?? null) === activeThreadId);
    if (!optimisticMessage) return threadMessages;
    const persisted = threadMessages.some((entry) => entry.body === optimisticMessage.body && entry.role === messageRole);
    return persisted ? threadMessages : [...threadMessages, optimisticMessage];
  }, [activeThreadId, data?.messages, messageRole, optimisticMessage]);

  const openRequestCount = useMemo(() => {
    const procurement = (data?.procurementActions ?? []).filter((action) => action.status !== "DISMISSED").length;
    const prospecting = (data?.prospectingActions ?? []).filter((action) => action.status !== "DISMISSED").length;
    return procurement + prospecting;
  }, [data?.procurementActions, data?.prospectingActions]);

  const starterPrompts = useMemo(() => {
    const company = data?.workspace.name ?? "this company";
    return [
      {
        label: "Source a material",
        hint: "Quantity, material and delivery date go in the message",
        prefill: "Source 10 tons of ",
      },
      {
        label: `What do you know about ${company}?`,
        hint: "Profile, locations and saved files",
        prefill: null,
      },
      {
        label: "Where does each open request stand?",
        hint: `${openRequestCount} ongoing ${openRequestCount === 1 ? "request" : "requests"}`,
        prefill: null,
      },
      {
        label: "Find buyers for a product",
        hint: "Name the product and the target market",
        prefill: "Find buyers for ",
      },
    ];
  }, [data?.workspace.name, openRequestCount]);

  const lastAgentMessageId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === "AGENT") return messages[index].id;
    }
    return null;
  }, [messages]);

  useEffect(() => {
    setQuestionAnswers({});
  }, [lastAgentMessageId, activeThreadId]);

  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, busy]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [message]);

  async function submitMessage(event?: FormEvent, preparedInstruction?: string) {
    event?.preventDefault();
    const instruction = (preparedInstruction ?? message).trim();
    if (!workspaceId || readOnly || !instruction || busy) return;
    if (!preparedInstruction) setMessage("");
    setError(null);
    setBusy(true);
    setOptimisticMessage({
      id: `pending:${Date.now()}`,
      role: messageRole,
      body: instruction,
      citations: null,
      threadId: activeThreadId,
      createdAt: new Date().toISOString(),
      pending: true,
    });
    let messageSaved = false;
    try {
      const response = await fetch(`${contextApiBasePath}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instruction, threadId: activeThreadId }),
      });
      const payload = await response.json().catch(() => null) as { error?: string; messageSaved?: boolean } | null;
      messageSaved = payload?.messageSaved === true;
      if (!response.ok) throw new Error(payload?.error || "The reply did not finish.");
      await load();
      setOptimisticMessage(null);
    } catch (cause) {
      const refreshed = await load().catch(() => null);
      const persisted = messageSaved || refreshed?.messages.some((entry) => entry.role === messageRole && entry.body === instruction);
      if (!persisted && !preparedInstruction) setMessage(instruction);
      setOptimisticMessage(null);
      setError(cause instanceof Error ? cause.message : "The reply did not finish.");
    } finally {
      setBusy(false);
      textareaRef.current?.focus();
    }
  }

  async function uploadFiles(files: File[]) {
    if (!workspaceId || readOnly || !files.length) return;
    setError(null);
    setFilesOpen(true);
    setUploadingNames(files.map((file) => file.name));
    const failures: string[] = [];
    for (const file of files) {
      try {
        if (file.size < 1) throw new Error("The document is empty.");
        if (file.size > MAX_FILE_BYTES) throw new Error("Documents are limited to 10 MB.");
        const chunkCount = Math.ceil(file.size / UPLOAD_CHUNK_BYTES);
        const uploadId = chunkCount > 1 ? crypto.randomUUID() : null;
        for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
          const form = new FormData();
          const start = chunkIndex * UPLOAD_CHUNK_BYTES;
          const end = Math.min(start + UPLOAD_CHUNK_BYTES, file.size);
          form.set("file", chunkCount === 1 ? file : file.slice(start, end), file.name);
          if (uploadId) {
            form.set("uploadId", uploadId);
            form.set("chunkIndex", String(chunkIndex));
            form.set("chunkCount", String(chunkCount));
            form.set("fileName", file.name);
            form.set("fileType", file.type);
            form.set("fileSize", String(file.size));
          }
          const response = await fetch(`${contextApiBasePath}/documents`, {
            method: "POST",
            body: form,
          });
          const payload = await response.json().catch(() => null) as { error?: string } | null;
          if (!response.ok) throw new Error(payload?.error || `Upload failed (${response.status}).`);
        }
      } catch (cause) {
        failures.push(`${file.name}: ${cause instanceof Error ? cause.message : "Upload failed."}`);
      } finally {
        setUploadingNames((current) => current.filter((name) => name !== file.name));
      }
    }
    if (fileRef.current) fileRef.current.value = "";
    await load().catch(() => undefined);
    if (failures.length) setError(failures.join(" "));
  }

  async function decideProcurementAction(actionId: string, decision: "confirm" | "dismiss") {
    if (!workspaceId || readOnly || actionBusyId) return;
    setActionBusyId(actionId);
    setError(null);
    try {
      const response = await fetch(
        `${contextApiBasePath}/procurement/${encodeURIComponent(actionId)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision }),
        },
      );
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "The procurement decision did not finish.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The procurement decision did not finish.");
    } finally {
      setActionBusyId(null);
    }
  }

  async function decideProspectingAction(actionId: string, decision: "run" | "dismiss") {
    if (!workspaceId || readOnly || actionBusyId) return;
    setActionBusyId(actionId);
    setError(null);
    try {
      const response = await fetch(
        `${contextApiBasePath}/prospecting/${encodeURIComponent(actionId)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision }),
        },
      );
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "The prospecting run did not finish.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The prospecting run did not finish.");
    } finally {
      setActionBusyId(null);
    }
  }

  async function createThread() {
    if (!workspaceId || readOnly || threadBusy) return;
    setThreadBusy(true);
    setError(null);
    try {
      const response = await fetch(`${contextApiBasePath}/threads`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "New chat" }),
      });
      const payload = await response.json().catch(() => null) as { thread?: ContextThread; error?: string } | null;
      if (!response.ok || !payload?.thread) throw new Error(payload?.error || "The chat could not be created.");
      const thread = payload.thread;
      setData((current) => current ? { ...current, threads: [...(current.threads ?? []), thread] } : current);
      setActiveThreadId(thread.id);
      textareaRef.current?.focus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The chat could not be created.");
    } finally {
      setThreadBusy(false);
    }
  }

  async function deleteThread(threadId: string, title: string) {
    if (!workspaceId || readOnly || threadBusy) return;
    if (!window.confirm(`Delete the chat "${title}"? Its messages are removed. Requests, files, and memory are kept.`)) return;
    setThreadBusy(true);
    setError(null);
    try {
      const response = await fetch(`${contextApiBasePath}/threads`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "The chat could not be deleted.");
      setData((current) => current
        ? {
            ...current,
            threads: (current.threads ?? []).filter((thread) => thread.id !== threadId),
            messages: (current.messages ?? []).filter((entry) => (entry.threadId ?? null) !== threadId),
          }
        : current);
      if (activeThreadId === threadId) setActiveThreadId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The chat could not be deleted.");
    } finally {
      setThreadBusy(false);
    }
  }

  async function saveMemoryNote(event?: FormEvent) {
    event?.preventDefault();
    const note = memoryDraft.trim();
    if (!workspaceId || readOnly || !note || memoryBusy) return;
    setMemoryBusy(true);
    setError(null);
    try {
      const response = await fetch(`${contextApiBasePath}/memory`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "The memory note could not be saved.");
      setMemoryDraft("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The memory note could not be saved.");
    } finally {
      setMemoryBusy(false);
    }
  }

  async function deleteMemoryNote(memoryId: string) {
    if (!workspaceId || readOnly || memoryBusyId) return;
    setMemoryBusyId(memoryId);
    setError(null);
    try {
      const response = await fetch(`${contextApiBasePath}/memory`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memoryId }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "The memory note could not be removed.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The memory note could not be removed.");
    } finally {
      setMemoryBusyId(null);
    }
  }

  function toggleQuestionAnswer(questionIndex: number, answer: string) {
    if (busy) return;
    setQuestionAnswers((current) => {
      const next = { ...current };
      if (next[questionIndex] === answer) {
        delete next[questionIndex];
      } else {
        next[questionIndex] = answer;
      }
      return next;
    });
  }

  function sendQuestionAnswers(questions: ContextQuestion[]) {
    if (busy) return;
    const combined = questions
      .map((question, questionIndex) => {
        const answer = questionAnswers[questionIndex];
        return answer ? `${question.question} ${answer}` : null;
      })
      .filter((line): line is string => line !== null)
      .join("\n");
    if (!combined) return;
    void submitMessage(undefined, combined);
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void submitMessage();
  }

  function onDragEnter(event: DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  }

  function onDragLeave(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    dragDepthRef.current -= 1;
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0;
      setDragActive(false);
    }
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    void uploadFiles(Array.from(event.dataTransfer.files));
  }

  if (!workspaceId) {
    return <div className={styles.unavailable}><strong>Open a company</strong><span>Chat belongs to a saved company workspace.</span></div>;
  }
  if (!data && !error) {
    return <div className={styles.unavailable}><LoaderCircle className={styles.spinner} size={21} /><span>Loading context</span></div>;
  }
  if (!data) {
    return <div className={styles.unavailable}><strong>Chat unavailable</strong><span>{error}</span><button type="button" onClick={() => void load()}>Retry</button></div>;
  }

  return (
    <section
      className={`${styles.context} supply-os-workspace`}
      data-files-open={filesOpen}
      data-threads-open={threadsOpen}
      aria-label="Company chat"
      onDragEnter={readOnly ? undefined : onDragEnter}
      onDragOver={readOnly ? undefined : (event) => event.preventDefault()}
      onDragLeave={readOnly ? undefined : onDragLeave}
      onDrop={readOnly ? undefined : onDrop}
    >
      <aside className={threadsOpen ? styles.threadsRail : styles.threadsRailClosed} aria-label="Chats">
        <header>
          <strong>Chats</strong>
          <button type="button" onClick={() => setThreadsOpen(false)} aria-label="Close chats"><X size={18} /></button>
        </header>
        {!readOnly ? (
          <button
            type="button"
            className={styles.newThreadButton}
            disabled={threadBusy}
            onClick={() => void createThread()}
          >
            {threadBusy ? <LoaderCircle className={styles.spinner} size={16} /> : <MessageSquarePlus size={16} aria-hidden="true" />}
            New chat
          </button>
        ) : null}
        <div className={styles.threadList}>
          {threads.map((thread) => (
            <div key={thread.id ?? "general"} className={styles.threadRow}>
              <button
                type="button"
                className={styles.threadItem}
                data-active={(thread.id ?? null) === activeThreadId}
                onClick={() => setActiveThreadId(thread.id)}
              >
                <MessagesSquare size={15} aria-hidden="true" />
                <span>{thread.title}</span>
              </button>
              {threadDeleteEnabled && !readOnly && thread.id ? (
                <button
                  type="button"
                  className={styles.threadDelete}
                  disabled={threadBusy}
                  aria-label={`Delete chat ${thread.title}`}
                  onClick={() => void deleteThread(thread.id!, thread.title)}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </aside>

      <section className={styles.chatPane} aria-label={`${data.workspace.name} chat conversation`}>
        <header className={styles.chatHeader}>
          <span className={styles.chatHeaderTitle}>
            {!threadsOpen ? (
              <button type="button" onClick={() => setThreadsOpen(true)} aria-label="Open chats">
                <MessagesSquare size={17} aria-hidden="true" />
                <span>Chats</span>
              </button>
            ) : null}
            <strong>{data.workspace.name} · {threads.find((thread) => (thread.id ?? null) === activeThreadId)?.title ?? "General"}</strong>
          </span>
          {!filesOpen ? (
            <button
              type="button"
              onClick={() => setFilesOpen(true)}
              aria-label={`Open requests and files, ${openRequestCount} ongoing ${openRequestCount === 1 ? "request" : "requests"}`}
            >
              <ListTodo size={17} aria-hidden="true" />
              <span>Requests</span>
              {openRequestCount ? <i>{openRequestCount}</i> : null}
            </button>
          ) : null}
        </header>

        <div className={styles.stream} aria-live="polite">
          {!messages.length ? (
            <div className={styles.empty}>
              <strong>Ask Derya about {data.workspace.name}</strong>
              <span>Pick a starting point, or type your own question.</span>
              {!readOnly ? (
                <div className={styles.starters}>
                  {starterPrompts.map((starter) => (
                    <button
                      type="button"
                      key={starter.label}
                      className={styles.starter}
                      disabled={busy}
                      onClick={() => {
                        if (starter.prefill) {
                          setMessage(starter.prefill);
                          textareaRef.current?.focus();
                          return;
                        }
                        void submitMessage(undefined, starter.label);
                      }}
                    >
                      <strong>{starter.label}</strong>
                      <span>{starter.hint}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : messages.map((entry) => (
            <article
              key={entry.id}
              className={styles.message}
              data-role={entry.role}
              data-pending={"pending" in entry && entry.pending === true ? "true" : undefined}
            >
              <div className={styles.messageInner}>
                {entry.role === "AGENT" ? <strong className={styles.messageAuthor}>Derya</strong> : null}
                {entry.role === "CUSTOMER" ? <strong className={styles.messageAuthor}>Customer</strong> : null}
                <MessageBody body={entry.body} />
                {"pending" in entry && entry.pending === true ? (
                  <span className={styles.messageStatus}>Sending</span>
                ) : null}
                {documentCitations(entry.citations).length ? (
                  <div className={styles.citations} aria-label="Sources">
                    {documentCitations(entry.citations).map((citation) => (
                      <span key={citation.id}>{citation.label}</span>
                    ))}
                  </div>
                ) : null}
                {entry.role === "AGENT" && Array.isArray(entry.questions) && entry.questions.length ? (
                  <div className={styles.questionList} aria-label="Clarifying questions">
                    {entry.questions.map((question, questionIndex) => (
                      <div className={styles.questionBlock} key={`${entry.id}:${questionIndex}`}>
                        <span className={styles.questionText}>{question.question}</span>
                        <div className={styles.questionOptions}>
                          {(question.kind === "yes_no" ? ["Yes", "No"] : question.options).map((option) => (
                            <button
                              type="button"
                              key={option}
                              className={styles.questionChip}
                              data-selected={entry.id === lastAgentMessageId && questionAnswers[questionIndex] === option}
                              aria-pressed={entry.id === lastAgentMessageId && questionAnswers[questionIndex] === option}
                              disabled={readOnly || busy || entry.id !== lastAgentMessageId}
                              onClick={() => toggleQuestionAnswer(questionIndex, option)}
                            >{option}</button>
                          ))}
                        </div>
                      </div>
                    ))}
                    {entry.id === lastAgentMessageId && !readOnly ? (
                      <button
                        type="button"
                        className={styles.sendAnswersButton}
                        disabled={busy || !Object.keys(questionAnswers).length}
                        onClick={() => sendQuestionAnswers(entry.questions ?? [])}
                      >
                        {Object.keys(questionAnswers).length > 1
                          ? `Send ${Object.keys(questionAnswers).length} answers`
                          : "Send answer"}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </article>
          ))}
          {busy ? (
            <div className={styles.thinking} role="status">
              <Sparkles className={styles.pulse} size={16} aria-hidden="true" />
              <span key={processingPhase} className={styles.thinkingPhase}>{PROCESSING_PHASES[processingPhase]}</span>
            </div>
          ) : null}
          <div ref={streamEndRef} />
        </div>

        {!readOnly ? <form className={styles.composerArea} onSubmit={submitMessage}>
          <div className={styles.composer}>
            <button className={styles.attachButton} type="button" onClick={() => fileRef.current?.click()} aria-label="Add files" title="Add files">
              <Paperclip size={20} aria-hidden="true" />
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={ACCEPTED_FILES}
              onChange={(event) => void uploadFiles(Array.from(event.target.files ?? []))}
            />
            <textarea
              ref={textareaRef}
              aria-label="Message Derya"
              rows={1}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={onComposerKeyDown}
              placeholder="Ask Derya"
            />
            <button className={styles.sendButton} type="submit" disabled={busy || !message.trim()} aria-label="Send message">
              {busy ? <LoaderCircle className={styles.spinner} size={18} /> : <ArrowUp size={20} aria-hidden="true" />}
            </button>
          </div>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
        </form> : error ? <p className={styles.error} role="alert">{error}</p> : null}
      </section>

      <aside className={filesOpen ? styles.fileDrawerOpen : styles.fileDrawerClosed} aria-label="Ongoing requests and files">
        <header>
          <div className={styles.drawerTabs} role="tablist" aria-label="Panel sections">
            <button type="button" role="tab" aria-selected={drawerTab === "requests"} data-active={drawerTab === "requests"} onClick={() => setDrawerTab("requests")}>
              Requests{openRequestCount ? <i>{openRequestCount}</i> : null}
            </button>
            <button type="button" role="tab" aria-selected={drawerTab === "files"} data-active={drawerTab === "files"} onClick={() => setDrawerTab("files")}>
              Files{data.documents.length ? <i>{data.documents.length}</i> : null}
            </button>
            {memoryEnabled ? (
              <button type="button" role="tab" aria-selected={drawerTab === "memory"} data-active={drawerTab === "memory"} onClick={() => setDrawerTab("memory")}>
                Memory{(data.memory ?? []).length ? <i>{(data.memory ?? []).length}</i> : null}
              </button>
            ) : null}
          </div>
          <button type="button" onClick={() => setFilesOpen(false)} aria-label="Close panel"><X size={20} /></button>
        </header>
        {drawerTab === "memory" && memoryEnabled ? (
        <div className={styles.memoryList}>
          <p className={styles.memoryHint}>Shared company memory. Every chat for {data.workspace.name} reads these notes.</p>
          {!readOnly ? (
            <form className={styles.memoryForm} onSubmit={saveMemoryNote}>
              <input
                type="text"
                value={memoryDraft}
                maxLength={500}
                placeholder="Save a durable fact or preference"
                aria-label="New memory note"
                onChange={(event) => setMemoryDraft(event.target.value)}
              />
              <button type="submit" disabled={memoryBusy || !memoryDraft.trim()}>
                {memoryBusy ? <LoaderCircle className={styles.spinner} size={16} /> : <Brain size={16} aria-hidden="true" />}
                Save
              </button>
            </form>
          ) : null}
          {(data.memory ?? []).map((memory) => (
            <div className={styles.memoryRow} key={memory.id}>
              <span>{memory.note}</span>
              {!readOnly ? (
                <button
                  type="button"
                  aria-label="Remove memory note"
                  disabled={Boolean(memoryBusyId)}
                  onClick={() => void deleteMemoryNote(memory.id)}
                >
                  {memoryBusyId === memory.id ? <LoaderCircle className={styles.spinner} size={16} /> : <Trash2 size={16} aria-hidden="true" />}
                </button>
              ) : null}
            </div>
          ))}
          {!(data.memory ?? []).length ? (
            <div className={styles.filesEmpty}><span>No saved memory yet</span></div>
          ) : null}
        </div>
        ) : drawerTab === "requests" ? (
        <div className={styles.requestList}>
          {!openRequestCount ? (
            <div className={styles.filesEmpty}><span>No ongoing requests</span></div>
          ) : null}
          {(data.procurementActions ?? []).filter((action) => action.status !== "DISMISSED").map((action) => (
            <article className={styles.procurementAction} data-status={action.status} key={action.id}>
              <header>
                <span className={styles.procurementActionIcon}><Search size={18} aria-hidden="true" /></span>
                <span>
                  <strong>{action.status === "CREATED"
                    ? "Procurement started"
                    : action.status === "CREATING"
                      ? "Procurement is starting"
                      : "Start procurement?"}</strong>
                  <small>{action.draft.material}</small>
                </span>
              </header>
              <dl>
                <div><dt>Quantity</dt><dd>{action.draft.quantity.toLocaleString("en-US")} {action.draft.unit}</dd></div>
                {action.draft.partNumber ? <div><dt>Part</dt><dd>{action.draft.partNumber}</dd></div> : null}
                {action.draft.manufacturer ? <div><dt>Manufacturer</dt><dd>{action.draft.manufacturer}</dd></div> : null}
                {action.draft.neededBy ? <div><dt>Needed by</dt><dd>{action.draft.neededBy}</dd></div> : null}
                {action.draft.deliveryLocation ? <div><dt>Deliver to</dt><dd>{action.draft.deliveryLocation}</dd></div> : null}
              </dl>
              {action.draft.specification ? <p className={styles.procurementSpecification}>{action.draft.specification}</p> : null}
              {documentCitations(action.citations).length ? (
                <div className={styles.citations} aria-label="Procurement sources">
                  {documentCitations(action.citations).map((citation) => (
                    <span key={citation.id}>{citation.label}</span>
                  ))}
                </div>
              ) : null}
              {action.status === "CREATED" && action.order ? (
                <div className={styles.procurementResult}>
                  <span>{showOrderId && action.order.id ? `Order ${action.order.id}` : "Supplier research"}</span>
                  <strong>{action.order.workflowWakeRequested === false ? "Queued" : "Research requested"}</strong>
                </div>
              ) : readOnly ? (
                <p className={styles.approvalBoundary}>View-only access.</p>
              ) : action.status === "CREATING" ? (
                <>
                  <div className={styles.procurementResult}>
                    <span>Confirmation accepted</span>
                    <strong>Creating supplier research request</strong>
                  </div>
                  <div className={styles.procurementButtons}>
                    <button
                      type="button"
                      className={styles.dismissProcurement}
                      disabled={Boolean(actionBusyId)}
                      onClick={() => void decideProcurementAction(action.id, "confirm")}
                    >Retry if this remains for 30 seconds</button>
                  </div>
                </>
              ) : (
                <>
                  <p className={styles.approvalBoundary}>Creates one supplier research request. It does not contact or select a supplier.</p>
                  <div className={styles.procurementButtons}>
                    <button
                      type="button"
                      className={styles.confirmProcurement}
                      disabled={Boolean(actionBusyId)}
                      onClick={() => void decideProcurementAction(action.id, "confirm")}
                    >
                      {actionBusyId === action.id ? <LoaderCircle className={styles.spinner} size={17} /> : null}
                      Start procurement
                    </button>
                    <button
                      type="button"
                      className={styles.dismissProcurement}
                      disabled={Boolean(actionBusyId)}
                      onClick={() => void decideProcurementAction(action.id, "dismiss")}
                    >Dismiss</button>
                  </div>
                </>
              )}
            </article>
          ))}
          {(data.prospectingActions ?? []).filter((action) => action.status !== "DISMISSED").map((action) => (
            <article className={styles.procurementAction} data-status={action.status} key={action.id}>
              <header>
                <span className={styles.procurementActionIcon}><Search size={18} aria-hidden="true" /></span>
                <span>
                  <strong>{action.status === "RUNNING"
                    ? "Research is running"
                    : action.status === "FAILED"
                      ? "Research needs a retry"
                      : action.status === "COMPLETED"
                        ? "Research complete"
                        : "Start prospect research?"}</strong>
                  <small>{action.draft.objective}</small>
                </span>
              </header>
              <dl>
                <div><dt>Segments</dt><dd>{action.draft.segments.join(", ")}</dd></div>
                <div><dt>Regions</dt><dd>{action.draft.regions.join(", ")}</dd></div>
                <div><dt>Product</dt><dd>{action.draft.productFocus}</dd></div>
                <div><dt>List</dt><dd>{action.draft.listSlug}</dd></div>
              </dl>
              <dl>
                <div><dt>Queries used</dt><dd>{action.stats.queriesUsed}</dd></div>
                <div><dt>Pages fetched</dt><dd>{action.stats.pagesFetched}</dd></div>
                <div><dt>Candidates found</dt><dd>{action.stats.candidatesFound}</dd></div>
                <div><dt>Rows created</dt><dd>{action.stats.rowsCreated}</dd></div>
                <div><dt>Rows updated</dt><dd>{action.stats.rowsUpdated}</dd></div>
              </dl>
              {documentCitations(action.citations).length ? (
                <div className={styles.citations} aria-label="Prospecting sources">
                  {documentCitations(action.citations).map((citation) => (
                    <span key={citation.id}>{citation.label}</span>
                  ))}
                </div>
              ) : null}
              <p className={styles.approvalBoundary}>Reads public pages only. Writes rows for review. It does not contact anyone.</p>
              {action.status === "COMPLETED" ? (
                <div className={styles.procurementResult}>
                  <span>{action.exhausted ? "All planned queries processed" : "Batch complete"}</span>
                  <strong>
                    <Link href={`/dashboard/supply-os?panel=materials&materialsView=prospects&researchList=${encodeURIComponent(action.draft.listSlug)}`}>
                      Open results
                    </Link>
                  </strong>
                </div>
              ) : null}
              {readOnly ? (
                <p className={styles.approvalBoundary}>View-only access.</p>
              ) : action.status === "RUNNING" ? (
                prospectingRunIsStale(action, Date.now()) ? (
                  <>
                    <p className={styles.approvalBoundary}>The previous research run was interrupted. You can retry or dismiss it.</p>
                    <div className={styles.procurementButtons}>
                      <button
                        type="button"
                        className={styles.confirmProcurement}
                        disabled={Boolean(actionBusyId)}
                        onClick={() => void decideProspectingAction(action.id, "run")}
                      >
                        {actionBusyId === action.id ? <LoaderCircle className={styles.spinner} size={17} /> : null}
                        Retry research
                      </button>
                      <button
                        type="button"
                        className={styles.dismissProcurement}
                        disabled={Boolean(actionBusyId)}
                        onClick={() => void decideProspectingAction(action.id, "dismiss")}
                      >Dismiss</button>
                    </div>
                  </>
                ) : (
                  <div className={styles.procurementResult}>
                    <span>Confirmation accepted</span>
                    <strong>Research is running</strong>
                  </div>
                )
              ) : (
                <div className={styles.procurementButtons}>
                  {action.status !== "COMPLETED" || !action.exhausted ? (
                    <button
                      type="button"
                      className={styles.confirmProcurement}
                      disabled={Boolean(actionBusyId)}
                      onClick={() => void decideProspectingAction(action.id, "run")}
                    >
                      {actionBusyId === action.id ? <LoaderCircle className={styles.spinner} size={17} /> : null}
                      {action.status === "COMPLETED" ? "Continue research" : action.status === "FAILED" ? "Retry research" : "Run research"}
                    </button>
                  ) : null}
                  {action.status === "PENDING" || action.status === "FAILED" ? (
                    <button
                      type="button"
                      className={styles.dismissProcurement}
                      disabled={Boolean(actionBusyId)}
                      onClick={() => void decideProspectingAction(action.id, "dismiss")}
                    >Dismiss</button>
                  ) : null}
                </div>
              )}
            </article>
          ))}
        </div>
        ) : (
        <div className={styles.fileList}>
          {uploadingNames.map((name) => (
            <div className={styles.fileRow} key={`uploading:${name}`} data-uploading="true">
              <span className={styles.fileIcon} data-kind="document"><LoaderCircle className={styles.spinner} size={21} /></span>
              <span><strong>{name}</strong><small>Uploading</small></span>
            </div>
          ))}
          {data.documents.map((document) => (
            <a
              className={styles.fileRow}
              key={document.id}
              href={`${contextApiBasePath}/documents/${encodeURIComponent(document.id)}`}
              title={document.processingError || document.summary || document.name}
            >
              <FileKindIcon document={document} />
              <span>
                <strong>{document.name}</strong>
                <small>{fileExtension(document.name)} · {formatBytes(document.sizeBytes)} · {documentState(document)}</small>
              </span>
            </a>
          ))}
          {!uploadingNames.length && !data.documents.length ? (
            <div className={styles.filesEmpty}><span>No files</span>{!readOnly ? <button type="button" onClick={() => fileRef.current?.click()}>Add files</button> : null}</div>
          ) : null}
        </div>
        )}
      </aside>

      {dragActive && !readOnly ? (
        <div className={styles.dropTarget} role="status">
          <Paperclip size={25} />
          <strong>Drop files here</strong>
        </div>
      ) : null}
    </section>
  );
}
