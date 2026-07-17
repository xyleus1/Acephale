"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import {
  checkLoadIdea,
  coerceLoadIdea,
  type BenchCarrier,
  type LoadCheckResult,
  type LoadIdea,
} from "@/lib/load-check";
import { extractLoadIdea } from "@/lib/load-check-extract";
import { COMMODITY_CATEGORY_VALUES } from "@/lib/security-sop";
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

  const carriers = await prisma.carrier.findMany({
    where: { officeId: session.officeId, active: true, vettingStatus: "approved" },
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

  const bench: BenchCarrier[] = carriers.map((carrier) => ({
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

  const result = checkLoadIdea(fields, { carriers: bench, now: new Date() });
  return { fields, result, note };
}
