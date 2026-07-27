import { manualSourceUse } from "../sources";
import type { ManualObservedCompanyEvidence } from "./ocean-hardware";

export const IMPORTGENIUS_PUBLIC_PREVIEW_CHECKED_DATE = "2026-07-22" as const;

const IMPORTGENIUS_PUBLIC_PREVIEW_REVIEWED_AT = "2026-07-22T00:00:00.000Z";

function importGeniusPreviewSource(sourceUrl: string, shipmentDate: string) {
  return manualSourceUse(
    "importgenius",
    sourceUrl,
    IMPORTGENIUS_PUBLIC_PREVIEW_REVIEWED_AT,
    shipmentDate
  );
}

const SHARED_SAMPLE_CAVEATS = [
  "Manually reviewed public provider preview. No ImportGenius account, export, API, or live feed is connected.",
  "This is one observed example from a public profile, not complete shipment history.",
  `Source checked ${IMPORTGENIUS_PUBLIC_PREVIEW_CHECKED_DATE}.`,
  "Startup status and lead qualification were not assessed from the manifest preview.",
] as const;

export const IMPORTGENIUS_PUBLIC_PREVIEW_EVIDENCE = [
  {
    id: "importgenius-relativity-space-2025-02-16",
    companyName: "Relativity Space",
    companyLocation: "Long Beach, CA",
    observationType: "company_profile",
    observedRole: "importer",
    shipmentDate: "2025-02-16",
    supplierName: null,
    originCountry: "France",
    productDescription: "Aircraft shapes",
    hsCodes: ["7604291090"],
    arrivalPort: null,
    weightKg: 9_886,
    containerCount: 1,
    billOfLadingNumber: null,
    reviewedAt: IMPORTGENIUS_PUBLIC_PREVIEW_REVIEWED_AT,
    companyQualification: "not_assessed",
    leadQualification: "not_assessed",
    caveats: [
      ...SHARED_SAMPLE_CAVEATS,
      "The public preview describes one 40-foot container. Container equipment detail is retained only in this caveat.",
    ],
    sources: [
      importGeniusPreviewSource(
        "https://www.importgenius.com/importers/relativity-space-inc-headquarters",
        "2025-02-16"
      ),
    ],
  },
  {
    id: "importgenius-joby-aviation-2024-01-24",
    companyName: "Joby Aviation",
    companyLocation: "San Carlos, CA",
    observationType: "company_profile",
    observedRole: "importer",
    shipmentDate: "2024-01-24",
    supplierName: "Shimadzu Corporation",
    originCountry: "Japan",
    productDescription: "Materials testing machinery",
    hsCodes: [],
    arrivalPort: null,
    weightKg: 1_652,
    containerCount: null,
    billOfLadingNumber: null,
    reviewedAt: IMPORTGENIUS_PUBLIC_PREVIEW_REVIEWED_AT,
    companyQualification: "not_assessed",
    leadQualification: "not_assessed",
    caveats: [...SHARED_SAMPLE_CAVEATS, "No HS code was copied because the reviewed preview row did not support one confidently."],
    sources: [importGeniusPreviewSource("https://www.importgenius.com/importers/joby-aviation", "2024-01-24")],
  },
  {
    id: "importgenius-figure-ai-2025-11-10",
    companyName: "Figure AI",
    companyLocation: "Sunnyvale, CA",
    observationType: "company_profile",
    observedRole: "importer",
    shipmentDate: "2025-11-10",
    supplierName: null,
    originCountry: null,
    productDescription: "Torsion testing machine",
    hsCodes: [],
    arrivalPort: null,
    weightKg: 525,
    containerCount: null,
    billOfLadingNumber: null,
    reviewedAt: IMPORTGENIUS_PUBLIC_PREVIEW_REVIEWED_AT,
    companyQualification: "not_assessed",
    leadQualification: "not_assessed",
    caveats: [
      ...SHARED_SAMPLE_CAVEATS,
      "The public preview displays conflicting supplier-location and origin-country information. Supplier and origin are intentionally omitted.",
    ],
    sources: [importGeniusPreviewSource("https://www.importgenius.com/importers/figure-ai-inc", "2025-11-10")],
  },
] as const satisfies readonly ManualObservedCompanyEvidence[];

export function getImportGeniusPublicPreviewEvidence(): ManualObservedCompanyEvidence[] {
  return IMPORTGENIUS_PUBLIC_PREVIEW_EVIDENCE.map((evidence) => ({
    ...evidence,
    hsCodes: [...evidence.hsCodes],
    caveats: [...evidence.caveats],
    sources: evidence.sources.map((source) => ({ ...source })),
  }));
}
