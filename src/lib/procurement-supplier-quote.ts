import "server-only";

import { loadBulkRfqOrder } from "@/lib/procurement-bulk-rfq";
import { procurementVendorConversation } from "@/lib/procurement-conversation";
import { advanceProcurementOrderStatus } from "@/lib/procurement-order-status";
import { procurementRepliedVendors } from "@/lib/procurement-reply-scope";
import {
  quoteCapturePage,
  quoteCursorBeforeFailures,
  quoteWriteBatch,
} from "@/lib/procurement-supplier-quote-page";
import {
  mergeSupplierQuoteThread,
  readSupplierQuote,
  supplierQuoteMissingFacts,
  type SupplierQuoteFactSources,
  type SupplierQuoteMessageEvidence,
  type SupplierQuoteMissingFact,
  type SupplierQuoteReading,
} from "@/lib/procurement-supplier-quote-reading";
import {
  getProcurementRequest,
  procurementWorkflowDatabase,
} from "@/lib/procurement-workflow";

// Outreach and replies were never the last mile: a priced answer only becomes a
// purchase order once the price and the lead time are recorded against the
// supplier row the request reads. This captures that from the supplier's own
// reply, with the sentence it came from kept as evidence, and never overwrites
// a quote a human already recorded.

export const QUOTE_CAPTURE_MAX_PER_RUN = 40;
// Reading a reply is a query, not a send, so a pass can afford to look at every
// respondent a request realistically has. Writes stay capped separately, and an
// `after` cursor pages beyond this for a request with more respondents still.
export const QUOTE_CAPTURE_MAX_READS_PER_RUN = 200;

export type SupplierQuoteCandidateState =
  | "COMPLETE"
  | "PARTIAL"
  | "NONE"
  | "ALREADY_RECORDED";

export type SupplierQuoteCandidate = {
  vendorId: string;
  vendorName: string;
  state: SupplierQuoteCandidateState;
  messageId: string | null;
  repliedAt: string | null;
  reading: SupplierQuoteReading | null;
  // A fact merged out of an older reply belongs to that reply, so the message
  // each fact and each evidence sentence came from travels with the reading.
  facts: SupplierQuoteFactSources | null;
  messages: SupplierQuoteMessageEvidence[];
};

export type SupplierQuoteCaptureOutcome = {
  vendorId: string;
  vendorName: string;
  state: "RECORDED" | "ALREADY_RECORDED" | "NOT_FOUND" | "FAILED";
  error: string | null;
};

// A supplier who priced without dating, or dated without pricing, is one
// question away from a purchase order, so the sweep names them and says what
// is still missing instead of dropping a partial reading on the floor.
export type SupplierQuotePartial = {
  vendorId: string;
  vendorName: string;
  missing: SupplierQuoteMissingFact[];
};

// Later pages read later respondents, so a partial already named keeps the
// reading it was named with rather than being listed twice.
function mergeQuotePartials(
  earlier: readonly SupplierQuotePartial[],
  later: readonly SupplierQuotePartial[],
): SupplierQuotePartial[] {
  const byVendorId = new Map(earlier.map((partial) => [partial.vendorId, partial]));
  for (const partial of later) {
    if (!byVendorId.has(partial.vendorId)) byVendorId.set(partial.vendorId, partial);
  }
  return [...byVendorId.values()];
}

export type SupplierQuoteCaptureResult = {
  orderId: string;
  material: string;
  candidates: number;
  recorded: number;
  failed: number;
  outcomes: SupplierQuoteCaptureOutcome[];
  partials: SupplierQuotePartial[];
  // The last respondent this pass read, so the next pass starts after it.
  nextCursor: string | null;
};

export type RecordedSupplierQuote = {
  unitPrice: SupplierQuoteReading["unitPrice"];
  totalPrice: SupplierQuoteReading["totalPrice"];
  quantity: number | null;
  minimumOrderQuantity: number | null;
  leadTimeDays: number | null;
  source: {
    channel: "EMAIL";
    // The newest inbound reply, which is what the request shows as the answer.
    messageId: string;
    repliedAt: string | null;
    evidence: string[];
    // Which reply supplied each fact, and the sentences each reply supplied,
    // so a price read from an older message is never credited to the newest.
    facts: SupplierQuoteFactSources;
    messages: SupplierQuoteMessageEvidence[];
  };
  capturedAt: string;
  capturedBy: "supplier-reply-reading";
};

function quoteRecord(args: {
  reading: SupplierQuoteReading;
  messageId: string;
  repliedAt: string | null;
  facts: SupplierQuoteFactSources;
  messages: SupplierQuoteMessageEvidence[];
}): RecordedSupplierQuote {
  return {
    unitPrice: args.reading.unitPrice,
    totalPrice: args.reading.totalPrice,
    quantity: args.reading.quantity,
    minimumOrderQuantity: args.reading.minimumOrderQuantity,
    leadTimeDays: args.reading.leadTimeDays,
    source: {
      channel: "EMAIL",
      messageId: args.messageId,
      repliedAt: args.repliedAt,
      evidence: args.reading.evidence,
      facts: args.facts,
      messages: args.messages,
    },
    capturedAt: new Date().toISOString(),
    capturedBy: "supplier-reply-reading",
  };
}

// The dashboard role holds no update privilege on the supplier table, so the
// write goes through the tenant scoped database function: it proves the order
// belongs to this customer, writes the quote column alone, and refuses a row
// that already holds a quote, which keeps a rerun idempotent and an operator
// recorded quote intact. Another customer's row is rejected by the database
// rather than by this call site.
async function writeSupplierQuote(args: {
  customerId: string;
  orderId: string;
  vendorId: string;
  quote: RecordedSupplierQuote;
}) {
  const rows = await procurementWorkflowDatabase().$queryRawUnsafe<
    Array<{ recorded: boolean | null }>
  >(
    "SELECT record_order_vendor_quote($1::uuid, $2::uuid, $3::uuid, $4::jsonb) AS recorded",
    args.customerId,
    args.orderId,
    args.vendorId,
    JSON.stringify(args.quote),
  );
  return rows[0]?.recorded === true;
}

export async function listSupplierQuoteCandidates(input: {
  orderId: string;
  reads?: number;
  after?: string | null;
  // A caller with a function limit stops the respondent history read at its
  // deadline, so a long history cannot spend the invocation before a quote or an
  // answer is written. The next pass reads it again from the newest mail.
  outOfTime?: () => boolean;
}): Promise<{
  orderId: string;
  customerId: string;
  material: string;
  candidates: SupplierQuoteCandidate[];
  nextCursor: string | null;
} | null> {
  const summary = await loadBulkRfqOrder(input.orderId);
  if (!summary) return null;
  const order = await getProcurementRequest(summary.customerId, summary.orderId);
  if (!order) return null;
  // Reading is a query and writing is a change, so they carry separate budgets:
  // a pass may look at many replies while still recording at most a batch.
  const reads = Math.min(
    QUOTE_CAPTURE_MAX_READS_PER_RUN,
    Math.max(1, Math.trunc(input.reads ?? QUOTE_CAPTURE_MAX_READS_PER_RUN)),
  );
  const candidates: SupplierQuoteCandidate[] = [];
  // A reply delivered by this app lands in the office email records, and the
  // workflow ledger may never see it, so the office records decide who answered
  // alongside the projected count. That read covers the request's whole inbound
  // history, so a price in a reply older than the newest mail records of a long
  // running request is still read. Only a supplier that answered can hold a
  // price, so a request with hundreds of silent suppliers costs one
  // conversation read per reply, not per row.
  const replied = (await procurementRepliedVendors({
    officeId: summary.officeId,
    orderId: summary.orderId,
    vendors: order.vendors,
    outOfTime: input.outOfTime,
  })).vendors;
  const byId = new Map(replied.map((vendor) => [vendor.id, vendor]));
  const page = quoteCapturePage(
    replied.map((vendor) => ({
      id: vendor.id,
      quoted: Boolean(vendor.quote && Object.keys(vendor.quote).length > 0),
    })),
    { after: input.after, reads },
  );
  for (const vendorId of page.recorded) {
    const vendor = byId.get(vendorId);
    if (!vendor) continue;
    candidates.push({
      vendorId: vendor.id,
      vendorName: vendor.name,
      state: "ALREADY_RECORDED",
      messageId: null,
      repliedAt: null,
      reading: null,
      facts: null,
      messages: [],
    });
  }
  for (const vendorId of page.read) {
    const vendor = byId.get(vendorId);
    if (!vendor) continue;
    const conversation = await procurementVendorConversation({
      officeId: summary.officeId,
      customerId: summary.customerId,
      orderId: summary.orderId,
      vendorId: vendor.id,
    });
    // A supplier may price in one message and date it in the next, so the whole
    // thread is read newest first: the newest statement of a fact wins and an
    // older message only fills what the newest is silent about.
    const inbound = conversation.messages
      .filter((message) => message.direction === "INBOUND")
      .reverse();
    const newest = inbound.at(0) ?? null;
    if (!newest) continue;
    // A reply usually carries our own subject back, and only the subjects we
    // sent tell that apart from a heading the supplier rewrote to state a price
    // or a lead time.
    const ourSubjects = conversation.messages
      .filter((message) => message.direction === "OUTBOUND")
      .map((message) => message.subject ?? "")
      .filter((subject) => subject.trim().length > 0);
    const thread = mergeSupplierQuoteThread(inbound.map((message) => ({
      messageId: message.id,
      reading: readSupplierQuote({
        subject: message.subject,
        body: message.body,
        ourSubjects,
      }),
    })));
    const reading = thread.reading;
    const priced = Boolean(reading.unitPrice ?? reading.totalPrice) || reading.leadTimeDays !== null;
    candidates.push({
      vendorId: vendor.id,
      vendorName: vendor.name,
      state: reading.complete ? "COMPLETE" : priced ? "PARTIAL" : "NONE",
      messageId: newest.id,
      repliedAt: newest.sentAt,
      reading,
      facts: thread.facts,
      messages: thread.messages,
    });
  }
  return {
    orderId: summary.orderId,
    customerId: summary.customerId,
    material: summary.material,
    candidates: candidates.sort((left, right) => left.vendorId.localeCompare(right.vendorId)),
    nextCursor: page.nextCursor,
  };
}

// A pass that always starts at the first respondent can never reach the rest:
// a request whose first pages stay unquoted would hide every later priced
// reply. A sweep carries the cursor of the run before it, so one pass walks the
// whole request in bounded pages and spends the write budget across all of it.
export const QUOTE_CAPTURE_MAX_PAGES_PER_SWEEP = 5;

export async function sweepSupplierQuoteCapture(input: {
  orderId: string;
  limit?: number;
  reads?: number;
  pages?: number;
  // A page is the bounded unit of work here, so a caller with a function limit
  // to return inside stops the sweep between pages. The cursor of the next pass
  // picks the sweep up where this one left it.
  outOfTime?: () => boolean;
}): Promise<SupplierQuoteCaptureResult | null> {
  const pages = Math.max(1, Math.trunc(input.pages ?? QUOTE_CAPTURE_MAX_PAGES_PER_SWEEP));
  const budget = Math.min(
    QUOTE_CAPTURE_MAX_PER_RUN,
    Math.max(1, Math.trunc(input.limit ?? QUOTE_CAPTURE_MAX_PER_RUN)),
  );
  let swept: SupplierQuoteCaptureResult | null = null;
  let cursor: string | null = null;
  let remaining = budget;
  for (let page = 0; page < pages; page += 1) {
    if (page > 0 && input.outOfTime?.()) break;
    const run: SupplierQuoteCaptureResult | null = await runSupplierQuoteCapture({
      orderId: input.orderId,
      limit: remaining,
      reads: input.reads,
      outOfTime: input.outOfTime,
      after: cursor,
    });
    if (!run) return swept;
    swept = swept
      ? {
        ...run,
        candidates: swept.candidates + run.candidates,
        recorded: swept.recorded + run.recorded,
        failed: swept.failed + run.failed,
        outcomes: [...swept.outcomes, ...run.outcomes],
        partials: mergeQuotePartials(swept.partials, run.partials),
      }
      : run;
    // A write that failed leaves the cursor short of it, so the next page would
    // read the same replies again. That retry belongs to the next pass.
    if (run.failed > 0) break;
    remaining -= run.recorded;
    cursor = run.nextCursor;
    if (!cursor || remaining <= 0) break;
  }
  return swept;
}

export async function runSupplierQuoteCapture(input: {
  orderId: string;
  limit?: number;
  reads?: number;
  after?: string | null;
  outOfTime?: () => boolean;
  advanceStatus?: typeof advanceProcurementOrderStatus;
}): Promise<SupplierQuoteCaptureResult | null> {
  const advanceStatus = input.advanceStatus ?? advanceProcurementOrderStatus;
  const plan = await listSupplierQuoteCandidates({
    orderId: input.orderId,
    reads: input.reads,
    after: input.after,
    outOfTime: input.outOfTime,
  });
  if (!plan) return null;
  const limit = Math.min(
    QUOTE_CAPTURE_MAX_PER_RUN,
    Math.max(1, Math.trunc(input.limit ?? QUOTE_CAPTURE_MAX_PER_RUN)),
  );
  // A partial reading is reported but never recorded, because a request that
  // counts a priceless or dateless answer as a quote would call itself ready
  // for a purchase order it cannot place.
  const recordable = plan.candidates.filter((candidate) => candidate.state === "COMPLETE");
  const outcomes: SupplierQuoteCaptureOutcome[] = [];
  const batch = quoteWriteBatch(
    plan.candidates.map((candidate) => ({
      id: candidate.vendorId,
      recordable: candidate.state === "COMPLETE"
        && Boolean(candidate.reading)
        && Boolean(candidate.messageId)
        && Boolean(candidate.facts),
    })),
    { limit, readCursor: plan.nextCursor },
  );
  const byVendorId = new Map(plan.candidates.map((candidate) => [candidate.vendorId, candidate]));
  for (const vendorId of batch.write) {
    const candidate = byVendorId.get(vendorId);
    if (!candidate?.reading || !candidate.messageId || !candidate.facts) continue;
    try {
      const written = await writeSupplierQuote({
        customerId: plan.customerId,
        orderId: plan.orderId,
        vendorId: candidate.vendorId,
        quote: quoteRecord({
          reading: candidate.reading,
          messageId: candidate.messageId,
          repliedAt: candidate.repliedAt,
          facts: candidate.facts,
          messages: candidate.messages,
        }),
      });
      outcomes.push({
        vendorId: candidate.vendorId,
        vendorName: candidate.vendorName,
        state: written ? "RECORDED" : "ALREADY_RECORDED",
        error: null,
      });
    } catch (error) {
      console.error("supplier quote capture failed", {
        orderId: plan.orderId,
        vendorId: candidate.vendorId,
        message: error instanceof Error ? error.message : "unknown error",
      });
      outcomes.push({
        vendorId: candidate.vendorId,
        vendorName: candidate.vendorName,
        state: "FAILED",
        error: "The supplier quote could not be recorded.",
      });
    }
  }
  const recorded = outcomes.filter((outcome) => outcome.state === "RECORDED").length;
  const alreadyRecorded = plan.candidates.some((candidate) => candidate.state === "ALREADY_RECORDED")
    || outcomes.some((outcome) => outcome.state === "ALREADY_RECORDED");
  // A priced answer on file is what the operator is waiting on, so the request
  // moves to their decision the first time one is recorded.
  if (recorded > 0 || alreadyRecorded) {
    await advanceStatus({
      customerId: plan.customerId,
      orderId: plan.orderId,
      event: "quote_recorded",
    });
  }
  return {
    orderId: plan.orderId,
    material: plan.material,
    candidates: recordable.length,
    partials: plan.candidates.flatMap((candidate) => (
      candidate.state === "PARTIAL" && candidate.reading
        ? [{
          vendorId: candidate.vendorId,
          vendorName: candidate.vendorName,
          missing: supplierQuoteMissingFacts(candidate.reading),
        }]
        : []
    )),
    recorded,
    failed: outcomes.filter((outcome) => outcome.state === "FAILED").length,
    outcomes,
    // A reply whose write failed is not left behind the cursor, so a database
    // outage costs a retry rather than a lost quote.
    nextCursor: quoteCursorBeforeFailures({
      cursor: batch.nextCursor,
      settled: batch.settled,
      failed: outcomes
        .filter((outcome) => outcome.state === "FAILED")
        .map((outcome) => outcome.vendorId),
    }),
  };
}
