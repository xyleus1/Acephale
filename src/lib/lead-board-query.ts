// Database side of the agent's lead board: fetch Meta-lead inquiries, join
// the live inbound-reply signal, and derive board rows with lead-board.ts.
// Serves the list_lead_board agent tool and the Incoming RFQs page context
// block in agent-chat.
import "server-only";
import { prisma } from "./prisma";
import { latestInboundByEmail } from "./lead-auto-reply";
import { openInquiryStatusFilter } from "./inquiry-status";
import { US_LEAD_PARSED_MARKER } from "./meta-leads";
import {
  deriveLeadBoardRow,
  leadHasSingleEmail,
  matchesLeadBoardFilter,
  summarizeLeadBoard,
  type LeadBoardCounts,
  type LeadBoardFilter,
  type LeadBoardRow,
} from "./lead-board";

// Marker the sheet sync writes into every lead's parsedData (exact
// JSON.stringify output; rfq-mail filters on the same string).
const META_LEAD_PARSED_MARKER = '"source":"meta-leads"';

export type LeadBoardQuery = LeadBoardFilter & {
  q?: string;
  // "open" mirrors the board's default Open tab. Dropped/closed leads are
  // only visible under "all" - their statuses (IGNORED/BOOKED/...) are closed.
  statusScope?: "open" | "all";
  limit?: number;
};

export type LeadBoardResult = {
  // Rows after every filter, capped at `limit`, newest first.
  rows: LeadBoardRow[];
  // Matching count before the cap.
  totalMatching: number;
  // Stage/quality counts within the market/quality/arrival filters but
  // BEFORE the stage filter - same way the board's stage chips count.
  counts: LeadBoardCounts;
};

export async function loadLeadBoard(officeId: string, query: LeadBoardQuery = {}): Promise<LeadBoardResult> {
  const now = new Date();
  const q = query.q?.trim().slice(0, 120);
  const contains = q ? { contains: q, mode: "insensitive" as const } : null;

  const raw = await prisma.inquiry.findMany({
    where: {
      officeId,
      AND: [
        { parsedData: { contains: META_LEAD_PARSED_MARKER } },
        ...(query.market === "US"
          ? [{ parsedData: { contains: US_LEAD_PARSED_MARKER } }]
          // Pre-US TR rows predate the market tag, so TR = "not marked US".
          : query.market === "TR"
            ? [{ NOT: { parsedData: { contains: US_LEAD_PARSED_MARKER } } }]
            : []),
        ...(query.statusScope === "open" ? [{ status: openInquiryStatusFilter() }] : []),
        ...(query.arrivedWithinDays != null && Number.isFinite(query.arrivedWithinDays)
          ? [{ receivedAt: { gte: new Date(now.getTime() - Math.max(0, query.arrivedWithinDays) * 86_400_000) } }]
          : []),
        ...(contains
          ? [{
              OR: [
                { reference: contains },
                { subject: contains },
                { fromCompany: contains },
                { fromEmail: contains },
                { origin: contains },
                { destination: contains },
                { commodity: contains },
              ],
            }]
          : []),
      ],
    },
    select: {
      id: true, reference: true, subject: true, status: true, receivedAt: true,
      fromEmail: true, fromCompany: true, origin: true, destination: true,
      commodity: true, mode: true, targetPrice: true, targetCurrency: true,
      targetPriceStatus: true, parsedData: true,
    },
    orderBy: { receivedAt: "desc" },
    take: 400,
  });

  // Live reply lookup, same as the US lead cards: newest inbound per lead
  // address across the synced inboxes - one sync fresher than the engine's
  // leadRepliedAt stamp, and the source of the reply excerpt.
  const emails = [...new Set(
    raw.filter((inq) => leadHasSingleEmail(inq.fromEmail)).map((inq) => inq.fromEmail!.toLowerCase()),
  )];
  const liveReplies = emails.length > 0
    ? await latestInboundByEmail(officeId, emails)
    : new Map<string, { sentAt: Date; bodyText: string | null }>();

  const baseFilter: LeadBoardFilter = { ...query, stage: undefined };
  const base = raw
    .map((inq) => deriveLeadBoardRow(
      inq,
      now,
      inq.fromEmail ? liveReplies.get(inq.fromEmail.toLowerCase()) ?? null : null,
    ))
    .filter((row): row is LeadBoardRow => row != null)
    .filter((row) => matchesLeadBoardFilter(row, baseFilter, now));

  const counts = summarizeLeadBoard(base);
  const matching = query.stage ? base.filter((row) => row.stage === query.stage) : base;
  const limit = Math.min(60, Math.max(1, Number(query.limit ?? 20) || 20));
  return { rows: matching.slice(0, limit), totalMatching: matching.length, counts };
}
