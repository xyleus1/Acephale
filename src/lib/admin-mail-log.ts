import "server-only";

import { prisma } from "@/lib/prisma";
import { procurementWorkflowDatabase } from "@/lib/procurement-workflow";

export const MAIL_LOG_PAGE_SIZE = 150;

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

export async function loadMailLog(officeId: string, limit = MAIL_LOG_PAGE_SIZE): Promise<MailLogEntry[]> {
  const messages = await prisma.emailMessage.findMany({
    where: { thread: { officeId } },
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
