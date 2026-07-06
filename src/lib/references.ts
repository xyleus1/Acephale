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
    const n = parseInt((row.reference ?? "").slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

// Run a create that retries with a fresh reference if two creates race into
// the same number (unique constraint violation). Pass `date` when the record
// belongs to an earlier month (e.g. resyncing old sheet rows) so the YYMM in
// the reference matches when the RFQ actually arrived.
export async function createWithFileReference<T>(
  officeId: string,
  create: (reference: string) => Promise<T>,
  date: Date = new Date()
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const reference = await nextFileReference(officeId, date);
    try {
      return await create(reference);
    } catch (e) {
      lastErr = e;
      const code = (e as { code?: string })?.code;
      if (code !== "P2002") throw e; // only retry unique-constraint collisions
    }
  }
  throw lastErr;
}
