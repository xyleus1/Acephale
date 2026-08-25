"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ResearchField,
  ResearchListSummary,
  ResearchRecordRow,
  ResearchStatus,
} from "@/lib/research-lists";
import { ResearchImportPanel } from "../research/research-import-panel";
import { ResearchStatusControl } from "../research/research-status-control";
import styles from "./supply-os-logistics.module.css";

type ResearchListResponse = Pick<
  ResearchListSummary,
  "id" | "officeId" | "slug" | "name" | "description" | "fields" | "recordCount"
> & { createdAt: string; updatedAt: string };

type ResearchRecordsResponse = ResearchListResponse & {
  rows: ResearchRecordRow[];
  total: number;
  page: number;
  pageCount: number;
};

const statuses: Array<ResearchStatus | "all"> = ["all", "new", "reviewed", "rejected"];

function safeHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function SupplyOsProspects({
  storageScope,
  initialListSlug,
  initialQuery = "",
  initialStatus = "all",
  initialPage = 1,
}: {
  storageScope: string;
  initialListSlug?: string;
  initialQuery?: string;
  initialStatus?: ResearchStatus | "all";
  initialPage?: number;
}) {
  const listStorageKey = `derya:supply-os:prospects-list:${storageScope}`;
  const [lists, setLists] = useState<ResearchListResponse[]>([]);
  const [selectedSlug, setSelectedSlug] = useState(initialListSlug ?? "");
  const [records, setRecords] = useState<ResearchRecordsResponse | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [appliedQuery, setAppliedQuery] = useState(initialQuery);
  const [status, setStatus] = useState<ResearchStatus | "all">(initialStatus);
  const [page, setPage] = useState(initialPage);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [newListOpen, setNewListOpen] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [newListSlug, setNewListSlug] = useState("");
  const [newListDescription, setNewListDescription] = useState("");
  const [newListFields, setNewListFields] = useState("");
  const [newListError, setNewListError] = useState("");
  const [newListBusy, setNewListBusy] = useState(false);

  const loadLists = useCallback(async () => {
    const response = await fetch("/api/research/lists", {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    const body = await response.json().catch(() => ({})) as { lists?: ResearchListResponse[]; error?: string };
    if (!response.ok) throw new Error(body.error || "Prospect lists are unavailable.");
    const nextLists = body.lists ?? [];
    setLists(nextLists);
    setSelectedSlug((current) => {
      if (current && nextLists.some((list) => list.slug === current)) return current;
      if (initialListSlug && nextLists.some((list) => list.slug === initialListSlug)) return initialListSlug;
      return nextLists[0]?.slug ?? "";
    });
  }, [initialListSlug]);

  const loadRecords = useCallback(async (slug: string, nextPage: number, nextQuery: string, nextStatus: ResearchStatus | "all") => {
    if (!slug) {
      setRecords(null);
      setState("ready");
      return;
    }
    setState("loading");
    const params = new URLSearchParams({ page: String(nextPage) });
    if (nextQuery.trim()) params.set("q", nextQuery.trim());
    if (nextStatus !== "all") params.set("status", nextStatus);
    const response = await fetch(`/api/research/${encodeURIComponent(slug)}/records?${params}`, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    const body = await response.json().catch(() => ({})) as ResearchRecordsResponse & { error?: string };
    if (!response.ok) throw new Error(body.error || "Prospects are unavailable.");
    setRecords(body);
    setState("ready");
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(listStorageKey);
      if (!initialListSlug && stored) setSelectedSlug(stored);
    } catch {
      // Local storage is optional.
    }
    void loadLists().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "Prospect lists are unavailable.");
      setState("error");
    });
  }, [initialListSlug, listStorageKey, loadLists]);

  const refreshData = useCallback(async () => {
    await loadLists();
    await loadRecords(selectedSlug, page, appliedQuery, status);
  }, [appliedQuery, loadLists, loadRecords, page, selectedSlug, status]);

  useEffect(() => {
    if (!selectedSlug) return;
    try {
      window.localStorage.setItem(listStorageKey, selectedSlug);
    } catch {
      // Local storage is optional.
    }
    const params = new URLSearchParams(window.location.search);
    params.set("panel", "materials");
    params.set("materialsView", "prospects");
    params.set("researchList", selectedSlug);
    window.history.replaceState({}, "", `${window.location.pathname}?${params}`);
    void loadRecords(selectedSlug, page, appliedQuery, status).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "Prospects are unavailable.");
      setState("error");
    });
  }, [appliedQuery, listStorageKey, loadRecords, page, selectedSlug, status]);

  const selectedList = useMemo(
    () => records ?? lists.find((list) => list.slug === selectedSlug) ?? null,
    [lists, records, selectedSlug],
  );
  const rangeStart = records && records.total ? (records.page - 1) * 50 + 1 : 0;
  const rangeEnd = records ? Math.min(records.page * 50, records.total) : 0;

  function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAppliedQuery(query);
    setPage(1);
  }

  function selectList(value: string) {
    setSelectedSlug(value);
    setRecords(null);
    setState("loading");
    setPage(1);
    setQuery("");
    setAppliedQuery("");
    setStatus("all");
  }

  async function createList(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNewListBusy(true);
    setNewListError("");
    const fields = newListFields
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [key, label, type = "text"] = line.split(":").map((part) => part.trim());
        return { key, label, type };
      });
    try {
      const response = await fetch("/api/research/lists", {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({
          name: newListName,
          slug: newListSlug || undefined,
          description: newListDescription || undefined,
          fields,
        }),
      });
      const body = await response.json().catch(() => ({})) as { list?: ResearchListResponse; error?: string };
      if (!response.ok || !body.list) throw new Error(body.error || "List could not be created.");
      setLists((current) => [body.list!, ...current.filter((list) => list.id !== body.list!.id)]);
      setSelectedSlug(body.list.slug);
      setRecords(null);
      setPage(1);
      setQuery("");
      setAppliedQuery("");
      setStatus("all");
      setNewListName("");
      setNewListSlug("");
      setNewListDescription("");
      setNewListFields("");
      setNewListOpen(false);
    } catch (createError) {
      setNewListError(createError instanceof Error ? createError.message : "List could not be created.");
    } finally {
      setNewListBusy(false);
    }
  }

  return (
    <section className={styles.prospectsWorkspace} aria-label="Prospects">
      <header className={styles.prospectsHeader}>
        <div>
          <h2>Prospects</h2>
          <span>{records ? `${records.total} records` : `${lists.length} lists`}</span>
        </div>
        <a href="/dashboard/leads?directory=1">Leads</a>
      </header>
      <div className={styles.newListPanel}>
        <button type="button" onClick={() => { setNewListOpen((open) => !open); setNewListError(""); }}>
          {newListOpen ? "Close new list" : "New list"}
        </button>
        {newListOpen ? (
          <form className={styles.newListForm} onSubmit={createList}>
            <label>
              <span>Name</span>
              <input value={newListName} onChange={(event) => setNewListName(event.target.value)} required maxLength={160} />
            </label>
            <label>
              <span>Slug</span>
              <input value={newListSlug} onChange={(event) => setNewListSlug(event.target.value)} maxLength={80} placeholder="Optional" />
            </label>
            <label>
              <span>Description</span>
              <input value={newListDescription} onChange={(event) => setNewListDescription(event.target.value)} maxLength={1000} />
            </label>
            <label className={styles.newListFields}>
              <span>Columns, one per line: key:label:type</span>
              <textarea
                value={newListFields}
                onChange={(event) => setNewListFields(event.target.value)}
                placeholder={"company_name:Company name:text\nwebsite:Website:url"}
                required
                rows={3}
              />
            </label>
            {newListError ? <p className={styles.prospectsError}>{newListError}</p> : null}
            <button type="submit" disabled={newListBusy}>
              {newListBusy ? "Creating..." : "Create list"}
            </button>
          </form>
        ) : null}
      </div>
      {lists.length ? (
        <div className={styles.prospectsControls}>
          <label>
            <span>List</span>
            <select value={selectedSlug} onChange={(event) => selectList(event.target.value)}>
              {lists.map((list) => <option key={list.id} value={list.slug}>{list.name} ({list.recordCount})</option>)}
            </select>
          </label>
          <form onSubmit={applyFilters}>
            <label>
              <span>Search</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search values" />
            </label>
            <label>
              <span>Status</span>
              <select value={status} onChange={(event) => { setStatus(event.target.value as ResearchStatus | "all"); setPage(1); }}>
                {statuses.map((value) => <option key={value} value={value}>{value[0]!.toUpperCase() + value.slice(1)}</option>)}
              </select>
            </label>
            <button type="submit">Apply</button>
          </form>
          {selectedList ? (
            <a
              className={styles.prospectsExport}
              href={`/api/research/${encodeURIComponent(selectedList.slug)}/export?${new URLSearchParams({
                ...(appliedQuery ? { q: appliedQuery } : {}),
                ...(status !== "all" ? { status } : {}),
              })}`}
            >
              Export CSV
            </a>
          ) : null}
        </div>
      ) : null}
      {state === "loading" ? <p className={styles.prospectsState}>Loading prospects</p> : null}
      {state === "error" ? <p className={styles.prospectsError}>{error}</p> : null}
      {state === "ready" && !lists.length ? <p className={styles.prospectsState}>No prospect lists yet.</p> : null}
      {state === "ready" && selectedList && records ? (
        <>
          <div className={styles.prospectsTableRegion}>
            <table className={styles.prospectsTable}>
              <thead>
                <tr>
                  {selectedList.fields.map((field) => <th key={field.key}>{field.label}</th>)}
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {records.rows.map((row) => (
                  <tr key={row.id}>
                    {selectedList.fields.map((field: ResearchField) => {
                      const value = String(row.data[field.key] ?? "");
                      const safe = field.type === "url" ? safeHttpUrl(value) : null;
                      return (
                        <td key={field.key}>
                          {safe ? <a href={safe} target="_blank" rel="noreferrer noopener">{value}</a> : value || <span>n/a</span>}
                        </td>
                      );
                    })}
                    <td>
                      <ResearchStatusControl
                        slug={selectedList.slug}
                        recordId={row.id}
                        status={row.status}
                        onChanged={refreshData}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!records.rows.length ? <p className={styles.prospectsState}>No records match this filter.</p> : null}
          <nav className={styles.prospectsPager} aria-label="Prospect pagination">
            <span>{rangeStart}-{rangeEnd} of {records.total}</span>
            <span>
              {records.page > 1 ? <button type="button" onClick={() => setPage((value) => value - 1)}>Previous</button> : null}
              {records.page < records.pageCount ? <button type="button" onClick={() => setPage((value) => value + 1)}>Next</button> : null}
            </span>
          </nav>
          <div className={styles.prospectsImport}>
            <ResearchImportPanel
              slug={selectedList.slug}
              fields={selectedList.fields}
              onChanged={refreshData}
            />
          </div>
        </>
      ) : null}
    </section>
  );
}
