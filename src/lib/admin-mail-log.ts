import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { procurementWorkflowDatabase } from "@/lib/procurement-workflow";

export const MAIL_LOG_PAGE_SIZE = 150;

// Every procurement outreach subject carries this reference, so the marker
// separates procurement mail from ordinary sales mail inside the query.
const RFQ_SUBJECT_MARKER = "[RFQ ";

export type MailLogEntry = {
  messageId: string;
  threadId: string;
  direction: "INBOUND" | "OUTBOUND";
  sentAt: Date;
  companyName: string;
  outreachType: "Procurement" | "Sales";
  lineItem: string;
  accountEmail: string;
  counterpartyEmail: string;
  subject: string;
  body: string;
  procurementLink: string | null;
};

export type MailLogFilter = {
  search: string;
  direction: "ALL" | "INBOUND" | "OUTBOUND";
  outreach: "ALL" | "Procurement" | "Sales";
};

export const EMPTY_MAIL_LOG_FILTER: MailLogFilter = {
  search: "",
  direction: "ALL",
  outreach: "ALL",
};

// The filter runs inside the query so a search reaches the whole office mail
// history instead of only the newest page.
export function mailLogMessageWhere(
  officeId: string,
  filter: MailLogFilter,
  matchedReferences: string[],
): Prisma.EmailMessageWhereInput {
  const where: Prisma.EmailMessageWhereInput = { thread: { officeId } };
  if (filter.direction !== "ALL") where.direction = filter.direction;
  if (filter.outreach === "Procurement") {
    where.subject = { contains: RFQ_SUBJECT_MARKER };
  } else if (filter.outreach === "Sales") {
    // A null subject is Sales in the log, and a NOT clause would drop it.
    where.AND = [{
      OR: [{ subject: null }, { NOT: { subject: { contains: RFQ_SUBJECT_MARKER } } }],
    }];
  }
  const search = filter.search.trim();
  if (search) {
    where.OR = [
      { subject: { contains: search, mode: "insensitive" } },
      { fromEmail: { contains: search, mode: "insensitive" } },
      { toEmails: { contains: search, mode: "insensitive" } },
      { account: { email: { contains: search, mode: "insensitive" } } },
      { thread: { officeId, company: { name: { contains: search, mode: "insensitive" } } } },
      ...matchedReferences.map((reference) => ({
        subject: {
          contains: `${RFQ_SUBJECT_MARKER}${reference}]`,
          mode: "insensitive" as const,
        },
      })),
    ];
  }
  return where;
}

type WorkflowOrderRow = {
  orderId: string;
  reference: string;
  companyName: string | null;
  material: string | null;
};

const RFQ_REFERENCE = /\[RFQ ([0-9a-f]{8})\]/i;

function firstRecipient(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) {
      const first = parsed.find((entry) => typeof entry === "string" && entry.includes("@"));
      if (typeof first === "string") return first;
    }
  } catch {
    // The column stores JSON, but a plain address is tolerated.
  }
  return value.trim();
}

// Company and line item live in the workflow database, so a search on either
// resolves to sourcing request references first and then to their subjects.
async function workflowReferencesMatchingSearch(search: string) {
  const rows = await procurementWorkflowDatabase().$queryRawUnsafe<{ reference: string }[]>(
    `
      SELECT DISTINCT left(orders.id::text, 8) AS "reference"
      FROM orders
      JOIN bill_of_materials
        ON bill_of_materials.id = orders.bom_id
        AND bill_of_materials.customer_id = orders.customer_id
      WHERE orders.request_context->'source'->>'company_name' ILIKE $1
        OR bill_of_materials.material ILIKE $1
      LIMIT 200
    `,
    `%${search}%`,
  );
  return rows.map((row) => row.reference);
}

async function workflowOrdersByReference(references: string[]) {
  const map = new Map<string, WorkflowOrderRow>();
  if (!references.length) return map;
  const rows = await procurementWorkflowDatabase().$queryRawUnsafe<WorkflowOrderRow[]>(
    `
      SELECT
        orders.id::text AS "orderId",
        left(orders.id::text, 8) AS "reference",
        orders.request_context->'source'->>'company_name' AS "companyName",
        bill_of_materials.material AS "material"
      FROM orders
      JOIN bill_of_materials
        ON bill_of_materials.id = orders.bom_id
        AND bill_of_materials.customer_id = orders.customer_id
      WHERE left(orders.id::text, 8) = ANY($1::text[])
    `,
    references,
  );
  for (const row of rows) map.set(row.reference.toLowerCase(), row);
  return map;
}

export async function loadMailLog(
  officeId: string,
  filter: MailLogFilter = EMPTY_MAIL_LOG_FILTER,
  limit = MAIL_LOG_PAGE_SIZE,
): Promise<MailLogEntry[]> {
  const search = filter.search.trim();
  const matchedReferences = search
    ? await workflowReferencesMatchingSearch(search).catch(() => [] as string[])
    : [];
  const messages = await prisma.emailMessage.findMany({
    where: mailLogMessageWhere(officeId, filter, matchedReferences),
    orderBy: { sentAt: "desc" },
    take: Math.min(500, Math.max(1, limit)),
    select: {
      id: true,
      threadId: true,
      direction: true,
      subject: true,
      bodyText: true,
      fromEmail: true,
      toEmails: true,
      sentAt: true,
      account: { select: { email: true } },
      thread: { select: { company: { select: { name: true } } } },
    },
  });
  const references = new Set<string>();
  for (const message of messages) {
    const match = RFQ_REFERENCE.exec(message.subject ?? "");
    if (match) references.add(match[1].toLowerCase());
  }
  const orders = await workflowOrdersByReference([...references]).catch(() => new Map<string, WorkflowOrderRow>());
  return messages.map((message) => {
    const subject = message.subject ?? "No subject";
    const match = RFQ_REFERENCE.exec(subject);
    const order = match ? orders.get(match[1].toLowerCase()) ?? null : null;
    const outbound = message.direction === "OUTBOUND";
    const recipient = firstRecipient(message.toEmails);
    return {
      messageId: message.id,
      threadId: message.threadId,
      direction: outbound ? "OUTBOUND" : "INBOUND",
      sentAt: message.sentAt,
      companyName: order?.companyName ?? message.thread.company?.name ?? "Not linked",
      outreachType: match ? "Procurement" : "Sales",
      lineItem: order?.material ?? (match ? `Sourcing request ${match[1]}` : "Not applicable"),
      accountEmail: message.account?.email ?? (outbound ? message.fromEmail : recipient),
      counterpartyEmail: outbound ? recipient : message.fromEmail,
      subject,
      body: (message.bodyText ?? "").slice(0, 4000),
      procurementLink: order
        ? `/dashboard/supply-os?panel=materials&procurementOrder=${order.orderId}`
        : null,
    };
  });
}
