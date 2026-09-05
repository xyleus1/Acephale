import "server-only";

import { prisma } from "@/lib/prisma";
import {
  procurementDeliveredReplyCandidates,
  type ProcurementConversationMergeCandidate,
} from "@/lib/procurement-conversation-model";

export const PROCUREMENT_REPLY_EMAIL_TASK_TYPE = "PROCUREMENT_SUPPLIER_REPLY_EMAIL";

// A delivery is stored under the request and the supplier it answered, so the
// answers to one supplier thread can be read back without knowing which mailbox
// carried them.
export function procurementReplyTaskScopeKeys(args: { orderId: string; vendorId: string }) {
  return [
    `procurement-reply:${args.orderId}:${args.vendorId}:`,
    `procurement-chase:${args.orderId}:${args.vendorId}:`,
  ];
}

const MAX_DELIVERED_REPLIES = 50;

// Answers this request already delivered to this supplier, whatever mailbox
// sent them. The newest are read first: an older answer cannot decide whether
// the supplier's latest reply is still owed one, and the transcript is sorted
// by delivery time when it is merged.
export async function deliveredSupplierReplyMessages(args: {
  officeId: string;
  orderId: string;
  vendorId: string;
}): Promise<ProcurementConversationMergeCandidate[]> {
  const tasks = await prisma.supplyExecutionTask.findMany({
    where: {
      officeId: args.officeId,
      taskType: PROCUREMENT_REPLY_EMAIL_TASK_TYPE,
      status: "SUCCEEDED",
      OR: procurementReplyTaskScopeKeys(args).map((key) => ({ taskKey: { startsWith: key } })),
    },
    orderBy: [{ completedAt: "desc" }, { id: "desc" }],
    take: MAX_DELIVERED_REPLIES,
    select: { id: true, input: true, result: true },
  });
  return procurementDeliveredReplyCandidates(tasks);
}
