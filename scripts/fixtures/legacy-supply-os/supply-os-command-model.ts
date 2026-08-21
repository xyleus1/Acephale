export type MovementAssessmentRecord = {
  id: string;
  movementId: string;
};

export type ProcurementProfile = {
  movementId: string;
  lane: string;
  observationWindow: string;
  p10: string;
  p50: string;
  p75: string;
  selectedMarker: string;
  selectedPosition: string;
  weekChange: string;
  reliabilityBand: string;
  scheduleOptions: string;
  expiry: string;
  rationale: string[];
};

export const SUPPLY_MOVEMENT_ORIGIN_COUNTRIES: Readonly<Record<string, string>> = Object.freeze({
  "po-1048": "China",
  "po-1052": "Malaysia",
  "po-1037": "Mexico",
  "po-1061": "United States",
  "po-1064": "China",
  "po-1029": "Netherlands",
});

export const SUPPLY_PROCUREMENT_PROFILES: Readonly<Record<string, ProcurementProfile>> = Object.freeze({
  "po-1048": {
    movementId: "po-1048",
    lane: "Yantian / Long Beach / Austin",
    observationWindow: "Trailing 90 days / modeled from 18 quote observations",
    p10: "$6.9k P10",
    p50: "$7.5k P50",
    p75: "$8.6k P75",
    selectedMarker: "Selected $7.78k",
    selectedPosition: "51%",
    weekChange: "+3.8%",
    reliabilityBand: "88-96%",
    scheduleOptions: "7 sailings",
    expiry: "18h to expiry",
    rationale: [
      "Within the approved $8,500 transport ceiling.",
      "Maintains 4.2 days of launch buffer.",
      "Two existing-partner quotes remain visible for comparison.",
      "Broker hold must clear before booking release.",
    ],
  },
  "po-1064": {
    movementId: "po-1064",
    lane: "Shanghai / Oakland / Austin",
    observationWindow: "Trailing 90 days / modeled from 21 quote observations",
    p10: "$7.7k P10",
    p50: "$8.47k P50",
    p75: "$9.3k P75",
    selectedMarker: "Selected $8.39k",
    selectedPosition: "39%",
    weekChange: "+8.4%",
    reliabilityBand: "84-93%",
    scheduleOptions: "5 sailings",
    expiry: "22h to expiry",
    rationale: [
      "Within the approved $9,000 transport ceiling.",
      "Preserves 6.1 days of modeled delivery buffer.",
      "Oakland avoids the current Long Beach dwell exposure.",
      "The Shanghai rate premium remains under active review.",
    ],
  },
});

export function resolveMovementAssessment<T extends MovementAssessmentRecord>(
  movementId: string,
  selectedAssessmentId: string,
  assessments: readonly T[],
): T | null {
  return assessments.find((item) => item.id === selectedAssessmentId && item.movementId === movementId)
    ?? assessments.find((item) => item.movementId === movementId)
    ?? null;
}

export function resolveMovementOwnedRecord<T extends MovementAssessmentRecord>(
  movementId: string,
  recordId: string | null,
  records: readonly T[],
): T | null {
  if (!recordId) return null;
  return records.find((item) => item.id === recordId && item.movementId === movementId) ?? null;
}

export function originCountryForMovement(movementId: string): string {
  return SUPPLY_MOVEMENT_ORIGIN_COUNTRIES[movementId] ?? "Unknown";
}

export function procurementProfileForMovement(movementId: string): ProcurementProfile | null {
  return SUPPLY_PROCUREMENT_PROFILES[movementId] ?? null;
}
