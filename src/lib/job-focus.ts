"use server";

import { cookies } from "next/headers";

// The focus cookie is set by middleware (visiting a load page) and by the
// command palette (focusJobAction in job-search.ts); the dashboard workbench
// reads it to decide which load to show.
export async function getFocusedJobId(): Promise<string | null> {
  const c = await cookies();
  return c.get("focus-job")?.value ?? null;
}
