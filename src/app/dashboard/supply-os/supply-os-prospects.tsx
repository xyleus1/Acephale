"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ResearchField,
  ResearchListSummary,
  ResearchRecordRow,
  ResearchStatus,
} from "@/lib/research-lists";
import { RESEARCH_STAGES, type ResearchRecordStage } from "@/lib/research-record-stages";
import type { ResearchProjectSummary } from "@/lib/research-projects";
import { ResearchStatusControl } from "../research/research-status-control";
import styles from "./supply-os-logistics.module.css";
import { AppSelect } from "@/components/app-select";

import { OTHER_PROJECT } from "@/lib/supply-os/prospect-project";
export { OTHER_PROJECT } from "@/lib/supply-os/prospect-project";

type ResearchListResponse = Pick<
  ResearchListSummary,
  "id" | "officeId" | "projectId" | "slug" | "name" | "description" | "fields" | "recordCount"
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
  lockedProjectId,
  initialListSlug,
  initialQuery = "",
  initialStatus = "all",
  initialStage,
  initialPage = 1,
  onListChange,
  externalStage,
  externalQuery,
  externalFilterNonce = 0,
}: {
  storageScope: string;
  lockedProjectId?: string;
  initialListSlug?: string;
  initialQuery?: string;
  initialStatus?: ResearchStatus | "all";
  initialStage?: ResearchRecordStage;
  initialPage?: number;
  onListChange?: (slug: string | null) => void;
  externalStage?: ResearchRecordStage | "all";
  externalQuery?: string;
  externalFilterNonce?: number;
}) {
  const listStorageKey = `derya:supply-os:prospects-list:${storageScope}`;
  const projectStorageKey = `derya:supply-os:prospects-project:${storageScope}`;
  const [lists, setLists] = useState<ResearchListResponse[]>([]);
  const [projects, setProjects] = useState<ResearchProjectSummary[]>([]);
  const [listsLoaded, setListsLoaded] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const selectedProjectRef = useRef("");
  const initialListSlugRef = useRef(initialListSlug);
  initialListSlugRef.current = initialListSlug;
  const recordsRequestIdRef = useRef(0);
  const [selectedSlug, setSelectedSlug] = useState(initialListSlug ?? "");
  const [records, setRecords] = useState<ResearchRecordsResponse | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [appliedQuery, setAppliedQuery] = useState(initialQuery);
  const [status, setStatus] = useState<ResearchStatus | "all">(initialStatus);
  const [stage, setStage] = useState<ResearchRecordStage | "all">(() => {
    if (initialStage) return initialStage;
    if (typeof window === "undefined") return "all";
    const value = new URLSearchParams(window.location.search).get("researchStage");
    return RESEARCH_STAGES.includes(value as ResearchRecordStage)
      ? value as ResearchRecordStage
      : "all";
  });
  const [page, setPage] = useState(initialPage);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [newListOpen, setNewListOpen] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [newListSlug, setNewListSlug] = useState("");
  const [newListDescription, setNewListDescription] = useState("");
  const [newListFields, setNewListFields] = useState("");
  const [newListProjectId, setNewListProjectId] = useState("");
  const [newListError, setNewListError] = useState("");
  const [newListBusy, setNewListBusy] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDescription, setNewProjectDescription] = useState("");
  const [newProjectError, setNewProjectError] = useState("");
  const [newProjectBusy, setNewProjectBusy] = useState(false);

  const loadLists = useCallback(async () => {
    const currentInitialListSlug = initialListSlugRef.current;
    let storedListSlug: string | null = null;
    let storedProjectId: string | null = null;
    if (!currentInitialListSlug) {
      try {
        storedListSlug = window.localStorage.getItem(listStorageKey);
        storedProjectId = window.localStorage.getItem(projectStorageKey);
      } catch {
        // Local storage is optional.
      }
    }
    const response = await fetch("/api/research/lists", {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    const body = await response.json().catch(() => ({})) as {
      lists?: ResearchListResponse[];
      projects?: ResearchProjectSummary[];
      error?: string;
    };
    if (!response.ok) throw new Error(body.error || "Prospect lists are unavailable.");
    const nextLists = body.lists ?? [];
    const nextProjects = body.projects ?? [];
    const preselectedList = currentInitialListSlug
      ? nextLists.find((list) => list.slug === currentInitialListSlug)
      : undefined;
    const otherListsExist = nextLists.some((list) => list.projectId === null);
    const lockedProjectIsValid = Boolean(
      lockedProjectId
      && (lockedProjectId === OTHER_PROJECT
        ? otherListsExist
        : nextProjects.some((project) => project.id === lockedProjectId)),
    );
    const nextProjectId = lockedProjectIsValid
      ? lockedProjectId!
      : preselectedList
      ? preselectedList.projectId ?? (otherListsExist ? OTHER_PROJECT : "")
      : storedProjectId && (
          storedProjectId === OTHER_PROJECT
            ? otherListsExist
            : nextProjects.some((project) => project.id === storedProjectId)
        )
        ? storedProjectId
        : nextProjects.find((project) => nextLists.some((list) => list.projectId === project.id && list.recordCount > 0))?.id
          ?? nextProjects[0]?.id
          ?? (otherListsExist ? OTHER_PROJECT : "");
    const currentProjectId = selectedProjectRef.current;
    const currentProjectIsValid = !lockedProjectIsValid && currentProjectId && (
      currentProjectId === OTHER_PROJECT
        ? otherListsExist
        : nextProjects.some((project) => project.id === currentProjectId)
    );
    const effectiveProjectId = lockedProjectIsValid
      ? lockedProjectId!
      : currentProjectIsValid ? currentProjectId : nextProjectId;
    setLists(nextLists);
    setProjects(nextProjects);
    setListsLoaded(true);
    selectedProjectRef.current = effectiveProjectId;
    setSelectedProjectId(effectiveProjectId);
    setSelectedSlug((current) => {
      const currentList = nextLists.find((list) => list.slug === current);
      if (currentList && (currentList.projectId ?? OTHER_PROJECT) === effectiveProjectId) return current;
      if (preselectedList && (preselectedList.projectId ?? OTHER_PROJECT) === effectiveProjectId) return preselectedList.slug;
      const storedList = storedListSlug
        ? nextLists.find((list) => list.slug === storedListSlug)
        : undefined;
      if (storedList && (storedList.projectId ?? OTHER_PROJECT) === effectiveProjectId) return storedList.slug;
      const projectLists = nextLists.filter((list) => (list.projectId ?? OTHER_PROJECT) === effectiveProjectId);
      const highestCountList = projectLists.reduce<ResearchListResponse | null>(
        (highest, list) => (!highest || list.recordCount > highest.recordCount ? list : highest),
        null,
      );
      return highestCountList?.slug ?? projectLists[0]?.slug ?? "";
    });
  }, [listStorageKey, lockedProjectId, projectStorageKey]);

  const loadRecords = useCallback(async (slug: string, nextPage: number, nextQuery: string, nextStatus: ResearchStatus | "all", nextStage: ResearchRecordStage | "all") => {
    const requestId = recordsRequestIdRef.current + 1;
    recordsRequestIdRef.current = requestId;
    if (!slug) {
      if (requestId === recordsRequestIdRef.current) {
        setRecords(null);
        setState("ready");
      }
      return;
    }
    if (requestId === recordsRequestIdRef.current) setState("loading");
    try {
      const params = new URLSearchParams({ page: String(nextPage) });
      if (nextQuery.trim()) params.set("q", nextQuery.trim());
      if (nextStatus !== "all") params.set("status", nextStatus);
      if (nextStage !== "all") params.set("stage", nextStage);
      const response = await fetch(`/api/research/${encodeURIComponent(slug)}/records?${params}`, {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      const body = await response.json().catch(() => ({})) as ResearchRecordsResponse & { error?: string };
      if (!response.ok) throw new Error(body.error || "Prospects are unavailable.");
      if (requestId !== recordsRequestIdRef.current) return;
      setRecords(body);
      setState("ready");
    } catch (loadError) {
      if (requestId !== recordsRequestIdRef.current) return;
      setError(loadError instanceof Error ? loadError.message : "Prospects are unavailable.");
      setState("error");
    }
  }, []);

  useEffect(() => {
    void loadLists().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "Prospect lists are unavailable.");
      setState("error");
    });
  }, [loadLists]);

  useEffect(() => {
    selectedProjectRef.current = "";
    setSelectedProjectId("");
    setSelectedSlug("");
    setRecords(null);
    setPage(1);
  }, [lockedProjectId]);

  useEffect(() => {
    selectedProjectRef.current = selectedProjectId;
  }, [selectedProjectId]);

  useEffect(() => {
    if (!newListProjectId && selectedProjectId) setNewListProjectId(selectedProjectId);
  }, [newListProjectId, selectedProjectId]);

  const refreshData = useCallback(async () => {
    await loadLists();
    await loadRecords(selectedSlug, page, appliedQuery, status, stage);
  }, [appliedQuery, loadLists, loadRecords, page, selectedSlug, stage, status]);

  useEffect(() => {
    if (!selectedSlug && !listsLoaded) return;
    try {
      if (selectedProjectId) window.localStorage.setItem(projectStorageKey, selectedProjectId);
      if (selectedSlug) window.localStorage.setItem(listStorageKey, selectedSlug);
      else window.localStorage.removeItem(listStorageKey);
    } catch {
      // Local storage is optional.
    }
    const params = new URLSearchParams(window.location.search);
    params.set("panel", "materials");
    params.set("materialsView", "projects");
    if (selectedSlug) params.set("researchList", selectedSlug);
    else params.delete("researchList");
    if (stage !== "all") params.set("researchStage", stage);
    else params.delete("researchStage");
    window.history.replaceState({}, "", `${window.location.pathname}?${params}`);
    if (!selectedSlug) {
      setRecords(null);
      setState("ready");
      return;
    }
    void loadRecords(selectedSlug, page, appliedQuery, status, stage).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "Prospects are unavailable.");
      setState("error");
    });
  }, [appliedQuery, listStorageKey, listsLoaded, loadRecords, page, projectStorageKey, selectedProjectId, selectedSlug, stage, status]);

  useEffect(() => {
    if (!externalFilterNonce) return;
    const nextStage = externalStage ?? "all";
    const nextQuery = externalQuery ?? "";
    setStage(nextStage);
    setQuery(nextQuery);
    setAppliedQuery(nextQuery);
    setPage(1);
  }, [externalFilterNonce, externalQuery, externalStage]);
  useEffect(() => {
    onListChange?.(selectedSlug || null);
  }, [onListChange, selectedSlug]);

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
    setStage("all");
    setStage("all");
  }

  function selectProject(value: string) {
    selectedProjectRef.current = value;
    setSelectedProjectId(value);
    const projectLists = lists.filter((list) => (list.projectId ?? OTHER_PROJECT) === value);
    setSelectedSlug(projectLists[0]?.slug ?? "");
    setRecords(null);
    setState("ready");
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
          projectId: newListProjectId && newListProjectId !== OTHER_PROJECT ? newListProjectId : undefined,
          fields,
        }),
      });
      const body = await response.json().catch(() => ({})) as { list?: ResearchListResponse; error?: string };
      if (!response.ok || !body.list) throw new Error(body.error || "List could not be created.");
      setLists((current) => [body.list!, ...current.filter((list) => list.id !== body.list!.id)]);
      setSelectedProjectId(body.list.projectId ?? OTHER_PROJECT);
      setSelectedSlug(body.list.slug);
      setRecords(null);
      setPage(1);
      setQuery("");
      setAppliedQuery("");
      setStatus("all");
      setStage("all");
      setNewListName("");
      setNewListSlug("");
      setNewListDescription("");
      setNewListFields("");
      setNewListProjectId(selectedProjectId);
      setNewListOpen(false);
    } catch (createError) {
      setNewListError(createError instanceof Error ? createError.message : "List could not be created.");
    } finally {
      setNewListBusy(false);
    }
  }

  async function createProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNewProjectBusy(true);
    setNewProjectError("");
    try {
      const response = await fetch("/api/research/projects", {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ name: newProjectName, description: newProjectDescription || undefined }),
      });
      const body = await response.json().catch(() => ({})) as { project?: ResearchProjectSummary; error?: string };
      if (!response.ok || !body.project) throw new Error(body.error || "Project could not be created.");
      setProjects((current) => [body.project!, ...current.filter((project) => project.id !== body.project!.id)]);
      selectedProjectRef.current = body.project.id;
      setSelectedProjectId(body.project.id);
      setSelectedSlug("");
      setRecords(null);
      setNewListProjectId(body.project.id);
      setNewProjectName("");
      setNewProjectDescription("");
      setNewProjectOpen(false);
      await loadLists();
      setSelectedProjectId(body.project.id);
    } catch (createError) {
      setNewProjectError(createError instanceof Error ? createError.message : "Project could not be created.");
    } finally {
      setNewProjectBusy(false);
    }
  }

  const recordCount = records ? `${records.total} records` : selectedSlug ? `${selectedList?.recordCount ?? 0} records` : `${projects.length} projects`;

  return (
    <section className={styles.prospectsWorkspace} aria-label="Prospects">
      {!lockedProjectId ? (
        <header className={styles.prospectsHeader}>
          <div>
            <h2>Prospects</h2>
            <span>{recordCount}</span>
          </div>
          <a href="/dashboard/leads?directory=1">Leads</a>
        </header>
      ) : null}
      {!lockedProjectId ? <div className={styles.newListPanel}>
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
              <span>Project</span>
              <select value={newListProjectId} onChange={(event) => setNewListProjectId(event.target.value)}>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                {lists.some((list) => list.projectId === null) || newListProjectId === OTHER_PROJECT
                  ? <option value={OTHER_PROJECT}>Other lists</option>
                  : null}
              </select>
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
        <button type="button" onClick={() => { setNewProjectOpen((open) => !open); setNewProjectError(""); }}>
          {newProjectOpen ? "Close new project" : "New project"}
        </button>
        {newProjectOpen ? (
          <form className={styles.newProjectForm} onSubmit={createProject}>
            <label>
              <span>Name</span>
              <input value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} required maxLength={160} />
            </label>
            <label>
              <span>Description</span>
              <input value={newProjectDescription} onChange={(event) => setNewProjectDescription(event.target.value)} maxLength={1000} />
            </label>
            {newProjectError ? <p className={styles.prospectsError}>{newProjectError}</p> : null}
            <button type="submit" disabled={newProjectBusy}>
              {newProjectBusy ? "Creating..." : "Create project"}
            </button>
          </form>
        ) : null}
      </div> : null}
      {lists.length || projects.length ? (
        <div className={styles.prospectsControls}>
          {!lockedProjectId ? <label>
            <span>Project</span>
            <AppSelect
              value={selectedProjectId}
              ariaLabel="Project"
              options={[
                ...projects.map((project) => ({ value: project.id, label: project.name, hint: `${project.listCount} lists` })),
                ...(lists.some((list) => list.projectId === null)
                  ? [{ value: OTHER_PROJECT, label: "Other lists" }]
                  : []),
              ]}
              onChange={selectProject}
            />
          </label> : null}
          <label>
            <span>List</span>
            <AppSelect
              value={selectedSlug}
              ariaLabel="List"
              options={lists
                .filter((list) => (list.projectId ?? OTHER_PROJECT) === selectedProjectId)
                .map((list) => ({ value: list.slug, label: list.name, hint: `${list.recordCount} records` }))}
              onChange={selectList}
              className={!selectedProjectId ? styles.disabledSelect : undefined}
            />
          </label>
          <form onSubmit={applyFilters}>
            <label>
              <span>Search</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search values" />
            </label>
            <label>
              <span>Status</span>
              <AppSelect
                value={status}
                ariaLabel="Status"
                options={statuses.map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) }))}
                onChange={(nextStatus) => { setStatus(nextStatus); setPage(1); }}
              />
            </label>
            <button type="submit">Apply</button>
          </form>
          {selectedList ? (
            <a
              className={styles.prospectsExport}
              href={`/api/research/${encodeURIComponent(selectedList.slug)}/export?${new URLSearchParams({
                ...(appliedQuery ? { q: appliedQuery } : {}),
                ...(status !== "all" ? { status } : {}),
                ...(stage !== "all" ? { stage } : {}),
              })}`}
            >
              Export CSV
            </a>
          ) : null}
          {lockedProjectId ? <span className={styles.prospectsCount}>{recordCount}</span> : null}
        </div>
      ) : null}
      {state === "loading" ? <p className={styles.prospectsState}>Loading prospects</p> : null}
      {state === "error" ? <p className={styles.prospectsError}>{error}</p> : null}
      {state === "ready" && !lists.length ? <p className={styles.prospectsState}>No prospect lists yet.</p> : null}
      {state === "ready" && lists.length > 0 && !selectedSlug ? <p className={styles.prospectsState}>No lists in this project yet.</p> : null}
      {state === "ready" && selectedSlug && selectedList && records ? (
        <>
          {stage !== "all" ? (
            <div className={styles.prospectsFilterPill}>
              <span>{stage === "not_target" ? "Not a target" : stage === "has_email" ? "Has email" : stage === "no_email" ? "No email" : stage[0]!.toUpperCase() + stage.slice(1)} {records.total}</span>
              <button type="button" aria-label="Remove stage filter" onClick={() => { setStage("all"); setPage(1); }}>×</button>
            </div>
          ) : null}
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
                        <td key={field.key} title={value || undefined}>
                          {safe
                            ? <span className={styles.prospectsCell}><a href={safe} target="_blank" rel="noreferrer noopener">{value}</a></span>
                            : value
                              ? <span className={styles.prospectsCell}>{value}</span>
                              : <span className={styles.prospectsEmpty} aria-label="No value">-</span>}
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
        </>
      ) : null}
    </section>
  );
}
