"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { completeTaskAction } from "@/app/dashboard/activity/actions";

type Task = {
  id: string;
  title: string;
  dueAt: string | null;
  company: { id: string; name: string };
};

export function TaskListInline({
  tasks,
  now,
  labels,
}: {
  tasks: Task[];
  now: string;
  labels: { colTask: string; colCompany: string; colDue: string };
}) {
  const [items, setItems] = useState(tasks);
  const [pending, startTransition] = useTransition();

  function handleDone(taskId: string) {
    setItems((prev) => prev.filter((t) => t.id !== taskId));
    startTransition(async () => {
      await completeTaskAction(taskId);
    });
  }

  const nowDate = new Date(now);

  if (items.length === 0) {
    return (
      <div style={{ padding: "16px 20px", color: "var(--text-3)", fontSize: 13 }}>
        All caught up.
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table style={{ border: "none", borderTop: "1px solid var(--border)", borderRadius: 0 }}>
        <thead>
          <tr>
            <th style={{ width: 28 }} />
            <th>{labels.colTask}</th>
            <th>{labels.colCompany}</th>
            <th>{labels.colDue}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((task) => {
            const isOverdue = task.dueAt ? new Date(task.dueAt) < nowDate : false;
            return (
              <tr key={task.id} style={{ opacity: pending ? 0.6 : 1 }}>
                <td style={{ paddingRight: 0 }}>
                  <button
                    type="button"
                    onClick={() => handleDone(task.id)}
                    title="Mark done"
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: "50%",
                      border: "2px solid var(--border)",
                      background: "transparent",
                      cursor: "pointer",
                      padding: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  />
                </td>
                <td style={{ fontWeight: 500 }}>{task.title}</td>
                <td>
                  <Link href={`/dashboard/customers/${task.company.id}`} style={{ color: "var(--brand)" }}>
                    {task.company.name}
                  </Link>
                </td>
                <td style={{ fontSize: 12, color: isOverdue ? "var(--danger)" : "var(--warning)", fontWeight: 600 }}>
                  {task.dueAt ? new Date(task.dueAt).toLocaleDateString() : "—"}
                  {isOverdue && (
                    <span style={{ marginLeft: 6, fontSize: 10, background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid var(--danger-border)", borderRadius: 4, padding: "1px 5px" }}>
                      overdue
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
