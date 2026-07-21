import "server-only";

import { prisma } from "./prisma";
import { securityChecklistTemplate } from "./security-sop";

// Seed the per-load security SOP checklist for the job's tier. Additive and
// idempotent: raising the tier adds the new items, existing rows (and their
// completion state) are never touched, and nothing is deleted on downgrade -
// completed checks remain part of the load's record.
export async function ensureLoadSecurityChecklist(
  officeId: string,
  jobId: string,
  securityTier: string | null | undefined,
): Promise<void> {
  const template = securityChecklistTemplate(securityTier);
  if (template.length === 0) return;
  await prisma.loadSecurityCheck.createMany({
    data: template.map((item) => ({ officeId, jobId, key: item.key, label: item.label })),
    skipDuplicates: true,
  });
}
