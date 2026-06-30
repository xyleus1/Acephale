"use server";

import { requireSession } from "./auth";
import { seedDemoLoad as _seed } from "./seed-demo-load";

// Thin session-wrapped wrapper so client components can call the seed without
// bypassing auth. The underlying seedDemoLoad takes officeId so it can be
// reused from agent tool dispatch (which already has officeId in context).
export async function seedDemoLoad(): Promise<{ ok: true; jobId: string; reference: string; created: boolean } | { error: string }> {
  const session = await requireSession();
  return _seed({ officeId: session.officeId });
}
