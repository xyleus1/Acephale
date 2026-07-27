import {
  containsShipmentDutyConclusion,
  resolveCustomsRuleTemporalState,
  type ChinaCustomsDecisionGate,
  type ChinaCustomsDecisionGuide,
  type CustomsAuthorityReference,
  type CustomsAssessmentState,
} from "../research/china-customs-guide";
import {
  dedupeIntelSourceUses,
  type IntelSourceUse,
} from "../sources";

export const CHINA_HARDWARE_LOAD_SCHEMA_VERSION = 1 as const;

export type ChinaImportTriState = "yes" | "no" | "unknown";
export type ChinaImportReviewState = "unknown" | "in_progress" | "ready";
export type ChinaImportMode =
  | "ocean"
  | "air"
  | "road"
  | "rail"
  | "unknown";
export type ChinaImportFieldBasis =
  | "operator_confirmed"
  | "document"
  | "ai_extracted"
  | "supplier_statement"
  | "unknown";

export type ChinaImportAgencyFeature =
  | "rf_device"
  | "medical_device"
  | "radiation_emitting_product"
  | "cpsc_regulated_consumer_product"
  | "lithium_battery"
  | "other_hazardous_material"
  | "radioactive_or_nuclear_material"
  | "covered_engine"
  | "pesticidal_claims"
  | "doe_covered_product"
  | "refrigerant_equipment"
  | "solid_wood_packaging";

export const CHINA_IMPORT_AGENCY_FEATURES: ReadonlyArray<{
  id: ChinaImportAgencyFeature;
  agency: "FCC" | "FDA" | "CPSC" | "PHMSA" | "NRC" | "EPA" | "DOE" | "APHIS";
  label: string;
  question: string;
  authorityIds: string[];
}> = [
  {
    id: "rf_device",
    agency: "FCC",
    label: "Radio-frequency device",
    question: "Does the product intentionally or unintentionally emit radio-frequency energy?",
    authorityIds: [
      "fcc-rf-import-conditions",
      "fcc-presale-import-2022",
      "fcc-covered-equipment-2025",
      "fcc-covered-list",
    ],
  },
  {
    id: "medical_device",
    agency: "FDA",
    label: "Medical device or IVD",
    question: "Is the intended use medical, diagnostic, surgical, dental, veterinary, or in vitro diagnostic?",
    authorityIds: [
      "fda-device-imports",
      "fda-qmsr-regulation",
      "fda-qmsr-2026",
    ],
  },
  {
    id: "radiation_emitting_product",
    agency: "FDA",
    label: "Radiation-emitting product",
    question: "Does the product emit electronic radiation, including laser, X-ray, microwave, or ultraviolet energy?",
    authorityIds: [
      "fda-radiation-ace-regulation",
      "fda-radiation-imports",
    ],
  },
  {
    id: "cpsc_regulated_consumer_product",
    agency: "CPSC",
    label: "CPSC-regulated consumer product",
    question: "Is this a consumer product subject to a CPSC rule that requires certification?",
    authorityIds: [
      "cpsc-certificate-regulation",
      "cpsc-certificate-efiling",
    ],
  },
  {
    id: "lithium_battery",
    agency: "PHMSA",
    label: "Lithium cell or battery",
    question: "Does the shipment contain standalone batteries, batteries packed with equipment, or batteries in equipment?",
    authorityIds: ["phmsa-lithium-batteries"],
  },
  {
    id: "other_hazardous_material",
    agency: "PHMSA",
    label: "Other hazardous material",
    question: "Does the product contain a regulated gas, fuel, oil residue, aerosol, corrosive, chemical, or other hazardous material?",
    authorityIds: [
      "phmsa-hmr-general",
      "phmsa-hmr-communication",
      "phmsa-hmr-vessel",
      "phmsa-refrigerating-machine-interpretation",
    ],
  },
  {
    id: "radioactive_or_nuclear_material",
    agency: "NRC",
    label: "Radioactive or nuclear material",
    question: "Does the product contain a radioactive source, nuclear material, or equipment within NRC import authority?",
    authorityIds: [
      "nrc-part-110-imports",
      "nrc-import-license-guidance",
      "phmsa-hmr-general",
      "phmsa-hmr-communication",
      "phmsa-hmr-vessel",
    ],
  },
  {
    id: "covered_engine",
    agency: "EPA",
    label: "Engine or generator",
    question: "Is the product a vehicle, engine, generator, or equipment containing a covered engine?",
    authorityIds: ["epa-engine-imports"],
  },
  {
    id: "pesticidal_claims",
    agency: "EPA",
    label: "Pesticidal or antimicrobial claim",
    question: "Does the product claim to disinfect, sanitize, sterilize, repel, destroy, or mitigate a pest or pathogen?",
    authorityIds: [
      "epa-fifra-import-regulation",
      "epa-fifra-import-guidance",
    ],
  },
  {
    id: "doe_covered_product",
    agency: "DOE",
    label: "DOE-covered equipment",
    question: "Could the model be covered by a federal energy or water conservation standard?",
    authorityIds: ["doe-covered-products"],
  },
  {
    id: "refrigerant_equipment",
    agency: "EPA",
    label: "Refrigerant equipment",
    question: "Does the product contain refrigerant or is it designed for refrigeration, air conditioning, heat-pump, or chiller use?",
    authorityIds: [
      "epa-hfc-equipment-regulation",
      "epa-ods-equipment-regulation",
      "epa-hfc-reconsideration-2026",
    ],
  },
  {
    id: "solid_wood_packaging",
    agency: "APHIS",
    label: "Solid wood packaging",
    question: "Does the shipment use regulated solid wood pallets, crates, dunnage, or other wood packaging?",
    authorityIds: ["aphis-wood-packaging"],
  },
] as const;

export type ChinaImportFieldProvenance = {
  basis: ChinaImportFieldBasis;
  evidenceIds: string[];
};

export type ChinaHardwareLoadInputV1 = {
  schemaVersion: 1;
  shipmentReference: string | null;
  route: {
    mode: ChinaImportMode;
    countryOfExport: string | null;
    customsCountryOfOrigin: string | null;
    portOfLoading: string | null;
    portOfUnlading: string | null;
    finalDestination: string | null;
    containerType: string | null;
    grossWeightKg: number | null;
    incoterm: string | null;
  };
  timing: {
    entryEvent:
      | "entry_for_consumption"
      | "warehouse_withdrawal"
      | "unknown";
    actualEntryAt: string | null;
    expectedEntryAt: string | null;
    loadedOnVesselAtPortOfLoadingAt: string | null;
    finalModeTransitStartedAt: string | null;
  };
  product: {
    description: string | null;
    model: string | null;
    manufacturer: string | null;
    principalFunction: string | null;
    intendedUse: string | null;
    marketingClaims: string[];
    proposedHts10: string | null;
    classificationStatus:
      | "unknown"
      | "supplier_proposed"
      | "broker_reviewed"
      | "binding_ruling";
    tariffStackReviewStatus: ChinaImportReviewState;
  };
  origin: {
    manufacturingLocations: string[];
    transformationSummary: string | null;
    markingDescription: string | null;
    reviewStatus: ChinaImportReviewState;
  };
  valuation: {
    invoiceValue: number | null;
    currency: string | null;
    relatedParty: ChinaImportTriState;
    internationalFreightIncluded: ChinaImportTriState;
    insuranceIncluded: ChinaImportTriState;
    additionsReviewStatus: ChinaImportReviewState;
  };
  parties: {
    importerOfRecord: string | null;
    importerNumberAvailable: ChinaImportTriState;
    customsBroker: string | null;
    powerOfAttorneyReady: ChinaImportTriState;
    bondReady: ChinaImportTriState;
    seller: string | null;
    buyer: string | null;
    consignee: string | null;
    ultimateConsignee: string | null;
  };
  forcedLabor: {
    supplierIdentitiesComplete: ChinaImportTriState;
    subSupplierIdentitiesComplete: ChinaImportTriState;
    facilityAddressesComplete: ChinaImportTriState;
    billOfMaterialsTraceable: ChinaImportTriState;
    productionAndTransactionRecordsAvailable: ChinaImportTriState;
    uflpaEntityScreenCompleted: ChinaImportTriState;
  };
  oceanFiling: {
    isfFiler: string | null;
    isfFiledAt: string | null;
    containerStuffingLocation: string | null;
    consolidator: string | null;
    invoiceAvailable: ChinaImportTriState;
    packingListAvailable: ChinaImportTriState;
    billOfLadingAvailable: ChinaImportTriState;
  };
  agencyScreens: Record<ChinaImportAgencyFeature, ChinaImportTriState>;
  fieldProvenance: Record<string, ChinaImportFieldProvenance>;
};

const EMPTY_AGENCY_SCREENS: Record<
  ChinaImportAgencyFeature,
  ChinaImportTriState
> = {
  rf_device: "unknown",
  medical_device: "unknown",
  radiation_emitting_product: "unknown",
  cpsc_regulated_consumer_product: "unknown",
  lithium_battery: "unknown",
  other_hazardous_material: "unknown",
  radioactive_or_nuclear_material: "unknown",
  covered_engine: "unknown",
  pesticidal_claims: "unknown",
  doe_covered_product: "unknown",
  refrigerant_equipment: "unknown",
  solid_wood_packaging: "unknown",
};

export const EMPTY_CHINA_HARDWARE_LOAD_INPUT: ChinaHardwareLoadInputV1 = {
  schemaVersion: CHINA_HARDWARE_LOAD_SCHEMA_VERSION,
  shipmentReference: null,
  route: {
    mode: "ocean",
    countryOfExport: "China",
    customsCountryOfOrigin: null,
    portOfLoading: null,
    portOfUnlading: null,
    finalDestination: null,
    containerType: null,
    grossWeightKg: null,
    incoterm: null,
  },
  timing: {
    entryEvent: "unknown",
    actualEntryAt: null,
    expectedEntryAt: null,
    loadedOnVesselAtPortOfLoadingAt: null,
    finalModeTransitStartedAt: null,
  },
  product: {
    description: null,
    model: null,
    manufacturer: null,
    principalFunction: null,
    intendedUse: null,
    marketingClaims: [],
    proposedHts10: null,
    classificationStatus: "unknown",
    tariffStackReviewStatus: "unknown",
  },
  origin: {
    manufacturingLocations: [],
    transformationSummary: null,
    markingDescription: null,
    reviewStatus: "unknown",
  },
  valuation: {
    invoiceValue: null,
    currency: null,
    relatedParty: "unknown",
    internationalFreightIncluded: "unknown",
    insuranceIncluded: "unknown",
    additionsReviewStatus: "unknown",
  },
  parties: {
    importerOfRecord: null,
    importerNumberAvailable: "unknown",
    customsBroker: null,
    powerOfAttorneyReady: "unknown",
    bondReady: "unknown",
    seller: null,
    buyer: null,
    consignee: null,
    ultimateConsignee: null,
  },
  forcedLabor: {
    supplierIdentitiesComplete: "unknown",
    subSupplierIdentitiesComplete: "unknown",
    facilityAddressesComplete: "unknown",
    billOfMaterialsTraceable: "unknown",
    productionAndTransactionRecordsAvailable: "unknown",
    uflpaEntityScreenCompleted: "unknown",
  },
  oceanFiling: {
    isfFiler: null,
    isfFiledAt: null,
    containerStuffingLocation: null,
    consolidator: null,
    invoiceAvailable: "unknown",
    packingListAvailable: "unknown",
    billOfLadingAvailable: "unknown",
  },
  agencyScreens: { ...EMPTY_AGENCY_SCREENS },
  fieldProvenance: {},
};

export type ChinaImportTemporalAction = {
  ruleId: string;
  title: string;
  temporalStateAtEntry:
    | "active"
    | "upcoming"
    | "expired"
    | "historical"
    | "indeterminate";
  applicability:
    | "potentially_applicable"
    | "not_in_effect_at_entry"
    | "exception_facts_incomplete"
    | "authority_review_required";
  effectiveDate: string;
  effectiveToDate: string | null;
  exactStartAt: string | null;
  exactEndAt: string | null;
  requiredFacts: string[];
  missingFacts: string[];
  action: string;
  authorityIds: string[];
  sources: IntelSourceUse[];
};

export type ChinaImportGateAssessment = {
  gateId: ChinaCustomsDecisionGate["id"];
  sequence: number;
  title: string;
  stage: ChinaCustomsDecisionGate["stage"];
  state: CustomsAssessmentState | "action_required";
  missingFieldPaths: string[];
  unconfirmedFieldPaths: string[];
  issues: string[];
  quoteEffects: ChinaCustomsDecisionGate["quoteEffects"];
  action: string;
  authorityIds: string[];
  sources: IntelSourceUse[];
};

export type ChinaImportAgencyScreen = {
  featureId: ChinaImportAgencyFeature;
  agency: (typeof CHINA_IMPORT_AGENCY_FEATURES)[number]["agency"];
  label: string;
  question: string;
  state:
    | "triggered"
    | "unresolved"
    | "not_indicated_by_confirmed_facts";
  basis: ChinaImportFieldBasis;
  requiredEvidence: string[];
  action: string;
  authorityIds: string[];
  sources: IntelSourceUse[];
};

export type ChinaImportAuthorityClaimContext = {
  kind: "customs_gate" | "agency_screen" | "temporal_action";
  id: string;
  label: string;
};

export type ChinaImportReferencedAuthority = {
  authorityId: string;
  label: string;
  kind: CustomsAuthorityReference["kind"];
  status: CustomsAuthorityReference["status"];
  effectiveFrom: string | null;
  effectiveTo: string | null;
  caveat: string;
  source: IntelSourceUse;
  claimContexts: ChinaImportAuthorityClaimContext[];
};

export type ChinaHardwareLoadAssessmentV1 = {
  schemaVersion: 1;
  assessedAt: string;
  rulesSnapshot: {
    rulesReviewedAt: string;
    rulesAsOfAt: string;
    freshness:
      | "current_for_assessment"
      | "boundary_crossed_since_review"
      | "manual_refresh_required";
    nextRevalidationAt: string | null;
  };
  scope: {
    supported: boolean;
    reasons: string[];
  };
  executiveDecision: {
    state:
      | "insufficient_input"
      | "operator_action_required"
      | "confirmed_operational_blocker";
    summary: string;
  };
  readiness: {
    freightQuote:
      | "conditional_quote_possible"
      | "blocked"
      | "insufficient_input";
    landedCost: "not_assessable" | "authority_review_required";
    clearanceCommitment: "not_assessable" | "authority_review_required";
  };
  inputReview: {
    confirmedFieldPaths: string[];
    extractedFieldPaths: string[];
    unconfirmedFieldPaths: string[];
    missingCriticalFieldPaths: string[];
    boundaryAmbiguities: string[];
  };
  timeSensitiveActions: ChinaImportTemporalAction[];
  customsGates: ChinaImportGateAssessment[];
  agencyScreens: ChinaImportAgencyScreen[];
  nextQuestions: string[];
  authorities: ChinaImportReferencedAuthority[];
  sources: IntelSourceUse[];
  limitations: string[];
};

type FieldRequirement = {
  path: string;
  ready?: (value: unknown, input: ChinaHardwareLoadInputV1) => boolean;
};

const EXACT_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 2000)
    : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[$,\s]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function hts10Value(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const compact = raw.replace(/[.\s-]/g, "");
  return /^\d{10}$/.test(compact) ? compact : raw;
}

function timestamp(value: unknown): string | null {
  const normalized = text(value);
  if (!normalized) return null;
  if (DATE_ONLY.test(normalized)) return normalized;
  if (!EXACT_TIMESTAMP.test(normalized)) return null;
  return Number.isNaN(Date.parse(normalized)) ? null : normalized;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => text(item))
    .filter((item): item is string => item != null)
    .slice(0, 50);
}

function triState(value: unknown): ChinaImportTriState {
  return value === "yes" || value === "no" ? value : "unknown";
}

function reviewState(value: unknown): ChinaImportReviewState {
  return value === "in_progress" || value === "ready" ? value : "unknown";
}

function importMode(value: unknown): ChinaImportMode {
  if (value == null || value === "") return "ocean";
  return value === "ocean" ||
    value === "air" ||
    value === "road" ||
    value === "rail"
    ? value
    : "unknown";
}

function fieldBasis(value: unknown): ChinaImportFieldBasis {
  return value === "operator_confirmed" ||
    value === "document" ||
    value === "ai_extracted" ||
    value === "supplier_statement"
    ? value
    : "unknown";
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function coerceChinaHardwareLoadInput(
  raw: unknown
): ChinaHardwareLoadInputV1 {
  const root = objectValue(raw);
  const route = objectValue(root.route);
  const timing = objectValue(root.timing);
  const product = objectValue(root.product);
  const origin = objectValue(root.origin);
  const valuation = objectValue(root.valuation);
  const parties = objectValue(root.parties);
  const forcedLabor = objectValue(root.forcedLabor);
  const oceanFiling = objectValue(root.oceanFiling);
  const agencyScreens = objectValue(root.agencyScreens);
  const rawProvenance = objectValue(root.fieldProvenance);
  const provenance = Object.fromEntries(
    Object.entries(rawProvenance)
      .filter(([path]) => path.length > 0 && path.length <= 160)
      .slice(0, 250)
      .map(([path, value]) => {
        const item = objectValue(value);
        return [
          path,
          {
            basis: fieldBasis(item.basis),
            evidenceIds: stringList(item.evidenceIds).slice(0, 20),
          },
        ];
      })
  );

  const result: ChinaHardwareLoadInputV1 = {
    schemaVersion: CHINA_HARDWARE_LOAD_SCHEMA_VERSION,
    shipmentReference: text(root.shipmentReference),
    route: {
      mode: importMode(route.mode),
      countryOfExport: text(route.countryOfExport),
      customsCountryOfOrigin: text(route.customsCountryOfOrigin),
      portOfLoading: text(route.portOfLoading),
      portOfUnlading: text(route.portOfUnlading),
      finalDestination: text(route.finalDestination),
      containerType: text(route.containerType),
      grossWeightKg: numberValue(route.grossWeightKg),
      incoterm: text(route.incoterm),
    },
    timing: {
      entryEvent:
        timing.entryEvent === "entry_for_consumption" ||
        timing.entryEvent === "warehouse_withdrawal"
          ? timing.entryEvent
          : "unknown",
      actualEntryAt: timestamp(timing.actualEntryAt),
      expectedEntryAt: timestamp(timing.expectedEntryAt),
      loadedOnVesselAtPortOfLoadingAt: timestamp(
        timing.loadedOnVesselAtPortOfLoadingAt
      ),
      finalModeTransitStartedAt: timestamp(timing.finalModeTransitStartedAt),
    },
    product: {
      description: text(product.description),
      model: text(product.model),
      manufacturer: text(product.manufacturer),
      principalFunction: text(product.principalFunction),
      intendedUse: text(product.intendedUse),
      marketingClaims: stringList(product.marketingClaims),
      proposedHts10: hts10Value(product.proposedHts10),
      classificationStatus:
        product.classificationStatus === "supplier_proposed" ||
        product.classificationStatus === "broker_reviewed" ||
        product.classificationStatus === "binding_ruling"
          ? product.classificationStatus
          : "unknown",
      tariffStackReviewStatus: reviewState(
        product.tariffStackReviewStatus
      ),
    },
    origin: {
      manufacturingLocations: stringList(origin.manufacturingLocations),
      transformationSummary: text(origin.transformationSummary),
      markingDescription: text(origin.markingDescription),
      reviewStatus: reviewState(origin.reviewStatus),
    },
    valuation: {
      invoiceValue: numberValue(valuation.invoiceValue),
      currency: text(valuation.currency),
      relatedParty: triState(valuation.relatedParty),
      internationalFreightIncluded: triState(
        valuation.internationalFreightIncluded
      ),
      insuranceIncluded: triState(valuation.insuranceIncluded),
      additionsReviewStatus: reviewState(
        valuation.additionsReviewStatus
      ),
    },
    parties: {
      importerOfRecord: text(parties.importerOfRecord),
      importerNumberAvailable: triState(
        parties.importerNumberAvailable
      ),
      customsBroker: text(parties.customsBroker),
      powerOfAttorneyReady: triState(parties.powerOfAttorneyReady),
      bondReady: triState(parties.bondReady),
      seller: text(parties.seller),
      buyer: text(parties.buyer),
      consignee: text(parties.consignee),
      ultimateConsignee: text(parties.ultimateConsignee),
    },
    forcedLabor: {
      supplierIdentitiesComplete: triState(
        forcedLabor.supplierIdentitiesComplete
      ),
      subSupplierIdentitiesComplete: triState(
        forcedLabor.subSupplierIdentitiesComplete
      ),
      facilityAddressesComplete: triState(
        forcedLabor.facilityAddressesComplete
      ),
      billOfMaterialsTraceable: triState(
        forcedLabor.billOfMaterialsTraceable
      ),
      productionAndTransactionRecordsAvailable: triState(
        forcedLabor.productionAndTransactionRecordsAvailable
      ),
      uflpaEntityScreenCompleted: triState(
        forcedLabor.uflpaEntityScreenCompleted
      ),
    },
    oceanFiling: {
      isfFiler: text(oceanFiling.isfFiler),
      isfFiledAt: timestamp(oceanFiling.isfFiledAt),
      containerStuffingLocation: text(
        oceanFiling.containerStuffingLocation
      ),
      consolidator: text(oceanFiling.consolidator),
      invoiceAvailable: triState(oceanFiling.invoiceAvailable),
      packingListAvailable: triState(oceanFiling.packingListAvailable),
      billOfLadingAvailable: triState(
        oceanFiling.billOfLadingAvailable
      ),
    },
    agencyScreens: Object.fromEntries(
      CHINA_IMPORT_AGENCY_FEATURES.map((feature) => [
        feature.id,
        triState(agencyScreens[feature.id]),
      ])
    ) as Record<ChinaImportAgencyFeature, ChinaImportTriState>,
    fieldProvenance: provenance,
  };
  for (const path of Object.keys(result.fieldProvenance)) {
    if (!hasValue(getPath(result, path))) {
      delete result.fieldProvenance[path];
    }
  }
  return result;
}

function getPath(input: ChinaHardwareLoadInputV1, path: string): unknown {
  if (path === "timing.entryAt") {
    return input.timing.actualEntryAt ?? input.timing.expectedEntryAt;
  }
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, input);
}

function basisFor(
  input: ChinaHardwareLoadInputV1,
  path: string
): ChinaImportFieldBasis {
  if (path === "timing.entryAt") {
    const sourcePath = input.timing.actualEntryAt
      ? "timing.actualEntryAt"
      : "timing.expectedEntryAt";
    return input.fieldProvenance[sourcePath]?.basis ?? "unknown";
  }
  return input.fieldProvenance[path]?.basis ?? "unknown";
}

function isConfirmedBasis(basis: ChinaImportFieldBasis): boolean {
  return basis === "operator_confirmed" || basis === "document";
}

function hasValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") {
    return value.trim().length > 0 && value !== "unknown";
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function requirementState(
  input: ChinaHardwareLoadInputV1,
  requirement: FieldRequirement
): "missing" | "unconfirmed" | "ready" {
  const value = getPath(input, requirement.path);
  if (!hasValue(value) || (requirement.ready && !requirement.ready(value, input))) {
    return "missing";
  }
  return isConfirmedBasis(basisFor(input, requirement.path))
    ? "ready"
    : "unconfirmed";
}

function authoritySources(
  guide: ChinaCustomsDecisionGuide,
  authorityIds: readonly string[]
): IntelSourceUse[] {
  const requested = new Set(authorityIds);
  return dedupeIntelSourceUses(
    guide.authorities
      .filter((authority) => requested.has(authority.id))
      .map((authority) => authority.source)
  );
}

function referencedAuthorities(
  guide: ChinaCustomsDecisionGuide,
  customsGates: readonly ChinaImportGateAssessment[],
  agencyScreens: readonly ChinaImportAgencyScreen[],
  timeSensitiveActions: readonly ChinaImportTemporalAction[]
): ChinaImportReferencedAuthority[] {
  const references = [
    ...customsGates.map((gate) => ({
      authorityIds: gate.authorityIds,
      claimContext: {
        kind: "customs_gate" as const,
        id: gate.gateId,
        label: `Gate ${String(gate.sequence).padStart(2, "0")}: ${gate.title}`,
      },
    })),
    ...agencyScreens.map((screen) => ({
      authorityIds: screen.authorityIds,
      claimContext: {
        kind: "agency_screen" as const,
        id: screen.featureId,
        label: `${screen.agency}: ${screen.label}`,
      },
    })),
    ...timeSensitiveActions.map((action) => ({
      authorityIds: action.authorityIds,
      claimContext: {
        kind: "temporal_action" as const,
        id: action.ruleId,
        label: `Timing: ${action.title}`,
      },
    })),
  ];
  const referencedIds = new Set(
    references.flatMap((reference) => reference.authorityIds)
  );

  return guide.authorities
    .filter((authority) => referencedIds.has(authority.id))
    .map((authority) => ({
      authorityId: authority.id,
      label: authority.label,
      kind: authority.kind,
      status: authority.status,
      effectiveFrom: authority.effectiveFrom,
      effectiveTo: authority.effectiveTo,
      caveat: authority.caveat,
      source: { ...authority.source },
      claimContexts: references
        .filter((reference) =>
          reference.authorityIds.includes(authority.id)
        )
        .map((reference) => ({ ...reference.claimContext })),
    }));
}

function exactEntryAt(input: ChinaHardwareLoadInputV1): string | null {
  if (
    input.timing.entryEvent === "unknown" ||
    !isConfirmedBasis(basisFor(input, "timing.entryEvent"))
  ) {
    return null;
  }
  const value = input.timing.actualEntryAt ?? input.timing.expectedEntryAt;
  return value && EXACT_TIMESTAMP.test(value) ? value : null;
}

function isStrictChina(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase().replace(/[.'’]/g, "");
  return new Set([
    "china",
    "cn",
    "prc",
    "peoples republic of china",
    "china peoples republic of",
  ]).has(normalized);
}

function buildGateRequirements(
  gateId: ChinaCustomsDecisionGate["id"]
): FieldRequirement[] {
  const confirmedYes = (value: unknown) => value === "yes";
  switch (gateId) {
    case "classification":
      return [
        { path: "product.description" },
        { path: "product.model" },
        { path: "product.principalFunction" },
        {
          path: "product.proposedHts10",
          ready: (value) =>
            typeof value === "string" && /^\d{10}$/.test(value),
        },
        {
          path: "product.classificationStatus",
          ready: (value) =>
            value === "broker_reviewed" || value === "binding_ruling",
        },
      ];
    case "origin_marking":
      return [
        { path: "route.customsCountryOfOrigin" },
        { path: "origin.manufacturingLocations" },
        { path: "origin.transformationSummary" },
        { path: "origin.markingDescription" },
        {
          path: "origin.reviewStatus",
          ready: (value) => value === "ready",
        },
      ];
    case "valuation":
      return [
        { path: "valuation.invoiceValue" },
        { path: "valuation.currency" },
        { path: "route.incoterm" },
        {
          path: "valuation.relatedParty",
          ready: (value) => value === "yes" || value === "no",
        },
        {
          path: "valuation.internationalFreightIncluded",
          ready: (value) => value === "yes" || value === "no",
        },
        {
          path: "valuation.insuranceIncluded",
          ready: (value) => value === "yes" || value === "no",
        },
        {
          path: "valuation.additionsReviewStatus",
          ready: (value) => value === "ready",
        },
      ];
    case "tariff_stack":
      return [
        {
          path: "product.proposedHts10",
          ready: (value) =>
            typeof value === "string" && /^\d{10}$/.test(value),
        },
        { path: "route.customsCountryOfOrigin" },
        {
          path: "timing.entryAt",
          ready: (_value, input) => exactEntryAt(input) != null,
        },
        {
          path: "product.tariffStackReviewStatus",
          ready: (value) => value === "ready",
        },
      ];
    case "product_admissibility":
      return CHINA_IMPORT_AGENCY_FEATURES.map((feature) => ({
        path: `agencyScreens.${feature.id}`,
        ready: (value) => value === "yes" || value === "no",
      }));
    case "forced_labor":
      return [
        {
          path: "forcedLabor.supplierIdentitiesComplete",
          ready: confirmedYes,
        },
        {
          path: "forcedLabor.subSupplierIdentitiesComplete",
          ready: confirmedYes,
        },
        {
          path: "forcedLabor.facilityAddressesComplete",
          ready: confirmedYes,
        },
        {
          path: "forcedLabor.billOfMaterialsTraceable",
          ready: confirmedYes,
        },
        {
          path: "forcedLabor.productionAndTransactionRecordsAvailable",
          ready: confirmedYes,
        },
        {
          path: "forcedLabor.uflpaEntityScreenCompleted",
          ready: confirmedYes,
        },
      ];
    case "importer_entry":
      return [
        { path: "parties.importerOfRecord" },
        {
          path: "parties.importerNumberAvailable",
          ready: confirmedYes,
        },
        { path: "parties.customsBroker" },
        { path: "parties.powerOfAttorneyReady", ready: confirmedYes },
        { path: "parties.bondReady", ready: confirmedYes },
        { path: "parties.seller" },
        { path: "parties.buyer" },
        { path: "parties.consignee" },
        { path: "parties.ultimateConsignee" },
      ];
    case "ocean_filing":
      return [
        { path: "oceanFiling.isfFiler" },
        {
          path: "timing.loadedOnVesselAtPortOfLoadingAt",
          ready: (value) =>
            typeof value === "string" && EXACT_TIMESTAMP.test(value),
        },
        {
          path: "oceanFiling.isfFiledAt",
          ready: (value, input) => {
            if (
              typeof value !== "string" ||
              !EXACT_TIMESTAMP.test(value)
            ) {
              return false;
            }
            const loadedAt =
              input.timing.loadedOnVesselAtPortOfLoadingAt;
            if (!loadedAt || !EXACT_TIMESTAMP.test(loadedAt)) {
              return false;
            }
            return (
              Date.parse(value) <=
              Date.parse(loadedAt) - 24 * 60 * 60 * 1000
            );
          },
        },
        { path: "oceanFiling.containerStuffingLocation" },
        { path: "oceanFiling.consolidator" },
        { path: "oceanFiling.invoiceAvailable", ready: confirmedYes },
        { path: "oceanFiling.packingListAvailable", ready: confirmedYes },
        {
          path: "oceanFiling.billOfLadingAvailable",
          ready: confirmedYes,
        },
      ];
  }
}

function assessGate(
  input: ChinaHardwareLoadInputV1,
  guide: ChinaCustomsDecisionGuide,
  gate: ChinaCustomsDecisionGate
): ChinaImportGateAssessment {
  const requirements = buildGateRequirements(gate.id);
  const states = requirements.map((requirement) => ({
    path: requirement.path,
    state: requirementState(input, requirement),
  }));
  let missingFieldPaths = states
    .filter((item) => item.state === "missing")
    .map((item) => item.path);
  const unconfirmedFieldPaths = states
    .filter((item) => item.state === "unconfirmed")
    .map((item) => item.path);
  const issues: string[] = [];
  if (gate.id === "ocean_filing") {
    const filedAt = input.oceanFiling.isfFiledAt;
    const loadedAt =
      input.timing.loadedOnVesselAtPortOfLoadingAt;
    if (
      filedAt &&
      loadedAt &&
      EXACT_TIMESTAMP.test(filedAt) &&
      EXACT_TIMESTAMP.test(loadedAt) &&
      Date.parse(filedAt) >
        Date.parse(loadedAt) - 24 * 60 * 60 * 1000
    ) {
      issues.push(
        "The supplied ISF filing time is less than 24 hours before foreign-port loading. Treat the filing as late or timing-defective until the filer resolves it."
      );
      missingFieldPaths = missingFieldPaths.filter(
        (path) => path !== "oceanFiling.isfFiledAt"
      );
    }
  }
  let state: ChinaImportGateAssessment["state"] =
    missingFieldPaths.length > 0 || unconfirmedFieldPaths.length > 0
      ? "missing_input"
      : "reference_ready";
  if (gate.id === "tariff_stack" && state === "reference_ready") {
    state = "authority_review_required";
  }
  if (gate.id === "product_admissibility") {
    const hasTriggeredFeature = CHINA_IMPORT_AGENCY_FEATURES.some(
      (feature) =>
        input.agencyScreens[feature.id] === "yes" &&
        isConfirmedBasis(
          basisFor(input, `agencyScreens.${feature.id}`)
        )
    );
    if (hasTriggeredFeature || state === "missing_input") {
      state = "conditional_screen";
    }
  }
  if (
    gate.id === "forced_labor" &&
    isStrictChina(input.route.customsCountryOfOrigin) &&
    state !== "reference_ready"
  ) {
    state = "action_required";
  }
  if (issues.length > 0) {
    state = "action_required";
  }
  return {
    gateId: gate.id,
    sequence: gate.sequence,
    title: gate.title,
    stage: gate.stage,
    state,
    missingFieldPaths,
    unconfirmedFieldPaths,
    issues,
    quoteEffects: [...gate.quoteEffects],
    action: gate.operatorAction,
    authorityIds: [...gate.authorityIds],
    sources: authoritySources(guide, gate.authorityIds),
  };
}

function productTriggerEvidence(
  guide: ChinaCustomsDecisionGuide,
  feature: ChinaImportAgencyFeature
): string[] {
  const gate = guide.gates.find(
    (candidate) => candidate.id === "product_admissibility"
  );
  if (!gate) return [];
  const featureIndex = CHINA_IMPORT_AGENCY_FEATURES.findIndex(
    (candidate) => candidate.id === feature
  );
  return gate.categoryTriggers[featureIndex]?.requiredEvidence ?? [];
}

function assessAgencyScreens(
  input: ChinaHardwareLoadInputV1,
  guide: ChinaCustomsDecisionGuide
): ChinaImportAgencyScreen[] {
  return CHINA_IMPORT_AGENCY_FEATURES.map((feature) => {
    const path = `agencyScreens.${feature.id}`;
    const value = input.agencyScreens[feature.id];
    const basis = basisFor(input, path);
    const confirmed = isConfirmedBasis(basis);
    const state: ChinaImportAgencyScreen["state"] =
      confirmed && value === "yes"
        ? "triggered"
        : confirmed && value === "no"
          ? "not_indicated_by_confirmed_facts"
          : "unresolved";
    return {
      featureId: feature.id,
      agency: feature.agency,
      label: feature.label,
      question: feature.question,
      state,
      basis,
      requiredEvidence:
        state === "triggered"
          ? [...productTriggerEvidence(guide, feature.id)]
          : [],
      action:
        state === "triggered"
          ? `Collect the model-level evidence for the ${feature.label.toLowerCase()} screen and have the importer or broker confirm the filing path.`
          : state === "unresolved"
            ? `Confirm yes or no from the product specification and intended-use facts. An omitted or unconfirmed answer remains unresolved.`
            : "No trigger is indicated by the confirmed facts. Reopen this screen if the product, intended use, or marketing claims change.",
      authorityIds: [...feature.authorityIds],
      sources: authoritySources(guide, feature.authorityIds),
    };
  });
}

function temporalStateAtEntry(
  change: ChinaCustomsDecisionGuide["ruleChanges"][number],
  entryAt: string | null
): ChinaImportTemporalAction["temporalStateAtEntry"] {
  if (!entryAt || !EXACT_TIMESTAMP.test(entryAt)) return "indeterminate";
  return resolveCustomsRuleTemporalState(change, entryAt);
}

function temporalActionCopy(
  change: ChinaCustomsDecisionGuide["ruleChanges"][number],
  temporalState: ChinaImportTemporalAction["temporalStateAtEntry"]
): string {
  if (temporalState === "indeterminate") {
    return "Add a timezone-qualified entry or withdrawal timestamp, then re-run the rule timing.";
  }
  if (change.id === "ustr-forced-labor-301-effective") {
    if (temporalState === "active") {
      return "The action is in effect at the supplied entry time. Resolve the exact HTS, product exemptions, customs origin, and current HTS instructions. Treat the in-transit pathway as unresolved until every timed condition is documented.";
    }
    return "The action is not yet in effect at the supplied entry time. Preserve the exact entry timing and recheck the current HTS before filing.";
  }
  if (change.id === "section-122-surcharge-2026") {
    if (temporalState === "expired") {
      return "The temporary action is outside its published window at the supplied entry time. Confirm that no amendment or replacement changed that result.";
    }
    return "The temporary action is within its published window at the supplied entry time. Resolve the current HTS provision, product exemptions, and Section 232 interaction.";
  }
  if (temporalState === "expired") {
    return "The published window ended before the supplied entry time. Confirm that no extension or replacement action changed the result.";
  }
  if (temporalState === "upcoming") {
    return "The action begins after the supplied entry time. Preserve the timing and recheck if the entry plan changes.";
  }
  if (temporalState === "active") {
    return "The rule change is in effect at the supplied entry time. Resolve the current model-level facts and authority-specific requirements before filing.";
  }
  return "Treat this as historical context only and verify the authority currently in force for the supplied entry time.";
}

function assessTemporalActions(
  input: ChinaHardwareLoadInputV1,
  guide: ChinaCustomsDecisionGuide
): ChinaImportTemporalAction[] {
  const entryAt = exactEntryAt(input);
  const originConfirmed =
    isStrictChina(input.route.customsCountryOfOrigin) &&
    isConfirmedBasis(
      basisFor(input, "route.customsCountryOfOrigin")
    );
  return guide.ruleChanges
    .filter((change) => change.operatorAlertPriority != null)
    .sort(
      (left, right) =>
        (left.operatorAlertPriority ?? 99) -
        (right.operatorAlertPriority ?? 99)
    )
    .map((change) => {
      const temporalState = temporalStateAtEntry(change, entryAt);
      const requiredFacts: string[] = [];
      const missingFacts: string[] = [];
      let applicability: ChinaImportTemporalAction["applicability"] =
        temporalState === "active"
          ? "authority_review_required"
          : temporalState === "indeterminate"
            ? "authority_review_required"
            : "not_in_effect_at_entry";

      if (change.id === "ustr-forced-labor-301-effective") {
        requiredFacts.push(
          "Confirmed China customs origin",
          "Exact 10-digit HTS and exemption match",
          "Timezone-qualified entry or withdrawal time"
        );
        if (!originConfirmed) missingFacts.push("Confirmed China customs origin");
        if (
          !/^\d{10}$/.test(input.product.proposedHts10 ?? "") ||
          !isConfirmedBasis(
            basisFor(input, "product.proposedHts10")
          )
        ) {
          missingFacts.push("Confirmed 10-digit HTS and exemption review");
        }
        if (!entryAt) {
          missingFacts.push(
            "Timezone-qualified entry or warehouse-withdrawal time"
          );
        }
        if (temporalState === "active" && originConfirmed) {
          applicability = "potentially_applicable";
          const startAt = change.effectiveAt
            ? Date.parse(change.effectiveAt)
            : null;
          const exceptionEnd = Date.parse("2026-07-28T00:01:00-04:00");
          const entryMs =
            entryAt == null ? Number.NaN : Date.parse(entryAt);
          const loadedAt = input.timing.loadedOnVesselAtPortOfLoadingAt;
          const finalTransitAt = input.timing.finalModeTransitStartedAt;
          const hasExactExceptionFacts =
            loadedAt != null &&
            finalTransitAt != null &&
            EXACT_TIMESTAMP.test(loadedAt) &&
            EXACT_TIMESTAMP.test(finalTransitAt) &&
            entryAt != null;
          const exceptionCouldMatter =
            startAt != null &&
            hasExactExceptionFacts &&
            Date.parse(loadedAt) < startAt &&
            Date.parse(finalTransitAt) < startAt &&
            entryMs < exceptionEnd;
          const withinExceptionEntryWindow =
            entryMs < exceptionEnd;
          if (withinExceptionEntryWindow && !hasExactExceptionFacts) {
            applicability = "exception_facts_incomplete";
            missingFacts.push(
              "Vessel loading time at port of loading",
              "Final-mode transit start time"
            );
          } else if (exceptionCouldMatter) {
            applicability = "authority_review_required";
          }
        }
      } else if (
        change.id === "section-122-surcharge-2026" &&
        temporalState === "active"
      ) {
        applicability = "potentially_applicable";
        requiredFacts.push(
          "Exact entry time",
          "10-digit HTS",
          "Product exemption and Section 232 interaction"
        );
      } else if (
        change.id === "section-301-exclusions-2026" &&
        temporalState === "active"
      ) {
        applicability = "authority_review_required";
        requiredFacts.push(
          "Exact 10-digit HTS",
          "Word-for-word product description match"
        );
      } else if (
        change.id === "epa-hfc-reconsideration-effective" &&
        temporalState === "active"
      ) {
        const refrigerantState =
          input.agencyScreens.refrigerant_equipment;
        applicability =
          refrigerantState === "yes"
            ? "potentially_applicable"
            : "authority_review_required";
        requiredFacts.push(
          "Exact equipment type and model",
          "Refrigerant identity and charge",
          "Manufacturing and import dates"
        );
      }

      return {
        ruleId: change.id,
        title: change.title,
        temporalStateAtEntry: temporalState,
        applicability,
        effectiveDate: change.effectiveDate,
        effectiveToDate: change.effectiveTo,
        exactStartAt: change.effectiveAt,
        exactEndAt: change.effectiveToAt,
        requiredFacts,
        missingFacts: [...new Set(missingFacts)],
        action: temporalActionCopy(change, temporalState),
        authorityIds: [...change.authorityIds],
        sources: authoritySources(guide, change.authorityIds),
      };
    });
}

function rulesFreshness(
  guide: ChinaCustomsDecisionGuide,
  assessedAt: string
): ChinaHardwareLoadAssessmentV1["rulesSnapshot"] {
  const assessedMs = Date.parse(assessedAt);
  const reviewedMs = Date.parse(guide.rulesAsOfAt);
  if (Number.isNaN(assessedMs) || Number.isNaN(reviewedMs)) {
    throw new Error("China customs freshness requires valid review timestamps");
  }
  const assessedDate = new Date(assessedMs).toISOString().slice(0, 10);
  const boundaries = guide.ruleChanges
    .flatMap((change) => {
      const start = change.effectiveAt
        ? {
            value: change.effectiveAt,
            exactMs: Date.parse(change.effectiveAt),
            date: change.effectiveDate,
          }
        : {
            value: change.effectiveDate,
            exactMs: null,
            date: change.effectiveDate,
          };
      const end = change.effectiveToAt
        ? {
            value: change.effectiveToAt,
            exactMs: Date.parse(change.effectiveToAt),
            date: change.effectiveTo ?? change.effectiveDate,
          }
        : change.effectiveTo
          ? {
              value: change.effectiveTo,
              exactMs: null,
              date: change.effectiveTo,
            }
          : null;
      return end ? [start, end] : [start];
    })
    .filter(
      (boundary) =>
        boundary.exactMs == null || !Number.isNaN(boundary.exactMs)
    )
    .sort((left, right) => {
      const leftSort =
        left.exactMs ?? Date.parse(`${left.date}T00:00:00.000Z`);
      const rightSort =
        right.exactMs ?? Date.parse(`${right.date}T00:00:00.000Z`);
      return leftSort - rightSort;
    });
  const crossedBoundary = boundaries.some(
    (boundary) =>
      boundary.exactMs == null
        ? boundary.date > guide.rulesAsOf &&
          boundary.date <= assessedDate
        : boundary.exactMs > reviewedMs &&
          boundary.exactMs <= assessedMs
  );
  const nextBoundary =
    boundaries.find((boundary) =>
      boundary.exactMs == null
        ? boundary.date > assessedDate
        : boundary.exactMs > assessedMs
    )?.value ?? null;
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const freshness =
    crossedBoundary
      ? "boundary_crossed_since_review"
      : assessedMs - reviewedMs > sevenDays
        ? "manual_refresh_required"
        : "current_for_assessment";
  return {
    rulesReviewedAt: guide.rulesReviewedAt,
    rulesAsOfAt: guide.rulesAsOfAt,
    freshness,
    nextRevalidationAt: nextBoundary,
  };
}

const QUESTION_FIELD_LABELS: Record<string, string> = {
  "product.description": "commercial product description",
  "product.model": "model number",
  "product.principalFunction": "principal function",
  "product.proposedHts10": "proposed 10-digit HTS",
  "route.customsCountryOfOrigin": "customs country of origin",
  "route.portOfLoading": "port of loading",
  "route.portOfUnlading": "U.S. port of unlading",
  "route.finalDestination": "final destination",
  "route.containerType": "container type",
  "route.grossWeightKg": "gross weight",
  "route.incoterm": "Incoterm",
  "timing.entryEvent": "entry event",
  "timing.entryAt": "entry or withdrawal timestamp",
  "valuation.invoiceValue": "commercial invoice value",
  "valuation.currency": "invoice currency",
  "parties.importerOfRecord": "importer of record",
  "parties.customsBroker": "customs broker",
};

function questionFieldLabel(path: string): string {
  return QUESTION_FIELD_LABELS[path] ?? path;
}

function buildNextQuestions(
  input: ChinaHardwareLoadInputV1,
  inputReview: ChinaHardwareLoadAssessmentV1["inputReview"],
  agencyScreens: ChinaImportAgencyScreen[],
  timeSensitiveActions: ChinaImportTemporalAction[],
  customsGates: ChinaImportGateAssessment[]
): string[] {
  const questions: string[] = [];
  if (inputReview.unconfirmedFieldPaths.length > 0) {
    questions.push(
      `Mert: Review and explicitly confirm the extracted values for ${inputReview.unconfirmedFieldPaths
        .map(questionFieldLabel)
        .join(", ")}.`
    );
  }

  for (const action of timeSensitiveActions) {
    if (action.missingFacts.length === 0) continue;
    questions.push(
      `Broker/importer: For ${action.title}, confirm ${action.missingFacts.join(", ")}.`
    );
  }

  const missingBrokerFacts = inputReview.missingCriticalFieldPaths.filter(
    (path) =>
      path === "product.proposedHts10" ||
      path.startsWith("timing.") ||
      path.startsWith("parties.")
  );
  if (missingBrokerFacts.length > 0) {
    questions.push(
      `Broker/importer: Provide ${missingBrokerFacts
        .map(questionFieldLabel)
        .join(", ")}.`
    );
  }

  const forcedLaborGate = customsGates.find(
    (gate) => gate.gateId === "forced_labor"
  );
  if (forcedLaborGate?.state !== "reference_ready") {
    questions.push(
      "Supplier: Provide the complete supplier, sub-supplier, facility, bill-of-materials, production, and transaction record chain for UFLPA review."
    );
  }

  const oceanFilingGate = customsGates.find(
    (gate) => gate.gateId === "ocean_filing"
  );
  if (
    input.route.mode === "ocean" &&
    oceanFilingGate?.state !== "reference_ready"
  ) {
    questions.push(
      "Broker/importer: Name the ISF filer and owners for the 10 importer elements. Confirm which data must be filed before lading and who will supply the stuffing location and consolidator by the applicable later deadline."
    );
  }

  for (const screen of agencyScreens.filter(
    (candidate) => candidate.state === "triggered"
  )) {
    questions.push(
      `Supplier: For the ${screen.agency} ${screen.label.toLowerCase()} screen, provide ${screen.requiredEvidence.join(", ")}.`
    );
  }
  for (const screen of agencyScreens.filter(
    (candidate) => candidate.state === "unresolved"
  )) {
    questions.push(
      `Supplier: ${screen.question} This controls the ${screen.agency} ${screen.label.toLowerCase()} screen.`
    );
  }

  const missingSupplierFacts = inputReview.missingCriticalFieldPaths.filter(
    (path) => !missingBrokerFacts.includes(path)
  );
  if (missingSupplierFacts.length > 0) {
    questions.push(
      `Supplier: Provide ${missingSupplierFacts
        .map(questionFieldLabel)
        .join(", ")}.`
    );
  }

  return [...new Set(questions)].slice(0, 24);
}

function criticalInputReview(input: ChinaHardwareLoadInputV1) {
  const paths = [
    "product.description",
    "product.model",
    "product.principalFunction",
    "product.proposedHts10",
    "route.customsCountryOfOrigin",
    "route.portOfLoading",
    "route.portOfUnlading",
    "route.finalDestination",
    "route.containerType",
    "route.grossWeightKg",
    "route.incoterm",
    "timing.entryEvent",
    "timing.entryAt",
    "valuation.invoiceValue",
    "valuation.currency",
    "parties.importerOfRecord",
    "parties.customsBroker",
  ];
  const missingCriticalFieldPaths: string[] = [];
  const unconfirmedFieldPaths: string[] = [];
  for (const path of paths) {
    const value = getPath(input, path);
    if (!hasValue(value)) {
      missingCriticalFieldPaths.push(path);
    } else if (!isConfirmedBasis(basisFor(input, path))) {
      unconfirmedFieldPaths.push(path);
    }
  }
  const confirmedFieldPaths = Object.entries(input.fieldProvenance)
    .filter(
      ([path, provenance]) =>
        isConfirmedBasis(provenance.basis) &&
        hasValue(getPath(input, path))
    )
    .map(([path]) => path)
    .sort();
  const extractedFieldPaths = Object.entries(input.fieldProvenance)
    .filter(
      ([path, provenance]) =>
        provenance.basis === "ai_extracted" &&
        hasValue(getPath(input, path))
    )
    .map(([path]) => path)
    .sort();
  const entryValue =
    input.timing.actualEntryAt ?? input.timing.expectedEntryAt;
  const boundaryAmbiguities =
    entryValue && DATE_ONLY.test(entryValue)
      ? [
          "Entry timing has a date but no time zone. Exact tariff cutoffs cannot be evaluated from a date alone.",
        ]
      : [];
  return {
    confirmedFieldPaths,
    extractedFieldPaths,
    unconfirmedFieldPaths: [...new Set(unconfirmedFieldPaths)].sort(),
    missingCriticalFieldPaths,
    boundaryAmbiguities,
  };
}

const UNSAFE_CONCLUSION =
  /\b(?:go(?:\s+with\s+actions)?|nothing breaks|compliant|cleared|admissible|approved for import|clearance guaranteed)\b/i;

export function containsUnsafeChinaLoadConclusion(value: string): boolean {
  return UNSAFE_CONCLUSION.test(value) ||
    containsShipmentDutyConclusion(value);
}

function validateAssessment(
  assessment: ChinaHardwareLoadAssessmentV1
): ChinaHardwareLoadAssessmentV1 {
  const operationalCopy = [
    assessment.executiveDecision.summary,
    ...assessment.customsGates.map((gate) => gate.action),
    ...assessment.agencyScreens.map((screen) => screen.action),
    ...assessment.timeSensitiveActions.map((action) => action.action),
    ...assessment.nextQuestions,
    ...assessment.limitations,
  ].join("\n");
  if (containsUnsafeChinaLoadConclusion(operationalCopy)) {
    throw new Error(
      "China load assessment contains an unsafe shipment conclusion"
    );
  }
  for (const gate of assessment.customsGates) {
    if (gate.authorityIds.length === 0 || gate.sources.length === 0) {
      throw new Error(`China load gate ${gate.gateId} lacks authority`);
    }
  }
  for (const screen of assessment.agencyScreens) {
    if (screen.authorityIds.length === 0 || screen.sources.length === 0) {
      throw new Error(
        `China load agency screen ${screen.featureId} lacks authority`
      );
    }
  }
  const referencedAuthorityIds = new Set([
    ...assessment.customsGates.flatMap((gate) => gate.authorityIds),
    ...assessment.agencyScreens.flatMap((screen) => screen.authorityIds),
    ...assessment.timeSensitiveActions.flatMap(
      (action) => action.authorityIds
    ),
  ]);
  const assessmentAuthorityIds = new Set(
    assessment.authorities.map((authority) => authority.authorityId)
  );
  if (
    assessmentAuthorityIds.size !== assessment.authorities.length ||
    assessmentAuthorityIds.size !== referencedAuthorityIds.size ||
    [...referencedAuthorityIds].some(
      (authorityId) => !assessmentAuthorityIds.has(authorityId)
    )
  ) {
    throw new Error(
      "China load authority context must match the referenced authority IDs"
    );
  }
  for (const authority of assessment.authorities) {
    if (
      authority.claimContexts.length === 0 ||
      !authority.source.sourceId ||
      !authority.source.sourceUrl
    ) {
      throw new Error(
        `China load authority ${authority.authorityId} lacks source or claim context`
      );
    }
  }
  return assessment;
}

export function assessChinaUsHardwareShipment(
  rawInput: unknown,
  guide: ChinaCustomsDecisionGuide,
  assessmentAt: Date
): ChinaHardwareLoadAssessmentV1 {
  const input = coerceChinaHardwareLoadInput(rawInput);
  const assessedAt = assessmentAt.toISOString();
  const inputReview = criticalInputReview(input);
  const customsGates = guide.gates
    .map((gate) => assessGate(input, guide, gate))
    .sort((left, right) => left.sequence - right.sequence);
  const agencyScreens = assessAgencyScreens(input, guide);
  const timeSensitiveActions = assessTemporalActions(input, guide);
  const scopeReasons: string[] = [];
  if (input.route.mode !== "ocean") {
    scopeReasons.push("This V1 assessment supports ocean imports only.");
  }
  if (
    !isStrictChina(input.route.customsCountryOfOrigin) ||
    !isConfirmedBasis(
      basisFor(input, "route.customsCountryOfOrigin")
    )
  ) {
    scopeReasons.push(
      "Confirmed China customs origin is required. Country of export or supplier location is not enough."
    );
  }
  if (!input.product.description) {
    scopeReasons.push("A product description is required.");
  }
  const supported = scopeReasons.length === 0;
  const hasConfirmedDamagedBattery =
    input.agencyScreens.lithium_battery === "yes" &&
    isConfirmedBasis(
      basisFor(input, "agencyScreens.lithium_battery")
    ) &&
    isConfirmedBasis(basisFor(input, "product.marketingClaims")) &&
    input.product.marketingClaims.some((claim) =>
      /\b(?:damaged|defective|recalled)\b/i.test(claim)
    );
  const needsInput =
    inputReview.missingCriticalFieldPaths.length > 0 ||
    inputReview.unconfirmedFieldPaths.length > 0 ||
    agencyScreens.some((screen) => screen.state === "unresolved");
  const executiveState =
    hasConfirmedDamagedBattery
      ? "confirmed_operational_blocker"
      : needsInput || !supported
        ? "insufficient_input"
        : "operator_action_required";
  const summary =
    executiveState === "confirmed_operational_blocker"
      ? "Operator action required: a confirmed product or transport fact blocks normal processing until a specialist resolves it."
      : !supported
        ? "Outside supported scope: resolve the scope reasons before using this China ocean workflow."
      : executiveState === "insufficient_input"
        ? "Operator action required: confirm the missing shipment facts before requesting landed cost or a clearance commitment."
        : "Operator action required: the packet is structured for importer and broker review, but tariff and agency treatment still require current authority checks.";
  const freightCorePaths = [
    "route.portOfLoading",
    "route.portOfUnlading",
    "route.finalDestination",
    "route.containerType",
    "route.grossWeightKg",
    "product.description",
  ];
  const freightCoreReady = freightCorePaths.every((path) => {
    const value = getPath(input, path);
    return hasValue(value) &&
      isConfirmedBasis(basisFor(input, path));
  });
  const nextQuestions = buildNextQuestions(
    input,
    inputReview,
    agencyScreens,
    timeSensitiveActions,
    customsGates
  );
  const authorities = referencedAuthorities(
    guide,
    customsGates,
    agencyScreens,
    timeSensitiveActions
  );
  const sources = dedupeIntelSourceUses(
    authorities.map((authority) => authority.source)
  );

  return validateAssessment({
    schemaVersion: CHINA_HARDWARE_LOAD_SCHEMA_VERSION,
    assessedAt,
    rulesSnapshot: rulesFreshness(guide, assessedAt),
    scope: {
      supported,
      reasons: scopeReasons,
    },
    executiveDecision: {
      state: executiveState,
      summary,
    },
    readiness: {
      freightQuote: hasConfirmedDamagedBattery
        ? "blocked"
        : freightCoreReady
          ? "conditional_quote_possible"
          : "insufficient_input",
      landedCost:
        customsGates.find((gate) => gate.gateId === "tariff_stack")
          ?.state === "authority_review_required"
          ? "authority_review_required"
          : "not_assessable",
      clearanceCommitment:
        customsGates.every(
          (gate) =>
            gate.state === "reference_ready" ||
            gate.state === "authority_review_required"
        )
          ? "authority_review_required"
          : "not_assessable",
    },
    inputReview,
    timeSensitiveActions,
    customsGates,
    agencyScreens,
    nextQuestions,
    authorities,
    sources,
    limitations: [
      ...guide.limitations,
      "AI-extracted and locally parsed source-text values are drafts until the operator confirms them or links them to a document.",
      "A negative product screen is accepted only from an operator-confirmed or document-backed field.",
      "Ready for broker review does not mean duty calculated, agency requirements satisfied, or clearance promised.",
    ],
  });
}
