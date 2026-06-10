"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { createJobWithReference } from "@/lib/job-actions";
import Anthropic from "@anthropic-ai/sdk";

export async function convertToJob(inquiryId: string, formData: FormData) {
  const session = await requireSession();

  const inquiry = await prisma.inquiry.findFirst({
    where: { id: inquiryId, officeId: session.officeId },
  });
  if (!inquiry) throw new Error("Inquiry not found");

  const companyId = formData.get("companyId") ? String(formData.get("companyId")) : inquiry.companyId ?? undefined;

  const job = await createJobWithReference(session.officeId, (reference) => prisma.job.create({
    data: {
      officeId:   session.officeId,
      companyId:  companyId ?? null,
      inquiryId,
      reference,
      status:     "QUOTED",
      mode:       String(formData.get("mode") || inquiry.mode || ""),
      origin:     String(formData.get("origin") || inquiry.origin || ""),
      destination:String(formData.get("destination") || inquiry.destination || ""),
      commodity:  String(formData.get("commodity") || inquiry.commodity || ""),
      incoterms:  String(formData.get("incoterms") || inquiry.incoterms || ""),
      weight:     formData.get("weight") ? Number(formData.get("weight")) : inquiry.weight,
      volume:     formData.get("volume") ? Number(formData.get("volume")) : inquiry.volume,
      currency:   "USD",
      assignedToUserId: session.userId,
    },
  }));

  await prisma.inquiry.update({
    where: { id: inquiryId },
    data: { status: "QUOTED" },
  });

  revalidatePath("/dashboard/rfq");
  revalidatePath("/dashboard/jobs");
  redirect(`/dashboard/jobs/${job.id}`);
}

export async function updateInquiryField(inquiryId: string, formData: FormData) {
  const session = await requireSession();
  await prisma.inquiry.update({
    where: { id: inquiryId, officeId: session.officeId },
    data: {
      origin:      String(formData.get("origin") || ""),
      destination: String(formData.get("destination") || ""),
      mode:        String(formData.get("mode") || ""),
      commodity:   String(formData.get("commodity") || ""),
      incoterms:   String(formData.get("incoterms") || ""),
      containerType: String(formData.get("containerType") || ""),
      weight: formData.get("weight") ? Number(formData.get("weight")) : null,
      volume: formData.get("volume") ? Number(formData.get("volume")) : null,
      notes:  String(formData.get("notes") || ""),
    },
  });
  revalidatePath(`/dashboard/rfq/${inquiryId}`);
}

export async function updateInquiryStatus(inquiryId: string, status: string) {
  const session = await requireSession();
  await prisma.inquiry.update({
    where: { id: inquiryId, officeId: session.officeId },
    data: { status },
  });
  revalidatePath(`/dashboard/rfq/${inquiryId}`);
  revalidatePath("/dashboard/rfq");
}

export async function parseRFQWithAI(inquiryId: string): Promise<void> {
  const session = await requireSession();

  const inquiry = await prisma.inquiry.findFirst({
    where: { id: inquiryId, officeId: session.officeId },
  });
  if (!inquiry || !inquiry.rawEmailBody) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return;

  const client = new Anthropic({ apiKey });

  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 400,
    messages: [{
      role: "user",
      content: `Extract freight details from this email. Return ONLY valid JSON, no explanation.

Fields to extract (use null if not found):
- origin: string (city, country code)
- destination: string (city, country code)
- mode: one of SEA-FCL, SEA-LCL, AIR, ROAD, COURIER, or null
- containerType: one of 20GP, 40GP, 40HC, LCL, or null
- incoterms: standard incoterms code or null
- commodity: string or null
- weight: number in kg or null
- volume: number in cbm or null
- cargoReadyDate: ISO date string or null

Email:
${inquiry.rawEmailBody.slice(0, 2000)}`,
    }],
  });

  const text = msg.content[0].type === "text" ? msg.content[0].text : null;
  if (!text) return;

  let parsed: Record<string, unknown>;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch {
    return;
  }

  await prisma.inquiry.update({
    where: { id: inquiryId },
    data: {
      origin:        parsed.origin as string ?? inquiry.origin,
      destination:   parsed.destination as string ?? inquiry.destination,
      mode:          parsed.mode as string ?? inquiry.mode,
      containerType: parsed.containerType as string ?? inquiry.containerType,
      incoterms:     parsed.incoterms as string ?? inquiry.incoterms,
      commodity:     parsed.commodity as string ?? inquiry.commodity,
      weight:        parsed.weight != null ? Number(parsed.weight) : inquiry.weight,
      volume:        parsed.volume != null ? Number(parsed.volume) : inquiry.volume,
      cargoReadyDate: parsed.cargoReadyDate ? new Date(parsed.cargoReadyDate as string) : inquiry.cargoReadyDate,
      status: "PARSED",
      parsedData: JSON.stringify(parsed),
    },
  });

  revalidatePath(`/dashboard/rfq/${inquiryId}`);
  revalidatePath("/dashboard/rfq");
}
