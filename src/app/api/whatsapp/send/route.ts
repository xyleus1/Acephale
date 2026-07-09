import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logOutboundWhatsAppMessage, sendWhatsAppText } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await requireSession();
  // Approval gate (F5/EXT): this endpoint transmits to WhatsApp immediately with
  // no draft/preview/recipient-allowlist. Disabled by default so an outbound
  // message can never be sent without an explicit operational opt-in.
  if (process.env.WHATSAPP_SEND_ENABLED !== "true") {
    return NextResponse.json({ error: "WhatsApp send is disabled." }, { status: 403 });
  }
  const input = await req.json().catch(() => null) as {
    to?: string;
    body?: string;
    threadId?: string;
  } | null;

  const to = input?.to?.trim() ?? "";
  const body = input?.body?.trim() ?? "";
  if (!to || !body) {
    return NextResponse.json({ error: "Both `to` and `body` are required." }, { status: 400 });
  }

  const sent = await sendWhatsAppText({ to, body });
  if ("error" in sent) {
    return NextResponse.json(sent, { status: 400 });
  }

  let logged: { threadId: string };
  try {
    logged = await logOutboundWhatsAppMessage({
      officeId: session.officeId,
      to,
      body,
      providerMessageId: sent.providerMessageId,
      threadId: input?.threadId ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to store the outbound message." },
      { status: 400 },
    );
  }

  const thread = await prisma.emailThread.findFirst({
    where: { id: logged.threadId, officeId: session.officeId },
    select: { inquiryId: true, jobId: true },
  });

  revalidatePath("/dashboard/inbox");
  revalidatePath("/dashboard/settings/email");
  if (thread?.inquiryId) revalidatePath(`/dashboard/rfq/${thread.inquiryId}`);
  if (thread?.jobId) revalidatePath(`/dashboard/jobs/${thread.jobId}`);

  return NextResponse.json({ ok: true, threadId: logged.threadId, providerMessageId: sent.providerMessageId });
}
