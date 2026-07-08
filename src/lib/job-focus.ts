"use server";

import { cookies } from "next/headers";

// The focus cookie is set by middleware when a load's detail page is visited
// (including via a ⌘K search pick); the dashboard workbench reads it to
// decide which load to show.
export async function getFocusedJobId(): Promise<string | null> {
  const c = await cookies();
  return c.get("focus-job")?.value ?? null;
}
