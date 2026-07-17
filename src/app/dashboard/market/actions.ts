"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { qualifyRfq } from "@/lib/rfq-qualification";
import { createWithFileReference } from "@/lib/references";
import {
  checkLoadIdea,
  coerceLoadIdea,
  formatPreflightReport,
  type BenchCarrier,
  type LoadCheckResult,
  type LoadIdea,
} from "@/lib/load-check";
import { extractLoadIdea } from "@/lib/load-check-extract";
import { commodityCategoryLabel, COMMODITY_CATEGORY_VALUES } from "@/lib/security-sop";
import { CARRIER_EQUIPMENT_TYPES } from "@/lib/carrier-vetting";

const EQUIPMENT_VALUES = CARRIER_EQUIPMENT_TYPES.map(([value]) => value);

export type LoadCheckActionResult =
  | { fields: LoadIdea; result: LoadCheckResult; note: string | null }
  | { error: string };

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

// Run a load idea through the pre-flight. Pass `text` for AI extraction of a
// free-text idea, or `idea` to re-run deterministically after manual edits.
export async function analyzeLoadIdeaAction(input: {
  text?: string;
  idea?: Partial<LoadIdea>;
}): Promise<LoadCheckActionResult> {
  const session = await requireSession();

  let fields: LoadIdea;
  let note: string | null = null;
  if (input.idea) {
    fields = coerceLoadIdea(input.idea, COMMODITY_CATEGORY_VALUES, EQUIPMENT_VALUES);
  } else {
    const text = input.text?.trim();
    if (!text) return { error: "Describe the load idea first." };
    const extracted = await extractLoadIdea(text);
    fields = extracted.idea;
    note = extracted.note;
  }

  const result = checkLoadIdea(fields, { carriers: await approvedBench(session.officeId), now: new Date() });
  return { fields, result, note };
}

async function approvedBench(officeId: string): Promise<BenchCarrier[]> {
  const carriers = await prisma.carrier.findMany({
    where: { officeId, active: true, vettingStatus: "approved" },
    select: {
      id: true,
      name: true,
      hazmatCertified: true,
      lithiumCapable: true,
      teamDrivers: true,
      airRide: true,
      reeferCapable: true,
      equipmentTypes: true,
      serviceStates: true,
      cargoLimit: true,
      cargoInsuranceExpiry: true,
    },
    take: 500,
  });
  return carriers.map((carrier) => ({
    id: carrier.id,
    name: carrier.name,
    hazmatCertified: carrier.hazmatCertified,
    lithiumCapable: carrier.lithiumCapable,
    teamDrivers: carrier.teamDrivers,
    airRide: carrier.airRide,
    reeferCapable: carrier.reeferCapable,
    equipmentTypes: stringArray(carrier.equipmentTypes),
    serviceStates: stringArray(carrier.serviceStates),
    cargoLimit: carrier.cargoLimit,
    cargoInsuranceExpiry: carrier.cargoInsuranceExpiry ? carrier.cargoInsuranceExpiry.toISOString() : null,
  }));
}

const LBS_TO_KG = 0.453592;

// Promote a checked load idea into a real RFQ: the pre-flight re-runs
// server-side (never trust the client's copy of the findings), the report
// lands in notes + the content panel, and the security-spine fields carry
// over so pricing and the load review start pre-filled.
export async function createRfqFromLoadIdeaAction(input: {
  idea: Partial<LoadIdea>;
}): Promise<{ inquiryId: string; reference: string | null } | { error: string }> {
  const session = await requireSession();
  const fields = coerceLoadIdea(input.idea, COMMODITY_CATEGORY_VALUES, EQUIPMENT_VALUES);
  if (!fields.origin && !fields.destination && !fields.description && !fields.commodityCategory) {
    return { error: "The idea needs at least a lane, commodity, or description before it becomes an RFQ." };
  }

  const result = checkLoadIdea(fields, { carriers: await approvedBench(session.officeId), now: new Date() });
  const { notes, report } = formatPreflightReport(fields, result);

  const isBattery = fields.commodityCategory === "batteries_un3480" || fields.commodityCategory === "batteries_un3481";
  const commodity = fields.commodityCategory ? commodityCategoryLabel(fields.commodityCategory) : null;
  const weightKg = fields.weightLbs != null ? Math.round(fields.weightLbs * LBS_TO_KG) : null;
  const subject =
    fields.description ??
    [commodity ?? "Load idea", fields.origin && fields.destination ? `${fields.origin} → ${fields.destination}` : null]
      .filter(Boolean)
      .join(" — ");

  const qualificationInput = {
    origin: fields.origin,
    destination: fields.destination,
    mode: "ROAD",
    commodity,
    containerCount: null,
    containerType: null,
    dimensions: null,
    stackable: null,
    topLoad: null,
    dangerousGoods: isBattery ? "YES" : "UNKNOWN",
    customsBy: "UNKNOWN",
    weight: weightKg,
    volume: null,
    targetPrice: null,
    targetPriceStatus: "UNKNOWN",
  };
  const qualification = qualifyRfq(qualificationInput);

  const inquiry = await createWithFileReference(session.officeId, (reference) =>
    prisma.inquiry.create({
      data: {
        officeId: session.officeId,
        reference,
        subject: subject.slice(0, 200),
        origin: fields.origin,
        destination: fields.destination,
        mode: "ROAD",
        commodity,
        weight: weightKg,
        dangerousGoods: qualificationInput.dangerousGoods,
        customsBy: qualificationInput.customsBy,
        targetPriceStatus: "UNKNOWN",
        cargoReadyDate: fields.pickupDate ? new Date(`${fields.pickupDate}T00:00:00Z`) : null,
        declaredValue: fields.declaredValue,
        declaredValueCurrency: fields.declaredValue != null ? "USD" : null,
        securityTier: result.securityTier,
        commodityCategory: fields.commodityCategory,
        equipmentType: fields.equipmentType,
        notes,
        rawEmailBody: report,
        parsedData: JSON.stringify({
          source: "load-preflight",
          preflight: {
            idea: fields,
            securityTier: result.securityTier,
            blockers: result.findings.filter((f) => f.severity === "blocker").length,
            risks: result.findings.filter((f) => f.severity === "risk").length,
            generatedAt: new Date().toISOString(),
          },
          qualification,
        }),
        status: qualification.isMature ? "PARSED" : "INGESTED",
        receivedAt: new Date(),
      },
      select: { id: true, reference: true },
    })
  );

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/rfq");
  return { inquiryId: inquiry.id, reference: inquiry.reference };
}
