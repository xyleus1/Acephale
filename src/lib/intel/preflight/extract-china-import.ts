import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import {
  EMPTY_CHINA_HARDWARE_LOAD_INPUT,
  coerceChinaHardwareLoadInput,
  type ChinaHardwareLoadInputV1,
  type ChinaImportFieldProvenance,
} from "./china-import";

export const CHINA_HARDWARE_EXTRACTION_MODEL = "gpt-5.6" as const;

const nullableString = z.string().nullable();
const triState = z.enum(["yes", "no", "unknown"]);
const reviewState = z.enum(["unknown", "in_progress", "ready"]);

const CHINA_HARDWARE_EXTRACTION_SCHEMA = z.object({
  shipmentReference: nullableString,
  route: z.object({
    countryOfExport: nullableString,
    customsCountryOfOrigin: nullableString,
    portOfLoading: nullableString,
    portOfUnlading: nullableString,
    finalDestination: nullableString,
    containerType: nullableString,
    grossWeightKg: z.number().nullable(),
    incoterm: nullableString,
  }),
  timing: z.object({
    entryEvent: z.enum([
      "entry_for_consumption",
      "warehouse_withdrawal",
      "unknown",
    ]),
    actualEntryAt: nullableString,
    expectedEntryAt: nullableString,
    loadedOnVesselAtPortOfLoadingAt: nullableString,
    finalModeTransitStartedAt: nullableString,
  }),
  product: z.object({
    description: nullableString,
    model: nullableString,
    manufacturer: nullableString,
    principalFunction: nullableString,
    intendedUse: nullableString,
    marketingClaims: z.array(z.string()),
    proposedHts10: nullableString,
    classificationStatus: z.enum([
      "unknown",
      "supplier_proposed",
      "broker_reviewed",
      "binding_ruling",
    ]),
    tariffStackReviewStatus: reviewState,
  }),
  origin: z.object({
    manufacturingLocations: z.array(z.string()),
    transformationSummary: nullableString,
    markingDescription: nullableString,
    reviewStatus: reviewState,
  }),
  valuation: z.object({
    invoiceValue: z.number().nullable(),
    currency: nullableString,
    relatedParty: triState,
    internationalFreightIncluded: triState,
    insuranceIncluded: triState,
    additionsReviewStatus: reviewState,
  }),
  parties: z.object({
    importerOfRecord: nullableString,
    importerNumberAvailable: triState,
    customsBroker: nullableString,
    powerOfAttorneyReady: triState,
    bondReady: triState,
    seller: nullableString,
    buyer: nullableString,
    consignee: nullableString,
    ultimateConsignee: nullableString,
  }),
  forcedLabor: z.object({
    supplierIdentitiesComplete: triState,
    subSupplierIdentitiesComplete: triState,
    facilityAddressesComplete: triState,
    billOfMaterialsTraceable: triState,
    productionAndTransactionRecordsAvailable: triState,
    uflpaEntityScreenCompleted: triState,
  }),
  oceanFiling: z.object({
    isfFiler: nullableString,
    isfFiledAt: nullableString,
    containerStuffingLocation: nullableString,
    consolidator: nullableString,
    invoiceAvailable: triState,
    packingListAvailable: triState,
    billOfLadingAvailable: triState,
  }),
  agencyScreens: z.object({
    rf_device: triState,
    medical_device: triState,
    radiation_emitting_product: triState,
    cpsc_regulated_consumer_product: triState,
    lithium_battery: triState,
    other_hazardous_material: triState,
    radioactive_or_nuclear_material: triState,
    covered_engine: triState,
    pesticidal_claims: triState,
    doe_covered_product: triState,
    refrigerant_equipment: triState,
    solid_wood_packaging: triState,
  }),
});

const SYSTEM_PROMPT = `You extract a draft China-to-U.S. ocean import packet from shipment text.

Output only JSON matching this shape:
{
  "shipmentReference": string|null,
  "route": {
    "countryOfExport": string|null,
    "customsCountryOfOrigin": string|null,
    "portOfLoading": string|null,
    "portOfUnlading": string|null,
    "finalDestination": string|null,
    "containerType": string|null,
    "grossWeightKg": number|null,
    "incoterm": string|null
  },
  "timing": {
    "entryEvent": "entry_for_consumption"|"warehouse_withdrawal"|"unknown",
    "actualEntryAt": string|null,
    "expectedEntryAt": string|null,
    "loadedOnVesselAtPortOfLoadingAt": string|null,
    "finalModeTransitStartedAt": string|null
  },
  "product": {
    "description": string|null,
    "model": string|null,
    "manufacturer": string|null,
    "principalFunction": string|null,
    "intendedUse": string|null,
    "marketingClaims": string[],
    "proposedHts10": string|null,
    "classificationStatus": "unknown"|"supplier_proposed"|"broker_reviewed"|"binding_ruling",
    "tariffStackReviewStatus": "unknown"|"in_progress"|"ready"
  },
  "origin": {
    "manufacturingLocations": string[],
    "transformationSummary": string|null,
    "markingDescription": string|null,
    "reviewStatus": "unknown"|"in_progress"|"ready"
  },
  "valuation": {
    "invoiceValue": number|null,
    "currency": string|null,
    "relatedParty": "yes"|"no"|"unknown",
    "internationalFreightIncluded": "yes"|"no"|"unknown",
    "insuranceIncluded": "yes"|"no"|"unknown",
    "additionsReviewStatus": "unknown"|"in_progress"|"ready"
  },
  "parties": {
    "importerOfRecord": string|null,
    "importerNumberAvailable": "yes"|"no"|"unknown",
    "customsBroker": string|null,
    "powerOfAttorneyReady": "yes"|"no"|"unknown",
    "bondReady": "yes"|"no"|"unknown",
    "seller": string|null,
    "buyer": string|null,
    "consignee": string|null,
    "ultimateConsignee": string|null
  },
  "forcedLabor": {
    "supplierIdentitiesComplete": "yes"|"no"|"unknown",
    "subSupplierIdentitiesComplete": "yes"|"no"|"unknown",
    "facilityAddressesComplete": "yes"|"no"|"unknown",
    "billOfMaterialsTraceable": "yes"|"no"|"unknown",
    "productionAndTransactionRecordsAvailable": "yes"|"no"|"unknown",
    "uflpaEntityScreenCompleted": "yes"|"no"|"unknown"
  },
  "oceanFiling": {
    "isfFiler": string|null,
    "isfFiledAt": string|null,
    "containerStuffingLocation": string|null,
    "consolidator": string|null,
    "invoiceAvailable": "yes"|"no"|"unknown",
    "packingListAvailable": "yes"|"no"|"unknown",
    "billOfLadingAvailable": "yes"|"no"|"unknown"
  },
  "agencyScreens": {
    "rf_device": "yes"|"no"|"unknown",
    "medical_device": "yes"|"no"|"unknown",
    "radiation_emitting_product": "yes"|"no"|"unknown",
    "cpsc_regulated_consumer_product": "yes"|"no"|"unknown",
    "lithium_battery": "yes"|"no"|"unknown",
    "other_hazardous_material": "yes"|"no"|"unknown",
    "radioactive_or_nuclear_material": "yes"|"no"|"unknown",
    "covered_engine": "yes"|"no"|"unknown",
    "pesticidal_claims": "yes"|"no"|"unknown",
    "doe_covered_product": "yes"|"no"|"unknown",
    "refrigerant_equipment": "yes"|"no"|"unknown",
    "solid_wood_packaging": "yes"|"no"|"unknown"
  }
}

Rules:
- Never invent a value.
- Use "unknown", null, or [] when the source does not state the fact.
- Country of export is not customs country of origin.
- Supplier location is not customs country of origin.
- A proposed HTS is not broker reviewed unless the text explicitly says so.
- A date without a stated time and time zone must remain YYYY-MM-DD.
- Do not convert an omitted product feature into "no".
- Product category alone does not prove a negative agency screen.`;

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function hasExtractedValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") {
    return value !== "" && value !== "unknown";
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  return false;
}

function collectExtractedPaths(
  value: unknown,
  prefix = ""
): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return hasExtractedValue(value) && prefix ? [prefix] : [];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, nested]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      if (
        nested &&
        typeof nested === "object" &&
        !Array.isArray(nested)
      ) {
        return collectExtractedPaths(nested, path);
      }
      return hasExtractedValue(nested) ? [path] : [];
    }
  );
}

function withAiProvenance(
  raw: unknown
): ChinaHardwareLoadInputV1 {
  const input = coerceChinaHardwareLoadInput(raw);
  const rawObject = objectValue(raw);
  const paths = collectExtractedPaths(rawObject).filter(
    (path) =>
      path !== "schemaVersion" &&
      path !== "fieldProvenance" &&
      path !== "route.mode"
  );
  input.fieldProvenance = Object.fromEntries(
    paths.map((path) => [
      path,
      {
        basis: "ai_extracted",
        evidenceIds: [],
      } satisfies ChinaImportFieldProvenance,
    ])
  );
  return input;
}

type LabeledValue = {
  label: string;
  value: string;
};

const CURRENCY_CODES = new Set([
  "AUD",
  "CAD",
  "CHF",
  "CNY",
  "EUR",
  "GBP",
  "HKD",
  "JPY",
  "MXN",
  "RMB",
  "SGD",
  "USD",
]);

function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function usableLabeledValue(value: string): string | null {
  const trimmed = value.trim();
  if (
    !trimmed ||
    /^(?:-|n\/?a|none|not provided|tbd|unknown)$/i.test(trimmed)
  ) {
    return null;
  }
  return trimmed.slice(0, 2000);
}

function collectLabeledValues(text: string): Map<string, LabeledValue> {
  const values = new Map<string, LabeledValue>();
  for (const sourceLine of text.split(/\r?\n/)) {
    const line = sourceLine.replace(
      /^\s*(?:(?:[-*]|\d+[.)])\s+)/,
      ""
    );
    const match = line.match(
      /^\s*([A-Za-z][A-Za-z0-9 ._()/#&-]{0,79})\s*(?::|=)\s*(.*?)\s*$/
    );
    if (!match) continue;
    const value = usableLabeledValue(match[2]);
    if (!value) continue;
    const normalized = normalizeLabel(match[1]);
    if (!normalized || values.has(normalized)) continue;
    values.set(normalized, { label: match[1].trim(), value });
  }
  return values;
}

function firstLabeledValue(
  values: ReadonlyMap<string, LabeledValue>,
  aliases: readonly string[]
): string | null {
  for (const alias of aliases) {
    const match = values.get(alias);
    if (match) return match.value;
  }
  return null;
}

function positiveNumber(value: string): number | null {
  const match = value.match(
    /(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/
  );
  if (!match) return null;
  const parsed = Number(match[0].replaceAll(",", ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function grossWeightKg(
  values: ReadonlyMap<string, LabeledValue>
): number | null {
  const explicitKg = firstLabeledValue(values, [
    "grossweightkg",
    "grosskg",
    "weightkg",
  ]);
  if (explicitKg) return positiveNumber(explicitKg);
  const labeledWeight = firstLabeledValue(values, [
    "grossweight",
    "shipmentweight",
    "weight",
  ]);
  if (!labeledWeight || !/\b(?:kg|kgs|kilograms?)\b/i.test(labeledWeight)) {
    return null;
  }
  return positiveNumber(labeledWeight);
}

function invoiceFacts(
  values: ReadonlyMap<string, LabeledValue>
): { amount: number | null; currency: string | null } {
  const raw = firstLabeledValue(values, [
    "invoicevalue",
    "commercialinvoicevalue",
    "commercialvalue",
    "declaredvalue",
  ]);
  let currency = firstLabeledValue(values, [
    "invoicecurrency",
    "currency",
  ]);
  if (currency) {
    currency = currency.trim().toUpperCase();
    if (!CURRENCY_CODES.has(currency)) currency = null;
  }
  if (!raw) return { amount: null, currency };
  const explicitCode = raw
    .toUpperCase()
    .match(/\b[A-Z]{3}\b/)?.[0];
  if (explicitCode && CURRENCY_CODES.has(explicitCode)) {
    currency = explicitCode;
  } else if (/\bUS\$/i.test(raw)) {
    currency = "USD";
  }
  return { amount: positiveNumber(raw), currency };
}

function explicitYes(value: string | null): boolean {
  return value != null &&
    /^(?:yes|y|true|present|included|contains?|uses?)(?:\b|$)/i.test(
      value.trim()
    );
}

const NEGATIVE_FEATURE_PHRASE =
  /\b(?:0|no|zero|not|none|neither|without|absent|excluded|prohibited|free\s+of|does\s+not|doesn['’]?t)\b/i;
const POSITIVE_FEATURE_PHRASE =
  /\b(?:contains?|includes?|including|equipped\s+with|packed\s+(?:with|on)|ships?\s+with|supplied\s+with|uses?)\b/i;
const LITHIUM_FEATURE =
  /\blithium(?:-ion)?(?:\s+[a-z0-9-]+){0,3}\s+batter(?:y|ies)\b|\blithium(?:-ion)?\s+cells?\b/i;
const SOLID_WOOD_FEATURE =
  /\bsolid[-\s]+wood\s+(?:pallets?|crates?|packaging|dunnage)\b/i;

function hasExplicitPositivePhrase(
  text: string,
  featurePattern: RegExp
): boolean {
  const positiveBeforeFeature = new RegExp(
    `(?:${POSITIVE_FEATURE_PHRASE.source})[^\\r\\n.!?;]{0,60}(?:${featurePattern.source})`,
    "i"
  );
  const positiveAfterFeature = new RegExp(
    `(?:${featurePattern.source})[^\\r\\n.!?;]{0,30}\\b(?:included|present|used)\\b`,
    "i"
  );
  return text.split(/[\r\n.!?;]+/).some((segment) => {
    if (!featurePattern.test(segment)) return false;
    if (NEGATIVE_FEATURE_PHRASE.test(segment)) return false;
    return positiveBeforeFeature.test(segment) ||
      positiveAfterFeature.test(segment);
  });
}

function setSupplierValue(
  input: ChinaHardwareLoadInputV1,
  path: string,
  value: unknown
): void {
  let target = input as unknown as Record<string, unknown>;
  const parts = path.split(".");
  for (const part of parts.slice(0, -1)) {
    target = target[part] as Record<string, unknown>;
  }
  target[parts.at(-1)!] = value;
  input.fieldProvenance[path] = {
    basis: "supplier_statement",
    evidenceIds: [],
  };
}

function valueAtPath(
  input: ChinaHardwareLoadInputV1,
  path: string
): unknown {
  return path.split(".").reduce<unknown>((value, part) => {
    if (!value || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[part];
  }, input);
}

function hasParsedValue(value: unknown): boolean {
  if (typeof value === "string") {
    return value.length > 0 && value !== "unknown";
  }
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  if (Array.isArray(value)) return value.length > 0;
  return false;
}

export function parseLabeledChinaHardwareLoadFallback(
  sourceText: string
): ChinaHardwareLoadInputV1 {
  const input = structuredClone(EMPTY_CHINA_HARDWARE_LOAD_INPUT);
  input.route.countryOfExport = null;
  const labeled = collectLabeledValues(sourceText);

  const fields: ReadonlyArray<{
    path: string;
    aliases: readonly string[];
  }> = [
    {
      path: "shipmentReference",
      aliases: [
        "shipment",
        "shipmentreference",
        "shipmentref",
        "shipmentnumber",
        "shipmentno",
        "loadreference",
      ],
    },
    {
      path: "product.description",
      aliases: ["product", "productdescription", "commodity", "goods"],
    },
    {
      path: "product.model",
      aliases: ["model", "modelnumber", "productmodel"],
    },
    {
      path: "product.manufacturer",
      aliases: ["manufacturer", "legalmanufacturer"],
    },
    {
      path: "product.principalFunction",
      aliases: ["principalfunction", "primaryfunction", "productfunction"],
    },
    {
      path: "product.intendedUse",
      aliases: ["intendeduse", "enduse", "productuse"],
    },
    {
      path: "route.countryOfExport",
      aliases: ["countryofexport", "exportcountry"],
    },
    {
      path: "route.customsCountryOfOrigin",
      aliases: [
        "claimedcustomsorigin",
        "customscountryoforigin",
        "customsorigin",
        "countryoforigin",
      ],
    },
    {
      path: "route.portOfLoading",
      aliases: ["portofloading", "foreignportofloading", "pol"],
    },
    {
      path: "route.portOfUnlading",
      aliases: [
        "portofunlading",
        "portofdischarge",
        "usportofunlading",
        "pod",
      ],
    },
    {
      path: "route.finalDestination",
      aliases: [
        "finaldestination",
        "finaldelivery",
        "deliverydestination",
        "destination",
      ],
    },
    {
      path: "route.containerType",
      aliases: ["container", "containertype", "equipment"],
    },
    {
      path: "route.incoterm",
      aliases: ["incoterm", "incoterms", "trade term", "tradeterm"],
    },
    {
      path: "timing.expectedEntryAt",
      aliases: [
        "expectedentry",
        "expectedentryat",
        "expectedentrydate",
        "plannedentry",
      ],
    },
    {
      path: "timing.actualEntryAt",
      aliases: ["actualentry", "actualentryat", "actualentrydate"],
    },
    {
      path: "product.proposedHts10",
      aliases: [
        "proposedhts",
        "proposedhts10",
        "proposedhtsus",
        "hts",
        "hts10",
        "htsus",
      ],
    },
    {
      path: "parties.importerOfRecord",
      aliases: ["importer", "importerofrecord", "ior"],
    },
    {
      path: "parties.customsBroker",
      aliases: ["broker", "customsbroker", "entrybroker"],
    },
  ];

  for (const field of fields) {
    const value = firstLabeledValue(
      labeled,
      field.aliases.map(normalizeLabel)
    );
    if (value) setSupplierValue(input, field.path, value);
  }

  const entryEvent = firstLabeledValue(labeled, [
    "entryevent",
    "customsevent",
    "controllingcustomsevent",
  ]);
  if (
    entryEvent &&
    /^(?:entry|entry\s+for\s+consumption)$/i.test(entryEvent.trim())
  ) {
    setSupplierValue(
      input,
      "timing.entryEvent",
      "entry_for_consumption"
    );
  } else if (
    entryEvent &&
    /^(?:warehouse\s+withdrawal|withdrawal\s+from\s+warehouse)(?:\s+for\s+consumption)?$/i.test(
      entryEvent.trim()
    )
  ) {
    setSupplierValue(
      input,
      "timing.entryEvent",
      "warehouse_withdrawal"
    );
  }

  const weight = grossWeightKg(labeled);
  if (weight != null) {
    setSupplierValue(input, "route.grossWeightKg", weight);
  }

  const invoice = invoiceFacts(labeled);
  if (invoice.amount != null) {
    setSupplierValue(input, "valuation.invoiceValue", invoice.amount);
  }
  if (invoice.currency) {
    setSupplierValue(input, "valuation.currency", invoice.currency);
  }

  const labeledLithium = firstLabeledValue(labeled, [
    "lithiumbattery",
    "lithiumbatteries",
    "containslithiumbattery",
    "containslithiumbatteries",
  ]);
  if (
    explicitYes(labeledLithium) ||
    hasExplicitPositivePhrase(sourceText, LITHIUM_FEATURE)
  ) {
    setSupplierValue(input, "agencyScreens.lithium_battery", "yes");
  }

  const labeledWood = firstLabeledValue(labeled, [
    "solidwoodpackaging",
    "solidwoodpallet",
    "solidwoodpallets",
  ]);
  if (
    explicitYes(labeledWood) ||
    hasExplicitPositivePhrase(sourceText, SOLID_WOOD_FEATURE)
  ) {
    setSupplierValue(input, "agencyScreens.solid_wood_packaging", "yes");
  }

  const coerced = coerceChinaHardwareLoadInput(input);
  coerced.fieldProvenance = Object.fromEntries(
    Object.keys(input.fieldProvenance)
      .filter((path) => hasParsedValue(valueAtPath(coerced, path)))
      .map((path) => [
        path,
        {
          basis: "supplier_statement",
          evidenceIds: [],
        } satisfies ChinaImportFieldProvenance,
      ])
  );
  return coerced;
}

export async function extractChinaHardwareLoad(
  sourceText: string
): Promise<{ input: ChinaHardwareLoadInputV1; note: string | null }> {
  const trimmed = sourceText.trim().slice(0, 12000);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      input: parseLabeledChinaHardwareLoadFallback(trimmed),
      note:
        "No model was used. Explicitly labeled shipment facts were parsed locally. No shipment text or assessment was persisted. Confirm every source-text value before using the report.",
    };
  }
  try {
    const client = new OpenAI({
      apiKey,
      maxRetries: 1,
      timeout: 45_000,
    });
    const result = await client.responses.parse({
      model: CHINA_HARDWARE_EXTRACTION_MODEL,
      instructions: SYSTEM_PROMPT,
      input: trimmed,
      reasoning: {
        effort: "medium",
      },
      max_output_tokens: 2400,
      store: false,
      text: {
        format: zodTextFormat(
          CHINA_HARDWARE_EXTRACTION_SCHEMA,
          "china_hardware_load"
        ),
      },
    });
    if (!result.output_parsed) {
      throw new Error("The extraction service returned no structured shipment packet");
    }
    return {
      input: withAiProvenance(result.output_parsed),
      note:
        "Automated extraction drafted the shipment facts. Confirm every extracted value before using the report.",
    };
  } catch {
    return {
      input: parseLabeledChinaHardwareLoadFallback(trimmed),
      note:
        "Automated extraction failed. Explicitly labeled shipment facts were parsed locally instead. No shipment text or assessment was persisted. Confirm every source-text value before using the report.",
    };
  }
}
