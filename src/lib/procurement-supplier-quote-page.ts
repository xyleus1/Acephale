export type QuoteCaptureRespondent = {
  id: string;
  quoted: boolean;
};

// A request can hold more respondents than one pass may read, so respondents
// are ordered by id and paged: a pass reads the ones after the cursor it was
// given and reports where it stopped. A supplier that already holds a quote is
// reported without a read, so quoted rows never consume the budget.
export function quoteCapturePage(
  respondents: readonly QuoteCaptureRespondent[],
  args: { after?: string | null; reads: number },
) {
  const after = args.after?.trim() ?? "";
  const ordered = [...respondents]
    .sort((left, right) => left.id.localeCompare(right.id))
    .filter((respondent) => !after || respondent.id.localeCompare(after) > 0);
  const recorded: string[] = [];
  const read: string[] = [];
  let nextCursor: string | null = null;
  for (const respondent of ordered) {
    if (respondent.quoted) {
      recorded.push(respondent.id);
      continue;
    }
    if (read.length >= args.reads) {
      nextCursor = [...recorded, ...read].sort((left, right) => left.localeCompare(right)).at(-1) ?? null;
      break;
    }
    read.push(respondent.id);
  }
  return { recorded, read, nextCursor };
}

export type QuoteWriteCandidate = {
  id: string;
  recordable: boolean;
};

// A pass may read more replies than it may write, so the write batch stops at
// its own budget and reports the last supplier it settled. The reply it did not
// record is then the first one the next pass sees, instead of being paged past
// by the read cursor.
export function quoteWriteBatch(
  candidates: readonly QuoteWriteCandidate[],
  args: { limit: number; readCursor: string | null },
) {
  const ordered = [...candidates].sort((left, right) => left.id.localeCompare(right.id));
  const write: string[] = [];
  let settled: string | null = null;
  let truncated = false;
  for (const candidate of ordered) {
    if (!candidate.recordable) {
      settled = candidate.id;
      continue;
    }
    if (write.length >= Math.max(0, args.limit)) {
      truncated = true;
      break;
    }
    write.push(candidate.id);
    settled = candidate.id;
  }
  const last = settled;
  return {
    write,
    settled: last === null
      ? []
      : ordered
        .filter((candidate) => candidate.id.localeCompare(last) <= 0)
        .map((candidate) => candidate.id),
    nextCursor: truncated ? last : args.readCursor,
  };
}

// A write that failed settled nothing, so the page may not end after it: the
// cursor stops before the earliest failure and the next pass sees that reply
// again. A supplier already recorded is refused a second write anyway, so
// revisiting earlier rows costs a read and never a duplicate quote.
export function quoteCursorBeforeFailures(args: {
  cursor: string | null;
  settled: readonly string[];
  failed: readonly string[];
}): string | null {
  if (!args.failed.length) return args.cursor;
  const earliest = [...args.failed]
    .sort((left, right) => left.localeCompare(right))
    .at(0);
  if (!earliest) return args.cursor;
  const before = args.settled
    .filter((id) => id.localeCompare(earliest) < 0)
    .sort((left, right) => left.localeCompare(right))
    .at(-1) ?? null;
  if (before === null || args.cursor === null) return null;
  return before.localeCompare(args.cursor) < 0 ? before : args.cursor;
}
