import type { SourcingRequestDraft } from "./sourcing-request-contract";

export type RestorableSourcingResearchInput = {
  componentName: string;
  manufacturer: string | null;
  mpn: string | null;
  specification: string | null;
  targetCountry: string | null;
  requestedQuantity?: number | null;
  requestedUnit?: string | null;
  sourceRegion?: string | null;
  deliveryLocation?: string | null;
  needByDate?: string | null;
};

export function sourcingDraftFromResearchInput(
  input: RestorableSourcingResearchInput,
): SourcingRequestDraft {
  return {
    productName: input.componentName,
    quantity: input.requestedQuantity ?? null,
    unit: input.requestedUnit ?? null,
    manufacturer: input.manufacturer,
    partNumber: input.mpn,
    specification: input.specification,
    sourceRegion: input.sourceRegion ?? null,
    deliveryLocation: input.deliveryLocation ?? input.targetCountry,
    needByDate: input.needByDate ?? null,
  };
}
