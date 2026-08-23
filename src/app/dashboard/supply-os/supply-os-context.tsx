"use client";

import {
  ArrowUp,
  Box,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  Files,
  LoaderCircle,
  Paperclip,
  Search,
  X,
} from "lucide-react";
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
import styles from "./supply-os-context.module.css";

type ContextMessage = {
  id: string;
  role: string;
  body: string;
  citations?: Array<{ id: string; label: string }> | null;
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

type ContextPayload = {
  workspace: { id: string; name: string };
  messages: ContextMessage[];
  documents: ContextDocument[];
  procurementActions: ContextProcurementAction[];
};

type OptimisticMessage = ContextMessage & { pending: true };

const ACCEPTED_FILES = ".pdf,.md,.txt,.csv,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.zip,.stl";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const UPLOAD_CHUNK_BYTES = 3 * 1024 * 1024;

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
}: {
  workspaceId: string | null;
  apiBasePath?: string;
  readOnly?: boolean;
  messageRole?: "OPERATOR" | "CUSTOMER";
  showOrderId?: boolean;
}) {
  const [data, setData] = useState<ContextPayload | null>(null);
  const [message, setMessage] = useState("");
  const [optimisticMessage, setOptimisticMessage] = useState<OptimisticMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [uploadingNames, setUploadingNames] = useState<string[]>([]);
  const [filesOpen, setFilesOpen] = useState(true);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const streamEndRef = useRef<HTMLDivElement>(null);
  const dragDepthRef = useRef(0);
  const contextApiBasePath = apiBasePath
    ?? `/api/supply-os/workspaces/${workspaceId ?? ""}/context`;

  const load = useCallback(async () => {
    if (!workspaceId) return;
    const response = await fetch(contextApiBasePath, { cache: "no-store" });
    const payload = await response.json().catch(() => null) as { context?: ContextPayload; error?: string } | null;
    if (!response.ok || !payload?.context) throw new Error(payload?.error || "Context could not be loaded.");
    setData(payload.context);
    return payload.context;
  }, [contextApiBasePath, workspaceId]);

  useEffect(() => {
    setError(null);
    void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Context could not be loaded."));
  }, [load]);

  useEffect(() => {
    if (window.matchMedia("(max-width: 900px)").matches) setFilesOpen(false);
  }, []);

  const messages = useMemo(() => {
    if (!optimisticMessage) return data?.messages ?? [];
    const persisted = data?.messages.some((entry) => entry.body === optimisticMessage.body && entry.role === messageRole);
    return persisted ? data?.messages ?? [] : [...(data?.messages ?? []), optimisticMessage];
  }, [data?.messages, messageRole, optimisticMessage]);

  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, busy]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [message]);

  async function submitMessage(event?: FormEvent) {
    event?.preventDefault();
    if (!workspaceId || readOnly || !message.trim() || busy) return;
    const instruction = message.trim();
    setMessage("");
    setError(null);
    setBusy(true);
    setOptimisticMessage({
      id: `pending:${Date.now()}`,
      role: messageRole,
      body: instruction,
      citations: null,
      createdAt: new Date().toISOString(),
      pending: true,
    });
    let messageSaved = false;
    try {
      const response = await fetch(`${contextApiBasePath}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instruction }),
      });
      const payload = await response.json().catch(() => null) as { error?: string; messageSaved?: boolean } | null;
      messageSaved = payload?.messageSaved === true;
      if (!response.ok) throw new Error(payload?.error || "The reply did not finish.");
      await load();
      setOptimisticMessage(null);
    } catch (cause) {
      const refreshed = await load().catch(() => null);
      const persisted = messageSaved || refreshed?.messages.some((entry) => entry.role === messageRole && entry.body === instruction);
      if (!persisted) setMessage(instruction);
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
    return <div className={styles.unavailable}><strong>Open a company</strong><span>Context belongs to a saved company workspace.</span></div>;
  }
  if (!data && !error) {
    return <div className={styles.unavailable}><LoaderCircle className={styles.spinner} size={21} /><span>Loading context</span></div>;
  }
  if (!data) {
    return <div className={styles.unavailable}><strong>Context unavailable</strong><span>{error}</span><button type="button" onClick={() => void load()}>Retry</button></div>;
  }

  return (
    <section
      className={`${styles.context} supply-os-workspace`}
      data-files-open={filesOpen}
      aria-label="Context chat"
      onDragEnter={readOnly ? undefined : onDragEnter}
      onDragOver={readOnly ? undefined : (event) => event.preventDefault()}
      onDragLeave={readOnly ? undefined : onDragLeave}
      onDrop={readOnly ? undefined : onDrop}
    >
      <section className={styles.chatPane} aria-label={`${data.workspace.name} context conversation`}>
        <header className={styles.chatHeader}>
          <strong>{data.workspace.name}</strong>
          {!filesOpen ? (
            <button
              type="button"
              onClick={() => setFilesOpen(true)}
              aria-label={`Open files, ${data.documents.length} ${data.documents.length === 1 ? "file" : "files"}`}
            >
              <Files size={17} aria-hidden="true" />
              <span>Files</span>
              {data.documents.length ? <i>{data.documents.length}</i> : null}
            </button>
          ) : null}
        </header>

        <div className={styles.stream} aria-live="polite">
          {!messages.length ? (
            <div className={styles.empty}>
              <strong>No messages</strong>
              <span>Add files or ask a question.</span>
            </div>
          ) : messages.map((entry) => (
            <article key={entry.id} className={styles.message} data-role={entry.role}>
              <div className={styles.messageInner}>
                {entry.role === "AGENT" ? <strong className={styles.messageAuthor}>Derya</strong> : null}
                {entry.role === "CUSTOMER" ? <strong className={styles.messageAuthor}>Customer</strong> : null}
                <MessageBody body={entry.body} />
                {Array.isArray(entry.citations) && entry.citations.length ? (
                  <div className={styles.citations} aria-label="Sources">
                    {entry.citations.map((citation) => <span key={citation.id}>{citation.label}</span>)}
                  </div>
                ) : null}
              </div>
            </article>
          ))}
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
              {action.citations.length ? (
                <div className={styles.citations} aria-label="Procurement sources">
                  {action.citations.map((citation) => <span key={citation.id}>{citation.label}</span>)}
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
          {busy ? (
            <div className={styles.thinking} role="status">
              <LoaderCircle className={styles.spinner} size={18} />
              <span>Working</span>
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

      <aside className={filesOpen ? styles.fileDrawerOpen : styles.fileDrawerClosed} aria-label="Files in context">
        <header>
          <strong>Files in context</strong>
          <button type="button" onClick={() => setFilesOpen(false)} aria-label="Close files"><X size={20} /></button>
        </header>
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
