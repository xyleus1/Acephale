import "server-only";

import { EmailSenderReservationStatus, Prisma } from "@prisma/client";
import { SHARED_MAILBOX_POOL_FILTER, SHARED_SENDER_POOL_FILTER } from "@/lib/email-account-pool";
import { prisma } from "@/lib/prisma";
import {
  pinnedSenderUnavailableReason,
  rankEmailSenderPoolCandidates,
  selectEmailSenderPoolCandidate,
  utcDayBounds,
} from "@/lib/email-sender-pool-policy";

type SenderPoolDatabase = Pick<Prisma.TransactionClient, "emailMessage" | "emailSenderReservation">;

/**
 * The pool is shared across offices, so reservations serialize on one lock:
 * a per-office lock would let two offices hand out the same mailbox capacity.
 */
const SHARED_SENDER_POOL_LOCK = "email-sender-pool:shared";

/**
 * How many times a send pinned to one mailbox rechecks that mailbox before it
 * reports the mailbox unavailable. Rechecking absorbs a pause or resume landing
 * mid reservation, and the bound keeps a mailbox flipping state from holding
 * the shared pool lock.
 */
const PINNED_SENDER_STATE_READS = 3;

type SenderPoolAccount = {
  id: string;
  email: string;
  displayName: string | null;
  provider: string;
  dailySendLimit: number;
};

function cleanIdempotencyKey(value: string) {
  const key = typeof value === "string" ? value.trim() : "";
  if (!key || key.length > 180 || /[\r\n]/.test(key)) {
    throw new Error("A stable sender-pool idempotency key is required.");
  }
  return key;
}

function cleanRequestHash(value: string) {
  const hash = typeof value === "string" ? value.trim() : "";
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error("A SHA-256 sender-pool request hash is required.");
  }
  return hash;
}

async function senderPoolUsage(
  db: SenderPoolDatabase,
  accounts: SenderPoolAccount[],
  now: Date,
) {
  if (accounts.length === 0) return [];
  const { start, end } = utcDayBounds(now);
  const accountIds = accounts.map((account) => account.id);
  const [sentRows, reservedRows] = await Promise.all([
    db.emailMessage.groupBy({
      by: ["accountId"],
      where: {
        accountId: { in: accountIds },
        direction: "OUTBOUND",
        sentAt: { gte: start, lt: end },
      },
      _count: true,
    }),
    db.emailSenderReservation.groupBy({
      by: ["accountId"],
      where: {
        accountId: { in: accountIds },
        usageDate: start,
        status: EmailSenderReservationStatus.RESERVED,
      },
      _count: true,
    }),
  ]);
  const sentByAccount = new Map(sentRows.map((row) => [row.accountId, row._count]));
  const reservedByAccount = new Map(reservedRows.map((row) => [row.accountId, row._count]));
  return accounts.map((account) => ({
    ...account,
    sentToday: sentByAccount.get(account.id) ?? 0,
    reservedToday: reservedByAccount.get(account.id) ?? 0,
  }));
}

export async function listEmailSenderPoolAccounts(now = new Date()) {
  const accounts = await prisma.emailAccount.findMany({
    where: SHARED_SENDER_POOL_FILTER,
    select: {
      id: true,
      email: true,
      displayName: true,
      provider: true,
      dailySendLimit: true,
    },
  });
  return rankEmailSenderPoolCandidates(await senderPoolUsage(prisma, accounts, now));
}

type ReservedSender = {
  ok: true;
  reservationId: string;
  accountId: string;
  senderEmail: string;
  dailySendLimit: number;
  sentToday: number;
  reservedToday: number;
  completed: boolean;
  providerMessageId: string | null;
  providerThreadId: string | null;
  localThreadId: string | null;
  // When the delivery already happened, the time it was sent (or recorded),
  // so callers recovering a completed reservation keep the original timeline.
  sentAt: Date | null;
};

type SenderPoolFailure = {
  error: string;
  code:
    | "INVALID_REQUEST"
    | "IDEMPOTENCY_CONFLICT"
    | "POOL_EMPTY"
    // A connected mailbox is held out of sending (paused by sender protection,
    // sending turned off, disabled), which is resumable and so a different
    // problem from a pool with nothing connected.
    | "SENDER_UNAVAILABLE"
    | "POOL_EXHAUSTED"
    | "DELIVERY_UNCERTAIN";
};

async function reserveEmailSenderAttempt(args: {
  officeId: string;
  idempotencyKey: string;
  requestHash: string;
  accountId?: string;
  now: Date;
}): Promise<ReservedSender | SenderPoolFailure> {
  const { start } = utcDayBounds(args.now);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ locked: number }>>`
      SELECT 1::integer AS "locked"
      FROM pg_advisory_xact_lock(hashtextextended(${SHARED_SENDER_POOL_LOCK}, 0))
    `;

    const existing = await tx.emailSenderReservation.findUnique({
      where: {
        officeId_idempotencyKey: {
          officeId: args.officeId,
          idempotencyKey: args.idempotencyKey,
        },
      },
      include: {
        account: {
          select: {
            id: true,
            email: true,
            dailySendLimit: true,
            isActive: true,
            sendEnabled: true,
            provider: true,
            accessToken: true,
            refreshToken: true,
            credentialSecret: true,
          },
        },
        message: {
          select: {
            externalId: true,
            gmailMessageId: true,
            threadId: true,
            sentAt: true,
            thread: { select: { externalThreadId: true } },
          },
        },
      },
    });

    if (existing && existing.requestHash !== args.requestHash) {
      return {
        error: "This sender-pool idempotency key was already used for different email content.",
        code: "IDEMPOTENCY_CONFLICT",
      };
    }
    if (existing && args.accountId && existing.accountId !== args.accountId) {
      return {
        error: "This sender-pool idempotency key was already assigned to a different email account.",
        code: "IDEMPOTENCY_CONFLICT",
      };
    }

    if (existing?.message) {
      const providerMessageId = existing.providerMessageId ?? existing.message.gmailMessageId ?? existing.message.externalId;
      const providerThreadId = existing.providerThreadId ?? existing.message.thread.externalThreadId;
      const recorded = existing.status === EmailSenderReservationStatus.RECORDED
        ? existing
        : await tx.emailSenderReservation.update({
            where: { id: existing.id },
            data: {
              status: EmailSenderReservationStatus.RECORDED,
              providerMessageId,
              providerThreadId,
              localThreadId: existing.message.threadId,
            },
          });
      return {
        ok: true,
        reservationId: recorded.id,
        accountId: recorded.accountId,
        senderEmail: existing.account.email,
        dailySendLimit: existing.account.dailySendLimit,
        sentToday: 0,
        reservedToday: 0,
        completed: true,
        providerMessageId: recorded.providerMessageId,
        providerThreadId: recorded.providerThreadId,
        localThreadId: recorded.localThreadId,
        sentAt: existing.message.sentAt,
      };
    }

    if (existing?.status === EmailSenderReservationStatus.RECORDED) {
      return {
        ok: true,
        reservationId: existing.id,
        accountId: existing.accountId,
        senderEmail: existing.account.email,
        dailySendLimit: existing.account.dailySendLimit,
        sentToday: 0,
        reservedToday: 0,
        completed: true,
        providerMessageId: existing.providerMessageId,
        providerThreadId: existing.providerThreadId,
        localThreadId: existing.localThreadId,
        sentAt: existing.updatedAt,
      };
    }

    if (existing?.status === EmailSenderReservationStatus.RESERVED) {
      return {
        error: existing.usageDate.getTime() === start.getTime()
          ? "This pooled delivery is already in progress or its delivery outcome is unknown. Reconcile it before retrying."
          : "This pooled delivery has an unresolved reservation from an earlier day. Reconcile it before retrying.",
        code: "DELIVERY_UNCERTAIN",
      };
    }

    const senderPoolCandidates = () => tx.emailAccount.findMany({
      where: {
        ...SHARED_SENDER_POOL_FILTER,
        ...(args.accountId ? { id: args.accountId } : {}),
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        provider: true,
        dailySendLimit: true,
      },
    });
    const pinnedSenderState = (accountId: string) => tx.emailAccount.findUnique({
      where: { id: accountId },
      select: { isActive: true, sendEnabled: true, sendPausedAt: true, sendPausedReason: true },
    });
    let accounts = await senderPoolCandidates();
    if (accounts.length === 0 && args.accountId) {
      let pinned = await pinnedSenderState(args.accountId);
      // Sender protection can pause or resume the mailbox between these reads,
      // so a mailbox that reads as sendable is looked up again and sends rather
      // than being deferred on a stale reason. The attempts are bounded so a
      // mailbox flipping state cannot hold this transaction open.
      for (let attempt = 0; attempt < PINNED_SENDER_STATE_READS; attempt += 1) {
        if (!pinned || !pinned.isActive || !pinned.sendEnabled || pinned.sendPausedAt) break;
        accounts = await senderPoolCandidates();
        if (accounts.length > 0) break;
        pinned = await pinnedSenderState(args.accountId);
      }
      if (accounts.length === 0) {
        return { error: pinnedSenderUnavailableReason(pinned), code: "SENDER_UNAVAILABLE" };
      }
    }
    if (accounts.length === 0) {
      // A connected mailbox held out of the pool by sender protection is
      // resumable, so it must not read as a pool with nothing connected.
      const paused = await tx.emailAccount.count({
        where: {
          ...SHARED_MAILBOX_POOL_FILTER,
          AND: [{ OR: [{ sendPausedAt: { not: null } }, { sendEnabled: false }] }],
        },
      });
      if (paused > 0) {
        return {
          error: paused === 1
            ? "The only connected mailbox in the sender pool is paused or has sending turned off. Resume it or connect another mailbox."
            : `All ${paused} connected mailboxes in the sender pool are paused or have sending turned off. Resume one or connect another mailbox.`,
          code: "SENDER_UNAVAILABLE",
        };
      }
      return { error: "No connected email account is enabled in the sender pool.", code: "POOL_EMPTY" };
    }

    const usage = await senderPoolUsage(tx, accounts, args.now);
    const selected = selectEmailSenderPoolCandidate(usage);
    if (!selected) {
      return {
        error: args.accountId
          ? "The approved email account has reached its daily pooled-send limit. Save and approve a new draft with another sender."
          : "Every enabled email account has reached its daily pooled-send limit.",
        code: "POOL_EXHAUSTED",
      };
    }

    const reservation = existing
      ? await tx.emailSenderReservation.update({
          where: { id: existing.id },
          data: {
            accountId: selected.id,
            usageDate: start,
            status: EmailSenderReservationStatus.RESERVED,
            attemptCount: { increment: 1 },
            providerMessageId: null,
            providerThreadId: null,
            localThreadId: null,
          },
        })
      : await tx.emailSenderReservation.create({
          data: {
            officeId: args.officeId,
            accountId: selected.id,
            usageDate: start,
            idempotencyKey: args.idempotencyKey,
            requestHash: args.requestHash,
          },
        });
    return {
      ok: true,
      reservationId: reservation.id,
      accountId: selected.id,
      senderEmail: selected.email,
      dailySendLimit: selected.dailySendLimit,
      sentToday: selected.sentToday,
      reservedToday: selected.reservedToday + 1,
      completed: false,
      providerMessageId: null,
      providerThreadId: null,
      localThreadId: null,
      sentAt: null,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function reserveEmailSender(args: {
  officeId: string;
  idempotencyKey: string;
  requestHash: string;
  accountId?: string;
  now?: Date;
}): Promise<ReservedSender | SenderPoolFailure> {
  let idempotencyKey: string;
  let requestHash: string;
  try {
    idempotencyKey = cleanIdempotencyKey(args.idempotencyKey);
    requestHash = cleanRequestHash(args.requestHash);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "A stable sender-pool idempotency key is required.",
      code: "INVALID_REQUEST",
    };
  }
  const now = args.now ?? new Date();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await reserveEmailSenderAttempt({
        officeId: args.officeId,
        idempotencyKey,
        requestHash,
        accountId: args.accountId,
        now,
      });
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError
        && (error.code === "P2002" || error.code === "P2034");
      if (!retryable || attempt === 2) throw error;
    }
  }
  throw new Error("Sender-pool reservation failed.");
}

export async function releaseEmailSenderReservation(args: { officeId: string; reservationId: string }) {
  await prisma.emailSenderReservation.updateMany({
    where: {
      id: args.reservationId,
      officeId: args.officeId,
      status: EmailSenderReservationStatus.RESERVED,
    },
    data: { status: EmailSenderReservationStatus.RELEASED },
  });
}
