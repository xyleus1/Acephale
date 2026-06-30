import { prisma } from "@/lib/prisma";

type TargetPriceSnapshot = {
  officeId: string;
  inquiryId?: string | null;
  jobId?: string | null;
  createdByUserId?: string | null;
  amount?: number | null;
  currency?: string | null;
  status?: string | null;
  source?: string | null;
  note?: string | null;
};

export function targetPriceChanged(
  before: { targetPrice?: number | null; targetCurrency?: string | null; targetPriceStatus?: string | null; targetPriceSource?: string | null },
  after: { targetPrice?: number | null; targetCurrency?: string | null; targetPriceStatus?: string | null; targetPriceSource?: string | null },
) {
  return (
    (before.targetPrice ?? null) !== (after.targetPrice ?? null) ||
    (before.targetCurrency ?? null) !== (after.targetCurrency ?? null) ||
    (before.targetPriceStatus ?? null) !== (after.targetPriceStatus ?? null) ||
    (before.targetPriceSource ?? null) !== (after.targetPriceSource ?? null)
  );
}

export async function recordTargetPriceHistory(input: TargetPriceSnapshot) {
  const status = input.amount != null && input.amount > 0
    ? "PROVIDED"
    : input.status || "UNKNOWN";

  if (status !== "PROVIDED" && status !== "NO_TARGET" && !input.source && !input.note) {
    return null;
  }

  return prisma.targetPriceHistory.create({
    data: {
      officeId: input.officeId,
      inquiryId: input.inquiryId ?? null,
      jobId: input.jobId ?? null,
      amount: input.amount ?? null,
      currency: input.currency ?? null,
      status,
      source: input.source ?? null,
      note: input.note ?? null,
      createdByUserId: input.createdByUserId ?? null,
    },
  });
}
