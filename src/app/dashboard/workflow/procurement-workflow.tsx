"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  PROCUREMENT_ACTIVE_STATUSES,
  PROCUREMENT_APPROVAL_STATUSES,
  PROCUREMENT_STATUS_LABELS,
} from "@/lib/procurement-status";
import styles from "./workflow-dashboard.module.css";

type RequestSummary = {
  id: string;
  status: string;
  progress: string | null;
  neededBy: string | null;
  quantity: number;
  unit: string;
  material: string;
  specification: string | null;
  updatedAt: string;
};

type Vendor = {
  id: string;
  name: string;
  website: string | null;
  status: string;
  research: Record<string, unknown>;
  quote: Record<string, unknown> | null;
};

type RequestDetail = RequestSummary & {
  requestContext: Record<string, unknown>;
  approvalRequestedAt: string | null;
  decisionSnapshot: Record<string, unknown> | null;
  vendors: Vendor[];
};

function statusLabel(status: string) {
  return PROCUREMENT_STATUS_LABELS[status] ?? status.replaceAll("_", " ");
}
function formattedDate(value: string | null) {
  if (!value) return "Not set";
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.valueOf())
    ? value
    : new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(parsed);
}

function evidenceSummary(research: Record<string, unknown>) {
  const preferredKeys = ["summary", "evidence", "sources", "source", "qualification", "notes"];
  const snippets: string[] = [];
  function collect(value: unknown, depth = 0) {
    if (snippets.length >= 3 || depth > 2 || value === null || value === undefined) return;
    if (typeof value === "string") {
      const normalized = value.replace(/\s+/g, " ").trim();
      if (normalized) snippets.push(normalized.slice(0, 180));
      return;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      snippets.push(String(value));
      return;
    }
    if (Array.isArray(value)) {
      value.slice(0, 3).forEach((item) => collect(item, depth + 1));
      return;
    }
    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      const rank = (key: string) => {
        const index = preferredKeys.indexOf(key);
        return index === -1 ? preferredKeys.length : index;
      };
      const entries = Object.entries(record).sort(([left], [right]) => rank(left) - rank(right));
      entries.slice(0, 6).forEach(([, child]) => collect(child, depth + 1));
    }
  }
  collect(research);
  return [...new Set(snippets)].slice(0, 3);
}

async function responseJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null) as ({ error?: string } & T) | null;
  if (!response.ok) throw new Error(payload?.error ?? "The procurement request failed.");
  return payload as T;
}

export function ProcurementWorkflow({ initialOrderId = null }: { initialOrderId?: string | null }) {
  const [requests, setRequests] = useState<RequestSummary[]>([]);
  const [selected, setSelected] = useState<RequestDetail | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);

  const loadList = useCallback(async () => {
    try {
      const response = await fetch("/api/procurement/requests", { cache: "no-store" });
      const payload = await responseJson<{ requests: RequestSummary[] }>(response);
      setRequests(payload.requests);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Requests could not be loaded.");
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadDetail = useCallback(async (orderId: string, quiet = false) => {
    if (!quiet) setLoadingDetail(true);
    try {
      const response = await fetch(`/api/procurement/requests/${encodeURIComponent(orderId)}`, { cache: "no-store" });
      const detail = await responseJson<RequestDetail>(response);
      setSelected(detail);
      setRequests((current) => current.some((item) => item.id === detail.id)
        ? current.map((item) => item.id === detail.id ? detail : item)
        : [detail, ...current]);
      setError(null);
    } catch (loadError) {
      if (!quiet) setError(loadError instanceof Error ? loadError.message : "Request status could not be loaded.");
    } finally {
      if (!quiet) setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
    if (initialOrderId) void loadDetail(initialOrderId);
  }, [initialOrderId, loadDetail, loadList]);

  useEffect(() => {
    if (!selected || !PROCUREMENT_ACTIVE_STATUSES.has(selected.status)) return;
    const poll = window.setInterval(() => void loadDetail(selected.id, true), 7_000);
    return () => window.clearInterval(poll);
  }, [loadDetail, selected]);

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const destination = String(form.get("destination") ?? "").trim();
    idempotencyKey.current ||= crypto.randomUUID();

    try {
      const response = await fetch("/api/procurement/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bomId: null,
          material: String(form.get("material") ?? "").trim(),
          specification: String(form.get("specification") ?? "").trim() || null,
          lineItemPreferences: { schema_version: 1 },
          quantity: Number(form.get("quantity")),
          unit: String(form.get("unit") ?? "").trim(),
          neededBy: String(form.get("neededBy") ?? "").trim() || null,
          notes: String(form.get("notes") ?? "").trim() || null,
          requestContext: {
            schema_version: 1,
            logistics: { destination: destination || null },
          },
          idempotencyKey: idempotencyKey.current,
        }),
      });
      const result = await responseJson<{ orderId: string }>(response);
      idempotencyKey.current = null;
      formElement.reset();
      await Promise.all([loadDetail(result.orderId), loadList()]);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Request could not be submitted.");
    } finally {
      setSubmitting(false);
    }
  }

  const approvalRequired = selected && PROCUREMENT_APPROVAL_STATUSES.has(selected.status);

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <h1>Procurement requests</h1>
        <span>{requests.length} recent</span>
      </header>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}

      <div className={styles.layout}>
        <section className={styles.formPanel} aria-labelledby="new-request-heading">
          <h2 id="new-request-heading">New request</h2>
          <form onSubmit={submitRequest}>
            <label>
              Material
              <input name="material" required maxLength={500} autoComplete="off" />
            </label>
            <label>
              Specification
              <textarea name="specification" rows={3} maxLength={4000} />
            </label>
            <div className={styles.fieldRow}>
              <label>
                Quantity
                <input name="quantity" type="number" min="0.000001" step="any" required />
              </label>
              <label>
                Unit
                <input name="unit" required maxLength={80} autoComplete="off" />
              </label>
            </div>
            <div className={styles.fieldRow}>
              <label>
                Needed by
                <input name="neededBy" type="date" />
              </label>
              <label>
                Destination
                <input name="destination" maxLength={300} autoComplete="off" />
              </label>
            </div>
            <label>
              Notes
              <textarea name="notes" rows={3} maxLength={4000} />
            </label>
            <button type="submit" disabled={submitting}>
              {submitting ? "Submitting" : "Submit request"}
            </button>
          </form>
        </section>

        <section className={styles.statusPanel} aria-labelledby="request-status-heading">
          {selected ? (
            <>
              <header className={styles.detailHeader}>
                <div>
                  <span className={styles.status} data-status={selected.status}>{statusLabel(selected.status)}</span>
                  <h2 id="request-status-heading">{selected.material}</h2>
                </div>
                <button className={styles.secondaryButton} type="button" onClick={() => void loadDetail(selected.id)}>
                  Refresh
                </button>
              </header>

              {approvalRequired ? (
                <div className={styles.approvalNotice}>
                  <strong>Approval required in Bourne Inbox</strong>
                  <span>{selected.status === "awaiting_shortlist_approval" ? "Review the supplier shortlist." : "Review the final order."}</span>
                </div>
              ) : null}

              {selected.status === "needs_attention" ? (
                <div className={styles.attentionNotice}>Human intervention required in Bourne Inbox.</div>
              ) : null}

              <dl className={styles.summary}>
                <div><dt>Progress</dt><dd>{selected.progress || "No update"}</dd></div>
                <div><dt>Quantity</dt><dd>{selected.quantity} {selected.unit}</dd></div>
                <div><dt>Needed by</dt><dd>{formattedDate(selected.neededBy)}</dd></div>
                <div><dt>Order ID</dt><dd>{selected.id}</dd></div>
              </dl>

              <div className={styles.supplierHeader}>
                <h3>Suppliers</h3>
                <span>{selected.vendors.length}</span>
              </div>
              {selected.vendors.length ? (
                <div className={styles.tableScroll}>
                  <table>
                    <thead><tr><th>Supplier</th><th>Status</th><th>Evidence</th><th>Website</th><th>Quote</th></tr></thead>
                    <tbody>
                      {selected.vendors.map((vendor) => {
                        const evidence = evidenceSummary(vendor.research);
                        return (
                          <tr key={vendor.id}>
                            <td>{vendor.name}</td>
                            <td>{statusLabel(vendor.status)}</td>
                            <td className={styles.evidenceCell}>{evidence.length
                              ? evidence.map((item) => <span key={item}>{item}</span>)
                              : "Not available"}</td>
                            <td>{vendor.website ? <a href={vendor.website} target="_blank" rel="noreferrer">Open site</a> : "Unknown"}</td>
                            <td>{vendor.quote ? "Received" : "Not received"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : <div className={styles.emptySuppliers}>No supplier results yet.</div>}
            </>
          ) : (
            <div className={styles.emptyDetail} id="request-status-heading">
              {loadingDetail ? "Loading request" : "Select a request to view status."}
            </div>
          )}
        </section>
      </div>

      <section className={styles.recentPanel} aria-labelledby="recent-requests-heading">
        <header><h2 id="recent-requests-heading">Recent requests</h2></header>
        {loadingList ? <div className={styles.emptyRecent}>Loading requests</div> : requests.length ? (
          <div className={styles.requestList}>
            {requests.map((request) => (
              <button
                type="button"
                key={request.id}
                data-selected={selected?.id === request.id}
                onClick={() => void loadDetail(request.id)}
              >
                <span><strong>{request.material}</strong><small>{request.quantity} {request.unit}</small></span>
                <span><small>{formattedDate(request.neededBy)}</small><em>{statusLabel(request.status)}</em></span>
              </button>
            ))}
          </div>
        ) : <div className={styles.emptyRecent}>No procurement requests.</div>}
      </section>
    </main>
  );
}
