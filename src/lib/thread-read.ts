"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "./auth";
import { prisma } from "./prisma";

// Operator opened the conversation - clear its unread state. isRead exists on
// EmailMessage since the beginning but was never written; the inbox unread
// dot (and the WhatsApp chat view) now depend on it.
export async function markThreadReadAction(threadId: string): Promise<{ ok: true } | { error: string }> {
  const session = await requireSession();
  const thread = await prisma.emailThread.findFirst({
    where: { id: threadId, officeId: session.officeId },
    select: { id: true },
  });
  if (!thread) return { error: "Thread not found." };

  await prisma.emailMessage.updateMany({
    where: { threadId: thread.id, direction: "INBOUND", isRead: false },
    data: { isRead: true },
  });
  revalidatePath("/dashboard/inbox");
  return { ok: true };
}
