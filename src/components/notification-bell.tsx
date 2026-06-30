"use client";
import { useState, useRef, useEffect } from "react";
import Link from "next/link";

type OverdueTask = {
  id: string;
  title: string;
  dueAt: string | null;
  company: { id: string; name: string };
};

type StaleCompany = {
  id: string;
  name: string;
  lastActivityDate: string | null;
};

type Props = {
  overdueTasks: OverdueTask[];
  staleCompanies: StaleCompany[];
  t: {
    title: string;
    overdueTasks: string;
    staleAccounts: string;
    noNotifications: string;
    viewActivity: string;
    overdue: string;
    daysAgo: string;
    noDue: string;
  };
};

export function NotificationBell({ overdueTasks, staleCompanies, t }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const total = overdueTasks.length + staleCompanies.length;

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="notif-wrap" ref={ref}>
      <button
        className="notif-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label={t.title}
      >
        <span className="notif-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
        </span>
        {total > 0 && <span className="notif-badge">{total > 99 ? "99+" : total}</span>}
      </button>

      {open && (
        <div className="notif-dropdown">
          <div className="notif-header">{t.title}</div>

          {total === 0 ? (
            <div className="notif-empty">{t.noNotifications}</div>
          ) : (
            <>
              {overdueTasks.length > 0 && (
                <div className="notif-section">
                  <div className="notif-section-label">
                    {t.overdueTasks}
                    <span className="notif-count">{overdueTasks.length}</span>
                  </div>
                  {overdueTasks.map((task) => {
                    const daysOverdue = task.dueAt
                      ? Math.floor((Date.now() - new Date(task.dueAt).getTime()) / 86400000)
                      : null;
                    return (
                      <Link
                        key={task.id}
                        href={`/dashboard/customers/${task.company.id}`}
                        className="notif-item"
                        onClick={() => setOpen(false)}
                      >
                        <div className="notif-item-title">{task.title}</div>
                        <div className="notif-item-meta">
                          {task.company.name}
                          {daysOverdue !== null && (
                            <span className="notif-overdue"> · {daysOverdue}{t.daysAgo} {t.overdue}</span>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}

              {staleCompanies.length > 0 && (
                <div className="notif-section">
                  <div className="notif-section-label">
                    {t.staleAccounts}
                    <span className="notif-count">{staleCompanies.length}</span>
                  </div>
                  {staleCompanies.slice(0, 5).map((company) => {
                    const daysAgo = company.lastActivityDate
                      ? Math.floor((Date.now() - new Date(company.lastActivityDate).getTime()) / 86400000)
                      : null;
                    return (
                      <Link
                        key={company.id}
                        href={`/dashboard/customers/${company.id}`}
                        className="notif-item"
                        onClick={() => setOpen(false)}
                      >
                        <div className="notif-item-title">{company.name}</div>
                        <div className="notif-item-meta">
                          {daysAgo !== null ? `${daysAgo}${t.daysAgo}` : t.noDue}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </>
          )}

          <div className="notif-footer">
            <Link href="/dashboard/inbox" onClick={() => setOpen(false)}>
              {t.viewActivity}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
