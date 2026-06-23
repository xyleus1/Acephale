"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { qualifyRfq } from "@/lib/rfq-qualification";
import { getReferenceDealById, referenceDealDecisionPlan, referenceDealToRfqDraft } from "@/lib/reference-deals";

export async function createRfqFromReferenceDeal(formData: FormData) {
  const session = await requireSession();
  const dealId = String(formData.get("dealId") ?? "").trim();
  const deal = getReferenceDealById(dealId);
  if (!deal) throw new Error("Control-sheet lead not found");
  const decision = referenceDealDecisionPlan(deal);
  if (!decision.canCreateRfq) {
    throw new Error(decision.stopRule);
  }

  const draft = referenceDealToRfqDraft(deal);
  const existing = await prisma.inquiry.findFirst({
    where: {
      officeId: session.officeId,
      parsedData: { contains: `"sourceKey":"${draft.sourceKey}"` },
    },
    select: { id: true },
  });
  if (existing) redirect(`/dashboard/rfq/${existing.id}`);

  const qualificationInput = {
    origin: draft.origin,
    destination: draft.destination,
    mode: draft.mode,
    commodity: draft.commodity,
    containerCount: draft.containerCount,
    containerType: draft.containerType,
    dimensions: null,
    stackable: draft.mode === "SEA-LCL" ? "UNKNOWN" : null,
    topLoad: draft.mode === "SEA-LCL" ? "UNKNOWN" : null,
    dangerousGoods: "UNKNOWN",
    customsBy: "UNKNOWN",
    weight: draft.weight,
    volume: null,
    targetPrice: null,
    targetPriceStatus: draft.targetPriceStatus,
  };
  const qualification = qualifyRfq(qualificationInput);

  const inquiry = await prisma.inquiry.create({
    data: {
      officeId: session.officeId,
      subject: draft.subject,
      fromCompany: draft.fromCompany,
      type: draft.type,
      origin: draft.origin,
      destination: draft.destination,
      mode: draft.mode,
      containerCount: draft.containerCount,
      containerType: draft.containerType,
      stackable: qualificationInput.stackable,
      topLoad: qualificationInput.topLoad,
      dangerousGoods: qualificationInput.dangerousGoods,
      customsBy: qualificationInput.customsBy,
      commodity: draft.commodity,
      weight: draft.weight,
      incoterms: draft.incoterms,
      targetPriceStatus: draft.targetPriceStatus,
      notes: draft.notes,
      rawEmailBody: draft.rawEmailBody,
      parsedData: JSON.stringify({
        source: "reference-deal",
        sourceKey: draft.sourceKey,
        referenceDealId: deal.id,
        sheet: {
          contact: deal.contact,
          type: deal.type,
          contract: deal.contract,
          status: deal.status,
          cadence: deal.cadence,
          contractValue: deal.contractValue,
          contractCurrency: deal.contractCurrency,
          profit: deal.profit,
          profitCurrency: deal.profitCurrency,
          quantity: deal.quantity,
          unit: deal.unit,
        },
        draft,
        qualification,
      }),
      status: qualification.isMature ? "PARSED" : "INGESTED",
      receivedAt: new Date(),
    },
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/rfq");
  redirect(`/dashboard/rfq/${inquiry.id}`);
}
