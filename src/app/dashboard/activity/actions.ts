"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";

export async function completeTaskAction(taskId: string) {
  const s = await requireSession();
  const task = await prisma.task.findFirst({
    where: { id: taskId, officeId: s.officeId },
  });
  if (!task) return;
  await prisma.task.updateMany({
    where: { id: taskId, officeId: s.officeId },
    data: { status: "DONE" },
  });
  revalidatePath("/dashboard/activity");
}

export async function resolveQuoteAction(quoteId: string, result: "WON" | "LOST") {
  const s = await requireSession();
  const quote = await prisma.quote.findFirst({
    where: { id: quoteId, officeId: s.officeId },
  });
  if (!quote) return;
  await prisma.quote.updateMany({
    where: { id: quoteId, officeId: s.officeId },
    data: { result },
  });
  await prisma.event.create({
    data: {
      officeId: s.officeId,
      type: `quote.${result.toLowerCase()}`,
      entityType: "quote",
      entityId: quoteId,
      payload: { result, companyId: quote.companyId },
    },
  });
  revalidatePath("/dashboard/activity");
}

export async function updateCompanyStatusAction(companyId: string, status: string) {
  const s = await requireSession();
  const company = await prisma.company.findFirst({
    where: { id: companyId, officeId: s.officeId },
  });
  if (!company) return;
  await prisma.company.updateMany({
    where: { id: companyId, officeId: s.officeId },
    data: { status: status as never },
  });
  revalidatePath("/dashboard/crm");
}
