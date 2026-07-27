"use client";

import type { Route } from "next";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createContactAction,
  deferOutreachAction,
  deleteContactAction,
  markOutreachReachedAction,
  updateContactAction,
  type ContactPatch,
} from "@/app/dashboard/crm/actions";
import {
  CONTACT_CATEGORIES,
  CONTACT_CONTEXTS,
  CONTACT_IMPORTANCE_LEVELS,
  CONTACT_STATUSES,
  OUTREACH_CHANNEL_OPTIONS,
  type ContactRow,
} from "@/lib/contact-fields";
import {
  OUTREACH_CHANNELS,
  buildOutreachReport,
  formatOutreachDateKey,
  outreachDateKey,
  type OutreachPlanRow,
} from "@/lib/crm-outreach";
import { crmViewHref, type CrmView } from "@/lib/crm-view";
import { CellInput, CellSelect } from "@/components/sheet-cells";
import { Icon } from "@/components/icon";

type SortKey =
  | "status"
  | "importance"
  | "category"
  | "name"
  | "company"
  | "context"
  | "title"
  | "outreachChannel"
  | "email"
  | "bookfaceUrl"
  | "linkedinUrl"
  | "phone"
  | "location"
  | "lastTouchAt";

const COLUMNS: Array<{ key: SortKey | "notes"; label: string; width?: number }> = [
  { key: "status", label: "Status", width: 120 },
  { key: "importance", label: "Importance", width: 100 },
  { key: "category", label: "Category", width: 155 },
  { key: "name", label: "Contact", width: 150 },
  { key: "company", label: "Company", width: 150 },
  { key: "context", label: "Context", width: 135 },
  { key: "title", label: "Title", width: 135 },
  { key: "outreachChannel", label: "Channel", width: 105 },
  { key: "email", label: "Email", width: 210 },
  { key: "bookfaceUrl", label: "Bookface", width: 185 },
  { key: "linkedinUrl", label: "LinkedIn", width: 185 },
  { key: "phone", label: "Phone", width: 120 },
  { key: "location", label: "Location", width: 115 },
  { key: "lastTouchAt", label: "Last reached", width: 110 },
  { key: "notes", label: "Notes" },
];

type Draft = Record<
  | "status"
  | "importance"
  | "category"
  | "name"
  | "company"
  | "context"
  | "title"
  | "outreachChannel"
  | "email"
  | "bookfaceUrl"
  | "linkedinUrl"
  | "phone"
  | "location"
  | "notes",
  string
>;

const EMPTY_DRAFT: Draft = {
  status: "not_contacted",
  importance: "medium",
  category: "startup",
  name: "",
  company: "",
  context: "founder",
  title: "",
  outreachChannel: "",
  email: "",
  bookfaceUrl: "",
  linkedinUrl: "",
  phone: "",
  location: "",
  notes: "",
};

const IMPORTANCE_RANK: ReadonlyMap<string, number> = new Map(
  CONTACT_IMPORTANCE_LEVELS.map(([value], index) => [value, index]),
);
const CHANNEL_RANK: ReadonlyMap<string, number> = new Map(
  OUTREACH_CHANNELS.map((channel, index) => [channel.key, index]),
);

function fmtLastTouch(iso: string | null): string {
  if (!iso) return "Never";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function patchFields(patch: ContactPatch): string[] {
  return Object.keys(patch).map((key) => (key === "companyName" ? "company" : key));
}

function safeExternalUrl(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function contactAccessHref(contact: ContactRow, channel: string): string | null {
  if (channel === "email") return contact.email ? `mailto:${contact.email}` : null;
  if (channel === "linkedin") return safeExternalUrl(contact.linkedinUrl);
  if (channel === "bookface") return safeExternalUrl(contact.bookfaceUrl);
  return null;
}

function planStatusLabel(item: OutreachPlanRow, todayKey: string): string {
  if (item.status === "REACHED_OUT") return "Reached out";
  if (item.status === "TODAY" && item.scheduledForKey && item.scheduledForKey < todayKey) {
    return "Overdue";
  }
  if (item.status === "TODAY") return "Today";
  return "This week";
}

function planStatusClass(item: OutreachPlanRow, todayKey: string): string {
  if (item.status === "REACHED_OUT") return "done";
  if (item.status === "TODAY" && item.scheduledForKey && item.scheduledForKey < todayKey) {
    return "overdue";
  }
  if (item.status === "TODAY") return "today";
  return "weekly";
}

export function ContactSheet({
  initialRows,
  companies,
  initialQuery,
  initialPlan,
  initialView,
}: {
  initialRows: ContactRow[];
  companies: string[];
  initialQuery: string;
  initialPlan: OutreachPlanRow[];
  initialView: CrmView;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [plan, setPlan] = useState(initialPlan);
  const [view, setView] = useState<CrmView>(initialView);
  const [q, setQ] = useState(initialQuery);
  const [categoryTab, setCategoryTab] = useState<string>("all");
  const [channelTab, setChannelTab] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyCounts, setBusyCounts] = useState<Record<string, number>>({});
  const [planBusy, setPlanBusy] = useState<Record<string, boolean>>({});
  const [revisions, setRevisions] = useState<Record<string, number>>({});
  const [, startTransition] = useTransition();

  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  useEffect(() => {
    setPlan(initialPlan);
  }, [initialPlan]);

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  const report = useMemo(() => buildOutreachReport(plan), [plan]);
  const todayAssigned = Math.min(
    report.today.target,
    report.today.reached + report.dueNow,
  );
  const todayEmpty = Math.max(0, report.today.target - todayAssigned);

  function openView(nextView: CrmView) {
    setView(nextView);
    if (nextView === "contacts") {
      setCategoryTab("all");
      setChannelTab("all");
    }
    router.replace(crmViewHref(nextView, q) as Route, { scroll: false });
  }

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const row of rows) {
      const known = CONTACT_CATEGORIES.some(([value]) => value === row.category);
      const key = !row.category ? "none" : known ? row.category : "legacy";
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [rows]);

  const visibleContacts = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let output = rows;
    if (categoryTab === "none") output = output.filter((row) => !row.category);
    else if (categoryTab === "legacy") {
      output = output.filter(
        (row) => row.category && !CONTACT_CATEGORIES.some(([value]) => value === row.category),
      );
    } else if (categoryTab !== "all") {
      output = output.filter((row) => row.category === categoryTab);
    }
    if (needle) {
      output = output.filter((row) =>
        [
          row.status,
          row.importance,
          row.category,
          row.name,
          row.company,
          row.context,
          row.title,
          row.outreachChannel,
          row.email,
          row.linkedinUrl,
          row.bookfaceUrl,
          row.phone,
          row.location,
          row.notes,
        ].some((value) => value?.toLowerCase().includes(needle)),
      );
    }
    if (sortKey) {
      output = [...output].sort((left, right) => {
        if (sortKey === "lastTouchAt") {
          const leftTime = left.lastTouchAt ? Date.parse(left.lastTouchAt) : null;
          const rightTime = right.lastTouchAt ? Date.parse(right.lastTouchAt) : null;
          if (leftTime === null && rightTime === null) return 0;
          if (leftTime === null) return 1;
          if (rightTime === null) return -1;
          return (leftTime - rightTime) * sortDir;
        }
        if (sortKey === "importance") {
          return (
            ((IMPORTANCE_RANK.get(left.importance) ?? 2) -
              (IMPORTANCE_RANK.get(right.importance) ?? 2)) *
            sortDir
          );
        }
        const leftValue = (left[sortKey] ?? "").toLowerCase();
        const rightValue = (right[sortKey] ?? "").toLowerCase();
        if (!leftValue && !rightValue) return 0;
        if (!leftValue) return 1;
        if (!rightValue) return -1;
        return leftValue.localeCompare(rightValue) * sortDir;
      });
    }
    return output;
  }, [rows, q, categoryTab, sortKey, sortDir]);

  const filteredPlan = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return plan.filter((item) => {
      if (channelTab !== "all" && item.channel !== channelTab) return false;
      if (!needle) return true;
      return [
        item.contact.name,
        item.contact.company,
        item.contact.category,
        item.contact.email,
        item.contact.title,
        item.channel,
      ].some((value) => value?.toLowerCase().includes(needle));
    });
  }, [plan, q, channelTab]);

  const todayRows = useMemo(
    () =>
      filteredPlan
        .filter((item) => {
          if (
            item.status === "TODAY" &&
            item.scheduledForKey &&
            item.scheduledForKey <= report.todayKey
          ) {
            return true;
          }
          return (
            item.status === "REACHED_OUT" &&
            item.reachedOutAt != null &&
            outreachDateKey(new Date(item.reachedOutAt)) === report.todayKey
          );
        })
        .sort((left, right) => {
          const status = Number(left.status === "REACHED_OUT") - Number(right.status === "REACHED_OUT");
          if (status !== 0) return status;
          const channel =
            (CHANNEL_RANK.get(left.channel as "bookface" | "linkedin" | "email") ?? 99) -
            (CHANNEL_RANK.get(right.channel as "bookface" | "linkedin" | "email") ?? 99);
          if (channel !== 0) return channel;
          const importance =
            (IMPORTANCE_RANK.get(left.contact.importance) ?? 2) -
            (IMPORTANCE_RANK.get(right.contact.importance) ?? 2);
          if (importance !== 0) return importance;
          return left.contact.company.localeCompare(right.contact.company);
        }),
    [filteredPlan, report.todayKey],
  );

  const weekRows = useMemo(
    () =>
      filteredPlan
        .filter(
          (item) =>
            item.weekStartKey === report.weekStartKey &&
            item.status !== "SKIPPED",
        )
        .sort((left, right) => {
          const channel =
            (CHANNEL_RANK.get(left.channel as "bookface" | "linkedin" | "email") ?? 99) -
            (CHANNEL_RANK.get(right.channel as "bookface" | "linkedin" | "email") ?? 99);
          if (channel !== 0) return channel;
          const leftDate = left.scheduledForKey ?? "9999-12-31";
          const rightDate = right.scheduledForKey ?? "9999-12-31";
          if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
          const importance =
            (IMPORTANCE_RANK.get(left.contact.importance) ?? 2) -
            (IMPORTANCE_RANK.get(right.contact.importance) ?? 2);
          if (importance !== 0) return importance;
          return left.contact.company.localeCompare(right.contact.company);
        }),
    [filteredPlan, report.weekStartKey],
  );

  function flash(message: string) {
    setError(message);
    window.setTimeout(() => setError(null), 6000);
  }

  function markBusy(id: string, busy: boolean) {
    setBusyCounts((previous) => {
      const next = { ...previous };
      const count = (next[id] ?? 0) + (busy ? 1 : -1);
      if (count <= 0) delete next[id];
      else next[id] = count;
      return next;
    });
  }

  function revertCells(rowId: string, fields: string[]) {
    setRevisions((previous) => {
      const next = { ...previous };
      for (const field of fields) {
        const key = `${rowId}:${field}`;
        next[key] = (next[key] ?? 0) + 1;
      }
      return next;
    });
  }

  function commit(row: ContactRow, patch: ContactPatch) {
    markBusy(row.id, true);
    startTransition(async () => {
      try {
        const result = await updateContactAction(row.id, patch);
        if ("error" in result) {
          flash(result.error);
          revertCells(row.id, patchFields(patch));
          return;
        }
        setRows((previous) =>
          previous.map((candidate) => (candidate.id === row.id ? result.row : candidate)),
        );
        if (
          patch.outreachChannel !== undefined ||
          patch.status !== undefined ||
          patch.importance !== undefined ||
          patch.category !== undefined
        ) {
          router.refresh();
        }
      } catch {
        flash("Could not save. Check your connection and try again.");
        revertCells(row.id, patchFields(patch));
      } finally {
        markBusy(row.id, false);
      }
    });
  }

  function commitCompany(row: ContactRow, name: string) {
    const known = companies.some((company) => company.toLowerCase() === name.toLowerCase());
    if (!known && !window.confirm(`"${name}" is a new company. Create it?`)) {
      revertCells(row.id, ["company"]);
      return;
    }
    commit(row, { companyName: name });
  }

  function remove(row: ContactRow) {
    if (!window.confirm(`Delete ${row.name}? This cannot be undone.`)) return;
    markBusy(row.id, true);
    startTransition(async () => {
      try {
        const result = await deleteContactAction(row.id);
        if ("error" in result) {
          flash(result.error);
          return;
        }
        setRows((previous) => previous.filter((candidate) => candidate.id !== row.id));
        setPlan((previous) => previous.filter((item) => item.contactId !== row.id));
      } catch {
        flash("Could not delete. Check your connection and try again.");
      } finally {
        markBusy(row.id, false);
      }
    });
  }

  function saveDraft() {
    if (!draft || savingDraft) return;
    if (!draft.name.trim()) {
      flash("Name is required.");
      return;
    }
    if (!draft.company.trim()) {
      flash("Company is required.");
      return;
    }
    setSavingDraft(true);
    const payload: ContactPatch = {
      status: draft.status,
      importance: draft.importance,
      category: draft.category,
      name: draft.name,
      companyName: draft.company,
      context: draft.context,
      title: draft.title,
      outreachChannel: draft.outreachChannel,
      email: draft.email,
      bookfaceUrl: draft.bookfaceUrl,
      linkedinUrl: draft.linkedinUrl,
      phone: draft.phone,
      location: draft.location,
      notes: draft.notes,
    };
    startTransition(async () => {
      try {
        const result = await createContactAction(payload);
        if ("error" in result) {
          flash(result.error);
          return;
        }
        setRows((previous) => [result.row, ...previous]);
        setDraft(null);
        router.refresh();
      } catch {
        flash("Could not add the contact. Check your connection and try again.");
      } finally {
        setSavingDraft(false);
      }
    });
  }

  function markReached(item: OutreachPlanRow) {
    setPlanBusy((previous) => ({ ...previous, [item.id]: true }));
    startTransition(async () => {
      try {
        const result = await markOutreachReachedAction(item.id);
        if ("error" in result) {
          flash(result.error);
          return;
        }
        const reachedOutAt = result.reachedOutAt ?? new Date().toISOString();
        setPlan((previous) =>
          previous.map((candidate) =>
            candidate.id === item.id
              ? {
                  ...candidate,
                  status: "REACHED_OUT",
                  reachedOutAt,
                  contact: { ...candidate.contact, status: "reached_out", lastTouchAt: reachedOutAt },
                }
              : candidate,
          ),
        );
        setRows((previous) =>
          previous.map((candidate) =>
            candidate.id === item.contactId
              ? { ...candidate, status: "reached_out", lastTouchAt: reachedOutAt }
              : candidate,
          ),
        );
        router.refresh();
      } catch {
        flash("Could not mark this outreach complete. Try again.");
      } finally {
        setPlanBusy((previous) => {
          const next = { ...previous };
          delete next[item.id];
          return next;
        });
      }
    });
  }

  function defer(item: OutreachPlanRow) {
    setPlanBusy((previous) => ({ ...previous, [item.id]: true }));
    startTransition(async () => {
      try {
        const result = await deferOutreachAction(item.id);
        if ("error" in result) {
          flash(result.error);
          return;
        }
        setPlan((previous) =>
          previous.map((candidate) =>
            candidate.id === item.id
              ? {
                  ...candidate,
                  status: "WEEKLY",
                  scheduledForKey: result.scheduledForKey ?? candidate.scheduledForKey,
                }
              : candidate,
          ),
        );
        router.refresh();
      } catch {
        flash("Could not defer this contact. Try again.");
      } finally {
        setPlanBusy((previous) => {
          const next = { ...previous };
          delete next[item.id];
          return next;
        });
      }
    });
  }

  function header(column: (typeof COLUMNS)[number]) {
    const sortable = column.key !== "notes";
    const active = sortKey === column.key;
    return (
      <th
        key={column.key}
        style={sortable ? undefined : { cursor: "default" }}
        className={active ? "active" : undefined}
        onClick={
          sortable
            ? () => {
                if (active) setSortDir((direction) => (direction === 1 ? -1 : 1));
                else {
                  setSortKey(column.key as SortKey);
                  setSortDir(1);
                }
              }
            : undefined
        }
      >
        {column.label}
        {active ? (sortDir === 1 ? " ↑" : " ↓") : ""}
      </th>
    );
  }

  function renderContactLinks(contact: ContactRow) {
    const bookface = safeExternalUrl(contact.bookfaceUrl);
    const linkedin = safeExternalUrl(contact.linkedinUrl);
    return (
      <div className="outreach-contact-links">
        {contact.email && <a href={`mailto:${contact.email}`}>Email</a>}
        {linkedin && <a href={linkedin} target="_blank" rel="noreferrer">LinkedIn</a>}
        {bookface && <a href={bookface} target="_blank" rel="noreferrer">Bookface</a>}
        {!contact.email && !linkedin && !bookface && <span>No link</span>}
      </div>
    );
  }

  function renderPlanTable(items: OutreachPlanRow[]) {
    return (
      <div className="card table-shell outreach-table-shell">
        <table className="data-table outreach-plan-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Importance</th>
              <th>Category</th>
              <th>Contact</th>
              <th>Company</th>
              <th>Channel</th>
              <th>Contact details</th>
              <th>Scheduled</th>
              <th aria-label="Outreach actions" />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr className="outreach-empty-row">
                <td colSpan={9} className="table-empty-cell">
                  {report.weeklyGap > 0
                    ? "No eligible contacts here. Classify startup or personally important contacts and assign a channel."
                    : "No outreach items match this filter."}
                </td>
              </tr>
            )}
            {items.map((item) => {
              const accessHref = contactAccessHref(item.contact, item.channel);
              const busy = Boolean(planBusy[item.id]);
              const scheduled = item.scheduledForKey
                ? item.scheduledForKey < report.todayKey
                  ? `Overdue from ${formatOutreachDateKey(item.scheduledForKey)}`
                  : formatOutreachDateKey(item.scheduledForKey)
                : "Weekly pool";
              return (
                <tr key={item.id} className={busy ? "sheet-row-busy" : undefined}>
                  <td data-label="Status">
                    <span className={`outreach-status ${planStatusClass(item, report.todayKey)}`}>
                      {planStatusLabel(item, report.todayKey)}
                    </span>
                  </td>
                  <td data-label="Importance">
                    <span className={`outreach-importance ${item.contact.importance}`}>
                      {CONTACT_IMPORTANCE_LEVELS.find(([value]) => value === item.contact.importance)?.[1]
                        ?? item.contact.importance}
                    </span>
                  </td>
                  <td data-label="Category">
                    {CONTACT_CATEGORIES.find(([value]) => value === item.contact.category)?.[1]
                      ?? item.contact.category
                      ?? "Uncategorized"}
                  </td>
                  <td data-label="Contact">
                    <strong>{item.contact.name}</strong>
                    {item.contact.title && <small>{item.contact.title}</small>}
                  </td>
                  <td data-label="Company">{item.contact.company}</td>
                  <td data-label="Channel">
                    {OUTREACH_CHANNELS.find((channel) => channel.key === item.channel)?.label
                      ?? item.channel}
                  </td>
                  <td data-label="Contact details">{renderContactLinks(item.contact)}</td>
                  <td data-label="Scheduled" className="outreach-scheduled">
                    {item.status === "REACHED_OUT" && item.reachedOutAt
                      ? `Done ${new Date(item.reachedOutAt).toLocaleTimeString("en-US", {
                          hour: "numeric",
                          minute: "2-digit",
                        })}`
                      : scheduled}
                  </td>
                  <td data-label="Actions">
                    <div className="outreach-row-actions">
                      {accessHref && (
                        <a
                          href={accessHref}
                          className="btn btn-sm btn-ghost"
                          target={item.channel === "email" ? undefined : "_blank"}
                          rel={item.channel === "email" ? undefined : "noreferrer"}
                        >
                          Open <Icon name="external" size={12} />
                        </a>
                      )}
                      {item.status === "TODAY" && (
                        <>
                          <button
                            type="button"
                            className="btn btn-sm"
                            disabled={busy}
                            onClick={() => markReached(item)}
                          >
                            <Icon name="check" size={12} /> {busy ? "Saving…" : "Reached out"}
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            disabled={busy}
                            onClick={() => defer(item)}
                          >
                            Later
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  const categoryTabs: Array<[string, string]> = [
    ["all", `All (${rows.length})`],
    ...CONTACT_CATEGORIES.map(
      ([value, label]) =>
        [value, `${label} (${categoryCounts[value] ?? 0})`] as [string, string],
    ),
    ...(categoryCounts.none
      ? ([["none", `Uncategorized (${categoryCounts.none})`]] as Array<[string, string]>)
      : []),
    ...(categoryCounts.legacy
      ? ([["legacy", `Needs reclassification (${categoryCounts.legacy})`]] as Array<[string, string]>)
      : []),
  ];

  return (
    <div className="contact-sheet outreach-workspace">
      {view === "contacts" ? (
        <section className="outreach-launcher" aria-labelledby="outreach-launcher-title">
          <div className="outreach-launcher-mark">
            <Icon name="activity" size={20} strokeWidth={2} />
          </div>
          <div className="outreach-launcher-copy">
            <span className="outreach-eyebrow">Outreach desk</span>
            <h1 id="outreach-launcher-title">Daily and weekly outreach</h1>
            <p>
              Send 20 Bookface, 30 LinkedIn, and 30 email outreaches each day.
              Empty capacity stays visible until you add or classify enough contacts.
            </p>
            <div className="outreach-target-pills" aria-label="Daily channel targets">
              {report.channels.map((channel) => (
                <span key={channel.key}>
                  {channel.label} <strong>{channel.dailyTarget}/day</strong>
                </span>
              ))}
            </div>
          </div>
          <div className="outreach-launcher-stats">
            <div>
              <span>Today ready</span>
              <strong>{todayAssigned}/{report.today.target}</strong>
              <small>{report.dueNow} queued, {todayEmpty} empty</small>
            </div>
            <div>
              <span>This week planned</span>
              <strong>{report.weeklyPlanned}/{report.weeklyTarget}</strong>
              <small>{report.weeklyGap} empty</small>
            </div>
          </div>
          <div className="outreach-launcher-actions">
            <button type="button" className="btn" onClick={() => openView("today")}>
              Open daily outreach <Icon name="arrow-right" size={14} />
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => openView("week")}>
              Review weekly pool
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className="outreach-hero">
            <div>
              <span className="outreach-eyebrow">Outreach desk</span>
              <h1>
                {view === "today"
                  ? "Send today's outreach"
                  : "Build this week's outreach pool"}
              </h1>
              <p>
                {view === "today"
                  ? "Work the queue by channel, open the contact method, then mark each person reached."
                  : "Keep seven days of Bookface, LinkedIn, and email capacity ready for daily promotion."}
              </p>
            </div>
            <div className="outreach-report-line">
              <strong>
                {view === "today"
                  ? `Today: ${report.today.reached}/${report.today.target}`
                  : `This week: ${report.week.reached}/${report.week.target}`}
              </strong>
              <span>{view === "today" ? `${report.dueNow} queued` : `${report.weeklyPlanned} planned`}</span>
              <span>{view === "today" ? `${todayEmpty} empty slots` : `${report.weeklyGap} empty slots`}</span>
              <span>Yesterday: {report.yesterday.reached}/{report.yesterday.target}</span>
            </div>
          </section>

          <div className="outreach-summary-grid">
            {report.channels.map((channel) => {
              const dailyAssigned = Math.min(
                channel.dailyTarget,
                channel.today.reached + channel.dueNow,
              );
              const dailyEmpty = Math.max(0, channel.dailyTarget - dailyAssigned);
              const progressPercent =
                view === "today"
                  ? Math.round((dailyAssigned / channel.dailyTarget) * 100)
                  : Math.min(
                      100,
                      Math.round((channel.weeklyPlanned / channel.weeklyTarget) * 100),
                    );

              return (
                <button
                  key={channel.key}
                  type="button"
                  className={`card outreach-channel-card${channelTab === channel.key ? " active" : ""}`}
                  aria-pressed={channelTab === channel.key}
                  onClick={() => setChannelTab(channel.key)}
                >
                  <div className="outreach-channel-head">
                    <strong>{channel.label}</strong>
                    <span>
                      {view === "today"
                        ? `${dailyAssigned}/${channel.dailyTarget} ready`
                        : `${channel.weeklyPlanned}/${channel.weeklyTarget} planned`}
                    </span>
                  </div>
                  <div className="outreach-progress" aria-label={`${channel.label} assigned capacity`}>
                    <span style={{ width: `${progressPercent}%` }} />
                  </div>
                  <div className="outreach-channel-meta">
                    <span>
                      {view === "today"
                        ? `${channel.today.reached} complete`
                        : `${channel.week.reached} complete`}
                    </span>
                    <span>
                      {view === "today"
                        ? `${dailyEmpty} empty`
                        : `${channel.weeklyGap} empty`}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mode-tabs outreach-view-tabs">
            <button
              type="button"
              className={`mode-tab${view === "today" ? " active" : ""}`}
              aria-current={view === "today" ? "page" : undefined}
              onClick={() => openView("today")}
            >
              Today ({report.dueNow})
            </button>
            <button
              type="button"
              className={`mode-tab${view === "week" ? " active" : ""}`}
              aria-current={view === "week" ? "page" : undefined}
              onClick={() => openView("week")}
            >
              This week ({report.weeklyPlanned})
            </button>
            <button
              type="button"
              className="mode-tab"
              onClick={() => openView("contacts")}
            >
              Contacts ({rows.length})
            </button>
          </div>

          <section className="outreach-capacity" aria-labelledby="outreach-capacity-title">
            <div className="outreach-capacity-head">
              <div>
                <span className="outreach-eyebrow">Empty outreach slots</span>
                <h2 id="outreach-capacity-title">
                  {view === "today" ? "Fill today's channel gaps" : "Fill the weekly pool"}
                </h2>
              </div>
              <p>
                Add or classify startup and personally important contacts, then assign
                their preferred channel. Forwarders remain data-only.
              </p>
            </div>
            <div className="outreach-capacity-grid">
              {report.channels.map((channel) => {
                const dailyAssigned = Math.min(
                  channel.dailyTarget,
                  channel.today.reached + channel.dueNow,
                );
                const empty =
                  view === "today"
                    ? Math.max(0, channel.dailyTarget - dailyAssigned)
                    : channel.weeklyGap;
                const target = view === "today" ? channel.dailyTarget : channel.weeklyTarget;

                return (
                  <button
                    key={channel.key}
                    type="button"
                    className={`outreach-capacity-slot${empty > 0 ? " empty" : ""}`}
                    onClick={() => openView("contacts")}
                  >
                    <span>
                      <strong>{channel.label}</strong>
                      <small>{target - empty}/{target} assigned</small>
                    </span>
                    <span className="outreach-capacity-count">
                      {empty > 0 ? `${empty} empty` : "Quota filled"}
                    </span>
                    <span className="outreach-capacity-action">
                      {empty > 0 ? "Add or classify contacts" : "Review contacts"}
                      <Icon name="arrow-right" size={13} />
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </>
      )}

      {view !== "contacts" && (
        <>
          <div className="sheet-toolbar outreach-toolbar">
            <input
              className="sheet-search"
              placeholder="Search contact or company"
              value={q}
              onChange={(event) => setQ(event.target.value)}
            />
            <div className="outreach-channel-tabs">
              <button
                type="button"
                className={channelTab === "all" ? "active" : undefined}
                onClick={() => setChannelTab("all")}
              >
                All
              </button>
              {OUTREACH_CHANNELS.map((channel) => (
                <button
                  key={channel.key}
                  type="button"
                  className={channelTab === channel.key ? "active" : undefined}
                  onClick={() => setChannelTab(channel.key)}
                >
                  {channel.label}
                </button>
              ))}
            </div>
            {error && <span className="sheet-error">{error}</span>}
          </div>
          {view === "today" ? renderPlanTable(todayRows) : renderPlanTable(weekRows)}
          <p className="sheet-count">
            {view === "today"
              ? `${todayRows.filter((item) => item.status !== "REACHED_OUT").length} open today. Missed work carries forward and consumes the next day's capacity.`
              : `${weekRows.length} contacts in this week's pool. Highest importance is promoted first.`}
          </p>
        </>
      )}

      {view === "contacts" && (
        <>
          <div className="mode-tabs outreach-category-tabs">
            {categoryTabs.map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`mode-tab${categoryTab === key ? " active" : ""}`}
                onClick={() => setCategoryTab(key)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="sheet-toolbar">
            <input
              className="sheet-search"
              placeholder="Search name, company, email, or context"
              value={q}
              onChange={(event) => setQ(event.target.value)}
            />
            {error && <span className="sheet-error">{error}</span>}
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setDraft(draft ? null : { ...EMPTY_DRAFT })}
            >
              <Icon name="plus" size={13} strokeWidth={2.5} /> Add contact
            </button>
          </div>

          <datalist id="crm-company-options">
            {companies.map((name) => <option key={name} value={name} />)}
          </datalist>

          <div className="card table-shell outreach-contact-table-shell">
            <table className="data-table sheet-table outreach-contact-table">
              <colgroup>
                {COLUMNS.map((column) => (
                  <col
                    key={column.key}
                    style={column.width ? { width: column.width } : undefined}
                  />
                ))}
                <col style={{ width: 32 }} />
              </colgroup>
              <thead>
                <tr>
                  {COLUMNS.map(header)}
                  <th style={{ cursor: "default" }} aria-label="Row actions" />
                </tr>
              </thead>
              <tbody>
                {draft && (
                  <tr
                    className="sheet-draft-row"
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        (event.target as HTMLElement).tagName === "INPUT"
                      ) {
                        saveDraft();
                      }
                    }}
                  >
                    <td>
                      <CellSelect
                        value={draft.status}
                        options={CONTACT_STATUSES}
                        onCommit={(value) => setDraft({ ...draft, status: value })}
                      />
                    </td>
                    <td>
                      <CellSelect
                        value={draft.importance}
                        options={CONTACT_IMPORTANCE_LEVELS}
                        onCommit={(value) => setDraft({ ...draft, importance: value })}
                      />
                    </td>
                    <td>
                      <CellSelect
                        value={draft.category}
                        options={CONTACT_CATEGORIES}
                        onCommit={(value) => setDraft({ ...draft, category: value })}
                      />
                    </td>
                    <td>
                      <input
                        className="sheet-input"
                        placeholder="Full name *"
                        autoFocus
                        value={draft.name}
                        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="sheet-input"
                        placeholder="Company *"
                        list="crm-company-options"
                        value={draft.company}
                        onChange={(event) => setDraft({ ...draft, company: event.target.value })}
                      />
                    </td>
                    <td>
                      <CellSelect
                        value={draft.context}
                        options={CONTACT_CONTEXTS}
                        onCommit={(value) => setDraft({ ...draft, context: value })}
                      />
                    </td>
                    <td>
                      <input className="sheet-input" placeholder="Title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
                    </td>
                    <td>
                      <CellSelect
                        value={draft.outreachChannel || null}
                        options={OUTREACH_CHANNEL_OPTIONS}
                        allowEmpty
                        onCommit={(value) => setDraft({ ...draft, outreachChannel: value })}
                      />
                    </td>
                    <td>
                      <input className="sheet-input" placeholder="Email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} />
                    </td>
                    <td>
                      <input className="sheet-input" placeholder="Bookface URL" value={draft.bookfaceUrl} onChange={(event) => setDraft({ ...draft, bookfaceUrl: event.target.value })} />
                    </td>
                    <td>
                      <input className="sheet-input" placeholder="LinkedIn URL" value={draft.linkedinUrl} onChange={(event) => setDraft({ ...draft, linkedinUrl: event.target.value })} />
                    </td>
                    <td>
                      <input className="sheet-input" placeholder="Phone" value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} />
                    </td>
                    <td>
                      <input className="sheet-input" placeholder="Location" value={draft.location} onChange={(event) => setDraft({ ...draft, location: event.target.value })} />
                    </td>
                    <td>
                      <div className="sheet-draft-actions">
                        <button type="button" className="btn btn-sm" disabled={savingDraft} onClick={saveDraft}>
                          {savingDraft ? "Saving…" : "Save"}
                        </button>
                      </div>
                    </td>
                    <td>
                      <input className="sheet-input" placeholder="Notes" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
                    </td>
                    <td>
                      <button type="button" className="sheet-del" title="Discard" disabled={savingDraft} onClick={() => setDraft(null)}>
                        <Icon name="x" size={13} />
                      </button>
                    </td>
                  </tr>
                )}
                {visibleContacts.length === 0 && !draft && (
                  <tr>
                    <td colSpan={COLUMNS.length + 1} className="table-empty-cell">
                      {rows.length === 0
                        ? "No contacts yet. Add the first contact to start the outreach pool."
                        : "No contacts match."}
                    </td>
                  </tr>
                )}
                {visibleContacts.map((row) => {
                  const revision = (field: string) => revisions[`${row.id}:${field}`] ?? 0;
                  const busy = (busyCounts[row.id] ?? 0) > 0;
                  return (
                    <tr key={row.id} className={busy ? "sheet-row-busy" : undefined}>
                      <td>
                        <CellSelect key={`s${revision("status")}:${row.status ?? ""}`} value={row.status} options={CONTACT_STATUSES} allowEmpty onCommit={(value) => commit(row, { status: value })} />
                      </td>
                      <td>
                        <CellSelect key={`i${revision("importance")}:${row.importance}`} value={row.importance} options={CONTACT_IMPORTANCE_LEVELS} onCommit={(value) => commit(row, { importance: value })} />
                      </td>
                      <td>
                        <CellSelect key={`g${revision("category")}:${row.category ?? ""}`} value={row.category} options={CONTACT_CATEGORIES} allowEmpty onCommit={(value) => commit(row, { category: value })} />
                      </td>
                      <td>
                        <CellInput key={`n${revision("name")}:${row.name}`} value={row.name} onCommit={(value) => commit(row, { name: value })} />
                      </td>
                      <td>
                        <CellInput key={`c${revision("company")}:${row.company}`} value={row.company} list="crm-company-options" onCommit={(value) => commitCompany(row, value)} />
                      </td>
                      <td>
                        <CellSelect key={`x${revision("context")}:${row.context}`} value={row.context} options={CONTACT_CONTEXTS} onCommit={(value) => commit(row, { context: value })} />
                      </td>
                      <td>
                        <CellInput key={`t${revision("title")}:${row.title ?? ""}`} value={row.title} onCommit={(value) => commit(row, { title: value })} />
                      </td>
                      <td>
                        <CellSelect key={`h${revision("outreachChannel")}:${row.outreachChannel ?? ""}`} value={row.outreachChannel} options={OUTREACH_CHANNEL_OPTIONS} allowEmpty onCommit={(value) => commit(row, { outreachChannel: value })} />
                      </td>
                      <td>
                        <CellInput key={`e${revision("email")}:${row.email ?? ""}`} value={row.email} onCommit={(value) => commit(row, { email: value })} />
                      </td>
                      <td>
                        <CellInput key={`b${revision("bookfaceUrl")}:${row.bookfaceUrl ?? ""}`} value={row.bookfaceUrl} onCommit={(value) => commit(row, { bookfaceUrl: value })} />
                      </td>
                      <td>
                        <CellInput key={`d${revision("linkedinUrl")}:${row.linkedinUrl ?? ""}`} value={row.linkedinUrl} onCommit={(value) => commit(row, { linkedinUrl: value })} />
                      </td>
                      <td>
                        <CellInput key={`p${revision("phone")}:${row.phone ?? ""}`} value={row.phone} onCommit={(value) => commit(row, { phone: value })} />
                      </td>
                      <td>
                        <CellInput key={`l${revision("location")}:${row.location ?? ""}`} value={row.location} onCommit={(value) => commit(row, { location: value })} />
                      </td>
                      <td className="sheet-touch" title={row.lastTouchAt ? new Date(row.lastTouchAt).toLocaleString("en-GB") : undefined}>
                        {fmtLastTouch(row.lastTouchAt)}
                      </td>
                      <td>
                        <CellInput key={`o${revision("notes")}:${row.notes ?? ""}`} value={row.notes} onCommit={(value) => commit(row, { notes: value })} />
                      </td>
                      <td>
                        <button type="button" className="sheet-del" title={`Delete ${row.name}`} onClick={() => remove(row)}>
                          <Icon name="x" size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="sheet-count">
            Showing {visibleContacts.length} of {rows.length} contacts. Weekly planning uses
            Not contacted and Queued startup or personally important rows with a preferred
            channel, highest importance first. Forwarders stay data-only.
          </p>
        </>
      )}
    </div>
  );
}
