import { prisma } from "./prisma";

// Freight file numbers: DRY + YYMM + 4-digit sequence, e.g. DRY26070001.
// Every incoming RFQ (Inquiry) gets one at intake; a load converted from an
// RFQ carries the same file number, and loads created without an RFQ draw
// from the same monthly sequence. Unique per office.

export function fileReferencePrefix(date: Date = new Date()): string {
  // YYMM in Istanbul time so late-night intake doesn't slip into the wrong month.
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
    year: "2-digit",
    month: "2-digit",
  }).formatToParts(date);
  const yy = parts.find((p) => p.type === "year")?.value ?? "00";
  const mm = parts.find((p) => p.type === "month")?.value ?? "00";
  return `DRY${yy}${mm}`;
}

// Next number is max-existing + 1 (counting rows collides after deletes).
// Scans BOTH inquiries and jobs: the two share one sequence so a manually
// created load can never take a number an RFQ already owns.
export async function nextFileReference(officeId: string, date: Date = new Date()): Promise<string> {
  const prefix = fileReferencePrefix(date);
  const [inquiries, jobs] = await Promise.all([
    prisma.inquiry.findMany({
      where: { officeId, reference: { startsWith: prefix } },
      select: { reference: true },
    }),
    prisma.job.findMany({
      where: { officeId, reference: { startsWith: prefix } },
      select: { reference: true },
    }),
  ]);
  let max = 0;
  for (const row of [...inquiries, ...jobs]) {
    const tail = (row.reference ?? "").slice(prefix.length);
    // Only well-formed all-digit tails count — a malformed ref (sheet import
    // typo like "DRY26070001-A") must not be able to jump the sequence.
    if (!/^\d{4,}$/.test(tail)) continue;
    const n = parseInt(tail, 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

// Allocate the next number and run the create while holding a per-office
// advisory lock. The unique indexes on Inquiry and Job are per-table, so two
// concurrent creates hitting DIFFERENT tables could otherwise both scan the
// same max and mint the same number without any constraint firing; the
// transaction-scoped lock serializes the scan + insert. P2002 retry stays as
// a backstop for collisions the lock can't see (e.g. a backfill running
// against an older deploy). Pass `date` when the record belongs to an earlier
// month (e.g. resyncing old sheet rows) so the YYMM matches arrival.
export async function createWithFileReference<T>(
  officeId: string,
  create: (reference: string) => Promise<T>,
  date: Date = new Date()
): Promise<T> {
  const lockKey = `${officeId}:${fileReferencePrefix(date)}`;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
        const reference = await nextFileReference(officeId, date);
        return await create(reference);
      }, { timeout: 15000 });
    } catch (e) {
      lastErr = e;
      const code = (e as { code?: string })?.code;
      if (code !== "P2002") throw e; // only retry unique-constraint collisions
    }
  }
  throw lastErr;
}
