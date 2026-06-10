// Quote line items are stored pipe-delimited (desc|amount|currency per line).
// They used to live inside Job.notes; they now live in Job.quoteLines so notes
// is a clean human-facing field. parseQuoteLines falls back to legacy pipe
// lines found in notes for jobs created before the split.

export type QuoteLine = { desc: string; amount: number; cur: string };

export function parsePipeLines(raw: string | null | undefined): QuoteLine[] {
  return (raw ?? "")
    .split("\n")
    .filter((l) => l.includes("|"))
    .map((l) => {
      const [desc, amt, cur] = l.split("|");
      return { desc, amount: Number(amt), cur: cur || "USD" };
    });
}

export function parseQuoteLines(job: { quoteLines: string | null; notes: string | null }): QuoteLine[] {
  const own = parsePipeLines(job.quoteLines);
  if (own.length > 0) return own;
  return parsePipeLines(job.notes); // legacy: lines stored in notes
}

// Notes with legacy quote lines stripped out — what the user should see as "their note".
export function cleanNotes(notes: string | null | undefined): string {
  return (notes ?? "")
    .split("\n")
    .filter((l) => !l.includes("|"))
    .join("\n")
    .trim();
}
