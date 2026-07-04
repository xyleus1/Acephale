"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";

// Server-rendered tables reuse .data-row, whose pointer/hover styling promises
// full-row navigation (the jobs table trained that). This keeps the promise.
export function LinkRow({ href, children }: { href: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <tr
      className="data-row"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a")) return; // inner links win
        router.push(href as Route);
      }}
    >
      {children}
    </tr>
  );
}
