import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  conversationTaskDue,
  nextConversationTaskState,
  type ConversationTaskAttempt,
} from "@/lib/procurement-conversation-task";

// Where a supplier conversation's owed work is kept between passes. The stage
// rule and the retry rule are pure and tested on their own; this file only
// stores what they decided and answers which requests still have work due.

export type ConversationTaskRecord = ConversationTaskAttempt & {
  vendorId: string;
  vendorName: string;
};

export type ConversationTaskBacklog = {
  owed: number;
  // Threads whose next attempt is now, which is the work a pass can actually
  // pick up. The rest are waiting out a backoff after a failure.
  due: number;
  backingOff: number;
  // Threads that have failed repeatedly without progress, reported by name
  // because a supplier stuck behind the same failure needs a person, and this
  // is the number that used to be invisible.
  stuck: Array<{ vendorId: string; vendorName: string; attempts: number; error: string | null }>;
};

// What a caller reports when the store itself could not answer. It is paired
// with a flag, so an unreadable store is never mistaken for a request with
// nothing owed.
export const EMPTY_CONVERSATION_TASK_BACKLOG: ConversationTaskBacklog = {
  owed: 0,
  due: 0,
  backingOff: 0,
  stuck: [],
};

// How many failed attempts without progress make a thread worth a person's
// attention. Three covers a paused mailbox or an exhausted sender pool clearing
// on its own.
export const CONVERSATION_TASK_STUCK_ATTEMPTS = 3;

// Records what a pass did for every supplier conversation it covered. A pass
// covers the whole request, so a thread it did not touch is still written with
// the stage the request projects for it, which is what keeps a silent supplier
// owned instead of forgotten.
export async function recordConversationTasks(args: {
  officeId: string;
  orderId: string;
  entries: readonly ConversationTaskRecord[];
  now?: Date;
}): Promise<number> {
  if (!args.entries.length) return 0;
  const now = args.now ?? new Date();
  let written = 0;
  for (const entry of args.entries) {
    await applyConversationTask({
      officeId: args.officeId,
      orderId: args.orderId,
      entry,
      now,
    });
    written += 1;
  }
  return written;
}

type StoredConversationTask = {
  attempts: number;
  lastSuccessAt: Date | null;
  lastAttemptAt: Date;
  nextAttemptAt: Date;
  lastError: string | null;
};

// One thread's transition, applied atomically. Two passes can overlap (the
// scheduled pass and an operator run, or two scheduled invocations), and a
// transition that read the attempt count outside a transaction let the later
// write overwrite the earlier one, so one failure of a failing thread vanished
// and its backoff and its stuck report were both too optimistic. The row is
// locked for the whole read and write, so concurrent failures both count.
async function applyConversationTask(args: {
  officeId: string;
  orderId: string;
  entry: ConversationTaskRecord;
  now: Date;
}): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<StoredConversationTask[]>(Prisma.sql`
          SELECT "attempts", "lastSuccessAt", "lastAttemptAt", "nextAttemptAt", "lastError"
          FROM "ProcurementConversationTask"
          WHERE "officeId" = ${args.officeId}
            AND "orderId" = ${args.orderId}
            AND "vendorId" = ${args.entry.vendorId}
          FOR UPDATE
        `);
        const current = locked[0] ?? null;
        const next = nextConversationTaskState(current, args.entry, args.now);
        const values = {
          vendorName: args.entry.vendorName,
          stage: next.stage,
          action: next.action,
          attempts: next.attempts,
          nextAttemptAt: next.nextAttemptAt,
          lastAttemptAt: next.lastAttemptAt,
          lastError: next.lastError,
          lastSuccessAt: next.lastSuccessAt,
          settledAt: next.settledAt,
        };
        if (current) {
          await tx.procurementConversationTask.update({
            where: {
              officeId_orderId_vendorId: {
                officeId: args.officeId,
                orderId: args.orderId,
                vendorId: args.entry.vendorId,
              },
            },
            data: values,
          });
          return;
        }
        // Nothing to lock yet, so the unique key decides the race: the pass that
        // loses retries, finds the row and locks it.
        await tx.procurementConversationTask.create({
          data: {
            officeId: args.officeId,
            orderId: args.orderId,
            vendorId: args.entry.vendorId,
            ...values,
          },
        });
      });
      return;
    } catch (error: unknown) {
      const conflict = error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === "P2002";
      if (!conflict || attempt === 1) throw error;
    }
  }
}

// Suppliers of this request the request is no longer pursuing: closed,
// rejected, ordered elsewhere or removed from the request altogether. Their
// tasks are settled, so they leave the backlog and stop pulling their request
// into the due queue, while the row is kept as the record of what the loop did.
// A supplier put back into the funnel is written again by the next pass, which
// clears the settled mark, so closing is not a one way door.
export async function settleAbsentConversationTasks(args: {
  officeId: string;
  orderId: string;
  activeVendorIds: readonly string[];
  now?: Date;
}): Promise<number> {
  const now = args.now ?? new Date();
  const result = await prisma.procurementConversationTask.updateMany({
    where: {
      officeId: args.officeId,
      orderId: args.orderId,
      settledAt: null,
      ...(args.activeVendorIds.length
        ? { vendorId: { notIn: [...args.activeVendorIds] } }
        : {}),
    },
    data: { settledAt: now, nextAttemptAt: now, lastError: null },
  });
  return result.count;
}

// Conversations of this request that may not be worked yet, because they failed
// recently and are waiting out their own backoff. A pass reads these so it
// retries the thread that is due instead of hammering the one that is not: due
// work at the request level used to admit every supplier of the request.
export async function listBackingOffConversationVendorIds(args: {
  officeId: string;
  orderId: string;
  now?: Date;
}): Promise<string[]> {
  const now = args.now ?? new Date();
  const tasks = await prisma.procurementConversationTask.findMany({
    where: {
      officeId: args.officeId,
      orderId: args.orderId,
      settledAt: null,
      nextAttemptAt: { gt: now },
    },
    select: { vendorId: true },
  });
  return tasks.map((task) => task.vendorId);
}

export async function conversationTaskBacklog(args: {
  officeId: string;
  orderId: string;
  now?: Date;
}): Promise<ConversationTaskBacklog> {
  const now = args.now ?? new Date();
  const tasks = await prisma.procurementConversationTask.findMany({
    where: { officeId: args.officeId, orderId: args.orderId, settledAt: null },
    select: {
      vendorId: true,
      vendorName: true,
      attempts: true,
      lastError: true,
      nextAttemptAt: true,
      settledAt: true,
    },
    orderBy: [{ attempts: "desc" }, { nextAttemptAt: "asc" }],
  });
  const due = tasks.filter((task) => conversationTaskDue(task, now));
  return {
    owed: tasks.length,
    due: due.length,
    backingOff: tasks.length - due.length,
    stuck: tasks
      .filter((task) => task.attempts >= CONVERSATION_TASK_STUCK_ATTEMPTS)
      .slice(0, 20)
      .map((task) => ({
        vendorId: task.vendorId,
        vendorName: task.vendorName,
        attempts: task.attempts,
        error: task.lastError,
      })),
  };
}

// Requests with a conversation the loop owes an action right now, oldest owed
// first. A scheduled pass works these before the plain oldest first queue, so a
// request whose threads are behind is not starved by requests with nothing to
// do.
//
// The scheduled pass runs for every office, so it asks without an office and
// gets request ids only: no office scoped conversation detail leaves this
// function, and the caller intersects the answer with the queue it was already
// allowed to work, so a task can never pull in a request outside that queue. An
// office scoped caller passes its own office.
export async function listDueConversationTaskOrderIds(args?: {
  officeId?: string;
  limit?: number;
  now?: Date;
  // The requests a caller could actually work. A request that reached an order
  // or was cancelled leaves the eligible queue while its tasks stay unsettled,
  // and those rows are the oldest due ones, so limiting before the caller
  // discards them let closed requests fill the whole result and hide the live
  // requests that owe an action now.
  orderIds?: readonly string[];
}): Promise<string[]> {
  if (args?.orderIds && !args.orderIds.length) return [];
  const now = args?.now ?? new Date();
  const limit = Math.min(200, Math.max(1, Math.trunc(args?.limit ?? 50)));
  // Requests are grouped in the database and only then limited. Reading a
  // sample of task rows and deduplicating them here meant one request with more
  // old due tasks than the sample could fill it on its own and hide every other
  // request that was behind.
  const rows = await prisma.$queryRaw<Array<{ orderId: string }>>(Prisma.sql`
    SELECT "orderId" AS "orderId"
    FROM "ProcurementConversationTask"
    WHERE "settledAt" IS NULL
      AND "nextAttemptAt" <= ${now}
      ${args?.officeId ? Prisma.sql`AND "officeId" = ${args.officeId}` : Prisma.empty}
      ${args?.orderIds
        ? Prisma.sql`AND "orderId" IN (${Prisma.join(args.orderIds)})`
        : Prisma.empty}
    GROUP BY "orderId"
    ORDER BY MIN("nextAttemptAt") ASC, "orderId" ASC
    LIMIT ${limit}
  `);
  return rows.map((row) => row.orderId);
}
