"use client";

import { useState } from "react";
import Link from "next/link";
import { completeTaskAction, resolveQuoteAction } from "@/app/dashboard/activity/actions";
import { Icon } from "@/components/icon";

type TaskCard = {
  id: string;
  title: string;
  dueAt: string | null;
  isOverdue: boolean;
  company: { id: string; name: string };
};

type QuoteCard = {
  id: string;
  origin: string | null;
  destination: string | null;
  mode: string | null;
  value: number | null;
  currency: string | null;
  daysOld: number;
  company: { id: string; name: string };
};

type StaleCard = {
  id: string;
  name: string;
  daysSince: number | null;
};

function SectionLabel({
  children,
  count,
  tone = "default",
}: {
  children: React.ReactNode;
  count?: number;
  tone?: "danger" | "warning" | "default";
}) {
  return (
    <div className={["activity-feed-label", tone].join(" ")}>
      <span className="activity-feed-label-text">{children}</span>
      {count !== undefined && <span className="activity-feed-count">{count}</span>}
    </div>
  );
}

export function ActivityFeed({
  tasks,
  quotes,
  stale,
  userName,
}: {
  tasks: TaskCard[];
  quotes: QuoteCard[];
  stale: StaleCard[];
  userName: string;
}) {
  const [taskList, setTaskList] = useState(tasks);
  const [quoteList, setQuoteList] = useState(quotes);
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [showAllOverdue, setShowAllOverdue] = useState(false);
  const [showAllQuotes, setShowAllQuotes] = useState(false);
  const OVERDUE_PREVIEW = 5;
  const QUOTES_PREVIEW = 5;

  async function doneTask(id: string) {
    setDoneIds((prev) => new Set([...prev, id]));
    setBusy(id);
    await completeTaskAction(id);
    setTaskList((prev) => prev.filter((t) => t.id !== id));
    setDoneIds((prev) => {
      const s = new Set(prev);
      s.delete(id);
      return s;
    });
    setBusy(null);
  }

  async function resolveQuote(id: string, result: "WON" | "LOST") {
    setBusy(id);
    setQuoteList((prev) => prev.filter((q) => q.id !== id));
    await resolveQuoteAction(id, result);
    setBusy(null);
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const overdueTasks = taskList.filter((t) => t.isOverdue);
  const dueTodayTasks = taskList.filter((t) => !t.isOverdue);
  const allEmpty = taskList.length === 0 && quoteList.length === 0 && stale.length === 0;
  const visibleOverdue = showAllOverdue ? overdueTasks : overdueTasks.slice(0, OVERDUE_PREVIEW);
  const visibleQuotes = showAllQuotes ? quoteList : quoteList.slice(0, QUOTES_PREVIEW);

  return (
    <div className="activity-feed">
      <div className="activity-feed-header">
        <h2 className="activity-feed-title">{greeting}, {userName.split(" ")[0]}.</h2>
        {!allEmpty && <p className="activity-feed-subtitle">Here&apos;s what needs your attention.</p>}
      </div>

      {allEmpty && (
        <div className="activity-feed-empty">
          <span className="activity-feed-empty-icon">
            <Icon name="check" size={28} />
          </span>
          No open tasks, no pending quotes, no stale accounts.
        </div>
      )}

      <div className="activity-feed-stack">
        {overdueTasks.length > 0 && (
          <section>
            <SectionLabel count={overdueTasks.length} tone="danger">Overdue</SectionLabel>
            <div className="activity-feed-list">
              {visibleOverdue.map((task) => (
                <TaskRow key={task.id} task={task} onDone={doneTask} isDone={doneIds.has(task.id)} busy={busy === task.id} />
              ))}
            </div>
            {overdueTasks.length > OVERDUE_PREVIEW && (
              <button
                type="button"
                onClick={() => setShowAllOverdue((v) => !v)}
                className="activity-feed-more danger"
              >
                {showAllOverdue ? "Show less" : `+ ${overdueTasks.length - OVERDUE_PREVIEW} more overdue`}
              </button>
            )}
          </section>
        )}

        {dueTodayTasks.length > 0 && (
          <section>
            <SectionLabel count={dueTodayTasks.length} tone="warning">Due today</SectionLabel>
            <div className="activity-feed-list">
              {dueTodayTasks.map((task) => (
                <TaskRow key={task.id} task={task} onDone={doneTask} isDone={doneIds.has(task.id)} busy={busy === task.id} />
              ))}
            </div>
          </section>
        )}

        {quoteList.length > 0 && (
          <section>
            <SectionLabel count={quoteList.length} tone="warning">Awaiting response</SectionLabel>
            <div className="activity-feed-list">
              {visibleQuotes.map((q) => (
                <QuoteRow key={q.id} quote={q} onResolve={resolveQuote} busy={busy === q.id} />
              ))}
            </div>
            {quoteList.length > QUOTES_PREVIEW && (
              <button
                type="button"
                onClick={() => setShowAllQuotes((v) => !v)}
                className="activity-feed-more warning"
              >
                {showAllQuotes ? "Show less" : `+ ${quoteList.length - QUOTES_PREVIEW} more quotes`}
              </button>
            )}
          </section>
        )}

        {stale.length > 0 && (
          <section>
            <SectionLabel count={stale.length}>No recent contact</SectionLabel>
            <div className="activity-stale-list">
              {stale.map((c) => (
                <div key={c.id} className="activity-stale-row">
                  <Link href={`/dashboard/crm/companies/${c.id}`} className="activity-stale-link">
                    {c.name}
                  </Link>
                  <span className="activity-stale-date">
                    {c.daysSince !== null ? `${c.daysSince} days ago` : "Never"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function TaskRow({
  task,
  onDone,
  isDone,
  busy,
}: {
  task: TaskCard;
  onDone: (id: string) => void;
  isDone: boolean;
  busy: boolean;
}) {
  return (
    <div className={["activity-feed-row", isDone ? "is-done" : ""].filter(Boolean).join(" ")}>
      <button
        type="button"
        onClick={() => onDone(task.id)}
        disabled={busy || isDone}
        className={["activity-task-check", task.isOverdue ? "overdue" : ""].filter(Boolean).join(" ")}
        aria-label={`Complete ${task.title}`}
      />
      <div className="activity-feed-main">
        <span className="activity-feed-row-title">{task.title}</span>
        <span className="activity-feed-sep">·</span>
        <Link href={`/dashboard/crm/companies/${task.company.id}`} className="activity-feed-link">
          {task.company.name}
        </Link>
      </div>
      {task.dueAt && (
        <span className={["activity-feed-date", task.isOverdue ? "overdue" : ""].filter(Boolean).join(" ")}>
          {new Date(task.dueAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
        </span>
      )}
    </div>
  );
}

function QuoteRow({
  quote,
  onResolve,
  busy,
}: {
  quote: QuoteCard;
  onResolve: (id: string, result: "WON" | "LOST") => void;
  busy: boolean;
}) {
  const urgent = quote.daysOld >= 5;
  const aging = quote.daysOld >= 2;
  const ageTone = urgent ? "urgent" : aging ? "aging" : "";

  return (
    <div className={["activity-feed-row", "quote", ageTone].filter(Boolean).join(" ")}>
      <div className="activity-feed-main">
        <Link href={`/dashboard/crm/companies/${quote.company.id}`} className="activity-feed-row-title">
          {quote.company.name}
        </Link>
        <div className="activity-feed-meta">
          {quote.origin && quote.destination ? (
            <span>{quote.origin} → {quote.destination}</span>
          ) : (
            <span>Quote pending</span>
          )}
          {quote.mode && <span className="activity-feed-mode">{quote.mode}</span>}
          {quote.value && (
            <span className="activity-feed-value">
              {quote.value.toLocaleString()} {quote.currency ?? ""}
            </span>
          )}
        </div>
      </div>
      <span className={["activity-feed-age", ageTone].filter(Boolean).join(" ")}>
        {quote.daysOld === 0 ? "Today" : `${quote.daysOld}d`}
      </span>
      <div className="activity-feed-actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => onResolve(quote.id, "WON")}
          className="activity-resolution-btn won"
        >
          Won
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onResolve(quote.id, "LOST")}
          className="activity-resolution-btn lost"
        >
          Lost
        </button>
      </div>
    </div>
  );
}
