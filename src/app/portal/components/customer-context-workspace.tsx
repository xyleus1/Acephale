"use client";

import { FileText, LoaderCircle, Plus, Send, Upload } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "../customer-context.module.css";

type Node = { id: string; parentId: string | null; scopeType: string; name: string };
type Message = { id: string; nodeId: string; role: string; body: string; createdAt: string; citations?: Array<{ id: string; label: string }> | null };
type Document = { id: string; nodeId: string; name: string; processingState: string; extractionError: string | null; createdAt: string };
type Fact = { id: string; key: string; value: unknown; inherited?: boolean };
type Payload = { nodes: Node[]; selectedNodeId: string; messages: Message[]; documents: Document[]; resolvedFacts: Fact[]; conflicts: Array<{ key: string }> };

function orderedNodes(nodes: Node[]) {
  const children = new Map<string | null, Node[]>();
  for (const node of nodes) children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]);
  const output: Array<Node & { depth: number }> = [];
  const visit = (parentId: string | null, depth: number) => { for (const node of children.get(parentId) ?? []) { output.push({ ...node, depth }); visit(node.id, depth + 1); } };
  visit(null, 0);
  return output;
}

export function CustomerContextWorkspace({ companyId, canAct }: { companyId: string; canAct: boolean }) {
  const [data, setData] = useState<Payload | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [newScope, setNewScope] = useState({ name: "", scopeType: "PRODUCT" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const load = useCallback(async (nodeId?: string | null) => {
    const query = new URLSearchParams({ company: companyId });
    if (nodeId) query.set("node", nodeId);
    const response = await fetch(`/api/portal/context?${query}`, { cache: "no-store" });
    const payload = await response.json().catch(() => null) as { context?: Payload; error?: string } | null;
    if (!response.ok || !payload?.context) throw new Error(payload?.error || "Context could not be loaded.");
    setData(payload.context);
    setSelectedNodeId(payload.context.selectedNodeId);
  }, [companyId]);
  useEffect(() => { void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Context could not be loaded.")); }, [load]);
  const selected = data?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const nodes = useMemo(() => orderedNodes(data?.nodes ?? []), [data?.nodes]);
  const messages = useMemo(
    () => (data?.messages ?? []).filter((entry) => entry.nodeId === selectedNodeId),
    [data?.messages, selectedNodeId],
  );
  const documents = useMemo(
    () => (data?.documents ?? []).filter((entry) => entry.nodeId === selectedNodeId),
    [data?.documents, selectedNodeId],
  );
  useEffect(() => {
    setNewScope((current) => ({ ...current, scopeType: selected?.scopeType === "COMPANY" ? "PRODUCT" : "REQUEST" }));
  }, [selected?.scopeType]);

  async function request(url: string, init: RequestInit) {
    setBusy(true); setError(null);
    try {
      const response = await fetch(url, init);
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "Context update failed.");
      await load(selectedNodeId);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Context update failed.");
      return false;
    }
    finally { setBusy(false); }
  }

  async function postMessage(event: FormEvent) {
    event.preventDefault();
    if (!selectedNodeId || !message.trim()) return;
    const body = message.trim();
    const saved = await request("/api/portal/context", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "POST_MESSAGE", companyId, nodeId: selectedNodeId, body }) });
    if (saved) setMessage("");
  }

  async function upload(file: File) {
    if (!selectedNodeId) return;
    const form = new FormData(); form.set("companyId", companyId); form.set("nodeId", selectedNodeId); form.set("file", file);
    const saved = await request("/api/portal/context/documents", { method: "POST", body: form });
    if (saved && fileRef.current) fileRef.current.value = "";
  }

  if (!data) return <div className={styles.loading}>{error || "Loading context"}</div>;
  return (
    <div className={styles.workspace}>
      <aside className={styles.scopes}>
        <header><strong>Context</strong><span>{nodes.length} scopes</span></header>
        <nav>{nodes.map((node) => <button key={node.id} type="button" data-active={node.id === selectedNodeId} style={{ paddingLeft: 14 + node.depth * 18 }} onClick={() => void load(node.id)}><small>{node.scopeType}</small><strong>{node.name}</strong></button>)}</nav>
        {canAct && selected && ["COMPANY", "PRODUCT"].includes(selected.scopeType) ? <form onSubmit={(event) => { event.preventDefault(); if (!selectedNodeId || !newScope.name.trim()) return; void request("/api/portal/context", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "CREATE_NODE", companyId, parentId: selectedNodeId, ...newScope }) }).then(() => setNewScope({ ...newScope, name: "" })); }}><input aria-label="New context name" placeholder="Product or request" value={newScope.name} onChange={(event) => setNewScope({ ...newScope, name: event.target.value })} /><div><select value={newScope.scopeType} onChange={(event) => setNewScope({ ...newScope, scopeType: event.target.value })}>{selected.scopeType === "COMPANY" ? <><option>PRODUCT</option><option>REQUEST</option></> : <option>REQUEST</option>}</select><button type="submit" disabled={!newScope.name.trim() || busy}><Plus size={15} />Add</button></div></form> : null}
      </aside>
      <main className={styles.conversation}>
        <header><div><strong>{selected?.name}</strong><span>{selected?.scopeType.toLowerCase()}</span></div>{canAct ? <label><Upload size={16} />Upload<input ref={fileRef} type="file" accept=".pdf,.txt,.csv,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} /></label> : null}</header>
        <div className={styles.stream}>{messages.length ? messages.map((entry) => <article key={entry.id} data-role={entry.role}><header><strong>{entry.role === "CUSTOMER" ? "Customer" : "Derya"}</strong><time>{new Date(entry.createdAt).toLocaleString()}</time></header><p>{entry.body}</p>{Array.isArray(entry.citations) && entry.citations.length ? <div>{entry.citations.map((citation) => <span key={citation.id}>{citation.label}</span>)}</div> : null}</article>) : <div className={styles.empty}><strong>No messages</strong><span>Messages and published replies stay with this scope.</span></div>}{documents.map((document) => <a key={document.id} href={`/api/portal/context/documents/${document.id}`}><FileText size={17} /><span><strong>{document.name}</strong><small>{document.processingState.toLowerCase()}{document.extractionError ? `: ${document.extractionError}` : ""}</small></span></a>)}</div>
        {canAct ? <form className={styles.composer} onSubmit={postMessage}><textarea aria-label="Message to Derya" rows={3} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Add product details or ask Derya" /><div>{error ? <span>{error}</span> : <span>Shared with Derya</span>}<button type="submit" disabled={busy || !message.trim()}>{busy ? <LoaderCircle className={styles.spinner} size={16} /> : <Send size={16} />}Send</button></div></form> : <div className={styles.readOnly}>Viewer access is read-only.</div>}
      </main>
      <aside className={styles.facts}><header><strong>Confirmed facts</strong><span>{data.resolvedFacts.length}</span></header>{data.conflicts.length ? <div className={styles.conflict}><strong>Review in progress</strong>{data.conflicts.map((conflict) => <span key={conflict.key}>{conflict.key}</span>)}</div> : null}<div>{data.resolvedFacts.map((fact) => <dl key={fact.id}><dt>{fact.key}{fact.inherited ? " · inherited" : ""}</dt><dd>{typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value)}</dd></dl>)}</div></aside>
    </div>
  );
}
