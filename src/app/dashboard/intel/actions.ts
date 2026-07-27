"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import {
  DERYA_AI_IDENTITY_REPLY,
  isDeryaModelIdentityQuestion,
} from "@/lib/gpt56-client";
import { qualifyRfq } from "@/lib/rfq-qualification";
import { createWithFileReference } from "@/lib/references";
import {
  COMMODITY_CATEGORY_VALUES,
  INTEL_EQUIPMENT_TYPES,
  assessChinaUsHardwareShipment,
  buildChinaUsCustomsDecisionGuide,
  checkLoadIdea,
  coerceChinaHardwareLoadInput,
  commodityCategoryLabel,
  coerceLoadIdea,
  dedupeIntelSourceUses,
  formatPreflightReport,
  hasOperationalLoadFacts,
  isLoadIdeaDecisionable,
  type BenchCarrier,
  type ChinaHardwareLoadAssessmentV1,
  type ChinaHardwareLoadInputV1,
  type LoadCheckResult,
  type LoadIdea,
} from "@/lib/intel";
import {
  enrichLoadCheck,
  extractChinaHardwareLoad,
  extractLoadIdea,
} from "@/lib/intel/server";

const EQUIPMENT_VALUES = INTEL_EQUIPMENT_TYPES.map(([value]) => value);

export type LoadCheckActionResult =
  | { fields: LoadIdea; result: LoadCheckResult; note: string | null }
  | { message: string }
  | { error: string };

export type ChinaImportLoadActionResult =
  | {
      fields: ChinaHardwareLoadInputV1;
      assessment: ChinaHardwareLoadAssessmentV1;
      note: string | null;
    }
  | { error: string };

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export async function analyzeChinaImportShipmentAction(input: {
  text?: string;
  shipment?: unknown;
}): Promise<ChinaImportLoadActionResult> {
  await requireSession();
  try {
    let fields: ChinaHardwareLoadInputV1;
    let note: string | null = null;
    if (input.shipment) {
      fields = coerceChinaHardwareLoadInput(input.shipment);
    } else {
      const sourceText = input.text?.trim();
      if (!sourceText) {
        return { error: "Paste a shipment brief or start a blank review." };
      }
      const extracted = await extractChinaHardwareLoad(sourceText);
      fields = extracted.input;
      note = extracted.note;
    }
    const assessment = assessChinaUsHardwareShipment(
      fields,
      buildChinaUsCustomsDecisionGuide(),
      new Date()
    );
    return { fields, assessment, note };
  } catch {
    return {
      error:
        "The shipment report could not be built. No shipment data was saved.",
    };
  }
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
    if (!hasOperationalLoadFacts(fields)) {
      if (isDeryaModelIdentityQuestion(text)) {
        return {
          message:
            `${DERYA_AI_IDENTITY_REPLY} This field checks U.S. trucking loads, so enter a lane and cargo details here.`,
        };
      }
      return {
        error:
          "This field checks a U.S. trucking load. Enter operational facts such as origin, destination, and cargo details.",
      };
    }
  }

  const now = new Date();
  const bench = await approvedBench(session.officeId);
  const result = checkLoadIdea(fields, { carriers: bench, now });
  result.facts = await enrichLoadCheck(fields, result, result.carrierMatch.matched, now);
  result.sources = dedupeIntelSourceUses([...result.sources, ...result.facts.flatMap((fact) => fact.sources)]);
  return {
    fields,
    result,
    note: isLoadIdeaDecisionable(fields)
      ? note
      : "Add origin, destination, and cargo details before treating this as a decision-ready pre-flight.",
  };
}

async function approvedBench(officeId: string): Promise<BenchCarrier[]> {
  let carriers;
  try {
    carriers = await prisma.carrier.findMany({
      where: { officeId, active: true, vettingStatus: "approved" },
      select: {
        id: true,
        name: true,
        dotNumber: true,
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
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2021" || error.code === "P2022")
    ) {
      return [];
    }
    throw error;
  }
  return carriers.map((carrier) => ({
    id: carrier.id,
    name: carrier.name,
    dotNumber: carrier.dotNumber,
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
  if (!isLoadIdeaDecisionable(fields)) {
    return {
      error:
        "Add origin, destination, and cargo details before creating an RFQ.",
    };
  }

  const now = new Date();
  const bench = await approvedBench(session.officeId);
  const result = checkLoadIdea(fields, { carriers: bench, now });
  result.facts = await enrichLoadCheck(fields, result, result.carrierMatch.matched, now);
  result.sources = dedupeIntelSourceUses([...result.sources, ...result.facts.flatMap((fact) => fact.sources)]);
  const { notes, report } = formatPreflightReport(fields, result);

  const isBattery = fields.commodityCategory === "batteries_un3480" || fields.commodityCategory === "batteries_un3481";
  const commodity = fields.commodityCategory ? commodityCategoryLabel(fields.commodityCategory) : null;
  const weightKg = fields.weightLbs != null ? Math.round(fields.weightLbs * LBS_TO_KG) : null;
  const subject =
    fields.description ??
    [commodity ?? "Load idea", fields.origin && fields.destination ? `${fields.origin} → ${fields.destination}` : null]
      .filter(Boolean)
      .join(" - ");

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
            sources: result.sources,
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
