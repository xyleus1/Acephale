import { dimensionCompleteness, parseDimensions } from "./cargo";

export type RfqQualificationInput = {
  origin?: string | null;
  destination?: string | null;
  mode?: string | null;
  commodity?: string | null;
  containerCount?: number | null;
  containerType?: string | null;
  dimensions?: string | null;
  stackable?: string | null;
  topLoad?: string | null;
  dangerousGoods?: string | null;
  customsBy?: string | null;
  weight?: number | null;
  volume?: number | null;
  targetPrice?: number | null;
  targetPriceStatus?: string | null;
};

export type RfqQualification = {
  isMature: boolean;
  missing: string[];
  targetPriceQuestion: string | null;
  followUpQuestions: string[];
};

export type RfqMaturityCheckKey =
  | "origin"
  | "destination"
  | "mode"
  | "commodity"
  | "weight"
  | "dangerous_goods"
  | "customs"
  | "fcl_equipment"
  | "lcl_dimensions"
  | "stackability"
  | "top_load"
  | "cargo_dimensions"
  | "target_price";

export type RfqMaturityCheck = {
  key: RfqMaturityCheckKey;
  label: string;
  status: "ready" | "missing" | "not_applicable";
  detail: string;
};

function empty(value: unknown): boolean {
  return value == null || value === "" || value === "UNKNOWN";
}

function makeCheck(
  key: RfqMaturityCheckKey,
  label: string,
  status: RfqMaturityCheck["status"],
  detail: string
): RfqMaturityCheck {
  return { key, label, status, detail };
}

function valueDetail(value: unknown, fallback: string) {
  return empty(value) ? fallback : String(value);
}

export function buildRfqMaturityChecks(input: RfqQualificationInput): RfqMaturityCheck[] {
  const checks: RfqMaturityCheck[] = [];
  const dimensionState = dimensionCompleteness(parseDimensions(input.dimensions));
  const volumeKnown = input.volume != null && Number(input.volume) > 0;
  const dimensionsKnown = dimensionState.hasCompleteDimensions;
  const weightKnown = input.weight != null && Number(input.weight) > 0;
  const targetPriceKnown = input.targetPrice != null && Number(input.targetPrice) > 0;
  const noTargetConfirmed = input.targetPriceStatus === "NO_TARGET";

  checks.push(
    makeCheck(
      "origin",
      "Origin",
      empty(input.origin) ? "missing" : "ready",
      valueDetail(input.origin, "Customer has not confirmed the pickup/origin.")
    ),
    makeCheck(
      "destination",
      "Destination",
      empty(input.destination) ? "missing" : "ready",
      valueDetail(input.destination, "Customer has not confirmed delivery/destination.")
    ),
    makeCheck(
      "mode",
      "Mode",
      empty(input.mode) ? "missing" : "ready",
      valueDetail(input.mode, "Transport mode is not confirmed.")
    ),
    makeCheck(
      "commodity",
      "Commodity",
      empty(input.commodity) ? "missing" : "ready",
      valueDetail(input.commodity, "Load or commodity is not confirmed.")
    ),
    makeCheck(
      "weight",
      "Weight",
      weightKnown ? "ready" : "missing",
      weightKnown ? `${Number(input.weight).toLocaleString()} kg` : "Chargeable weight is not confirmed."
    ),
    makeCheck(
      "dangerous_goods",
      "Dangerous goods",
      empty(input.dangerousGoods) ? "missing" : "ready",
      valueDetail(input.dangerousGoods, "DG declaration is missing.")
    ),
    makeCheck(
      "customs",
      "Customs",
      empty(input.customsBy) ? "missing" : "ready",
      valueDetail(input.customsBy, "Customs responsibility is not confirmed.")
    )
  );

  if (input.mode === "SEA-FCL") {
    const countKnown = input.containerCount != null && Number(input.containerCount) > 0;
    const typeKnown = !empty(input.containerType);
    checks.push(makeCheck(
      "fcl_equipment",
      "FCL equipment",
      countKnown && typeKnown ? "ready" : "missing",
      countKnown && typeKnown
        ? `${Number(input.containerCount).toLocaleString()} x ${input.containerType}`
        : "Container count and size/type are both required."
    ));
  } else if (input.mode === "SEA-LCL") {
    checks.push(makeCheck(
      "lcl_dimensions",
      "LCL dimensions",
      dimensionState.hasPartialDimensions
        ? "missing"
        : dimensionsKnown || volumeKnown ? "ready" : "missing",
      dimensionState.hasPartialDimensions
        ? "Partial dimensions are present; complete every row before pricing."
        : dimensionsKnown
          ? "Complete dimensions captured."
          : volumeKnown
            ? `${Number(input.volume).toLocaleString()} CBM captured.`
            : "Need complete dimensions or confirmed CBM."
    ));
    checks.push(makeCheck(
      "stackability",
      "Stackability",
      empty(input.stackable) ? "missing" : "ready",
      valueDetail(input.stackable, "Stackability is not confirmed.")
    ));
    checks.push(makeCheck(
      "top_load",
      "Top load",
      input.stackable === "NO" ? (empty(input.topLoad) ? "missing" : "ready") : "not_applicable",
      input.stackable === "NO"
        ? valueDetail(input.topLoad, "Non-stackable cargo needs top-load preference.")
        : "Only needed when LCL cargo is non-stackable."
    ));
  } else if (!empty(input.mode) && input.mode !== "SEA-FCL") {
    checks.push(makeCheck(
      "cargo_dimensions",
      "Cargo dimensions",
      dimensionState.hasPartialDimensions
        ? "missing"
        : dimensionsKnown || volumeKnown ? "ready" : "missing",
      dimensionState.hasPartialDimensions
        ? "Partial dimensions are present; complete every row before pricing."
        : dimensionsKnown
          ? "Complete dimensions captured."
          : volumeKnown
            ? `${Number(input.volume).toLocaleString()} CBM captured.`
            : "Need dimensions or confirmed CBM for this mode."
    ));
  }

  checks.push(makeCheck(
    "target_price",
    "Target price",
    targetPriceKnown || noTargetConfirmed ? "ready" : "missing",
    targetPriceKnown
      ? `${Number(input.targetPrice).toLocaleString()} target captured.`
      : noTargetConfirmed
        ? "Customer explicitly has no target."
        : "Ask for a target price or explicit no-target confirmation."
  ));

  return checks;
}

export function qualifyRfq(input: RfqQualificationInput): RfqQualification {
  const missing: string[] = [];
  const dimensionState = dimensionCompleteness(parseDimensions(input.dimensions));
  const volumeKnown = input.volume != null && Number(input.volume) > 0;
  const dimensionsKnown = dimensionState.hasCompleteDimensions;

  if (empty(input.origin)) missing.push("origin");
  if (empty(input.destination)) missing.push("destination");
  if (empty(input.mode)) missing.push("transport mode");
  if (empty(input.commodity)) missing.push("load / commodity");
  if (input.weight == null || Number(input.weight) <= 0) missing.push("weight");
  if (empty(input.dangerousGoods)) missing.push("dangerous goods declaration");
  if (empty(input.customsBy)) missing.push("customs responsibility");

  if (input.mode === "SEA-FCL") {
    if (input.containerCount == null || Number(input.containerCount) <= 0) missing.push("container count");
    if (empty(input.containerType)) missing.push("container size/type");
  } else if (input.mode === "SEA-LCL") {
    if (dimensionState.hasPartialDimensions) {
      missing.push("complete LCL dimensions");
    } else if (!dimensionsKnown && !volumeKnown) {
      missing.push("LCL dimensions or CBM");
    }
    if (empty(input.stackable)) missing.push("stackability");
    if (input.stackable === "NO" && empty(input.topLoad)) {
      missing.push("top-load preference");
    }
  } else if (!empty(input.mode) && input.mode !== "SEA-FCL") {
    if (dimensionState.hasPartialDimensions) {
      missing.push("complete dimensions");
    } else if (!dimensionsKnown && !volumeKnown) {
      missing.push("dimensions or CBM");
    }
  }

  const targetPriceKnown = input.targetPrice != null && Number(input.targetPrice) > 0;
  const targetPriceAnswered = targetPriceKnown || input.targetPriceStatus === "NO_TARGET";
  const targetPriceQuestion = targetPriceAnswered
    ? null
    : "Do you have a target price? If not, no problem, but a target helps us leverage agencies better.";

  const followUpQuestions = missing.map((field) => `Please confirm ${field}.`);
  if (targetPriceQuestion) followUpQuestions.push(targetPriceQuestion);

  return {
    isMature: missing.length === 0 && targetPriceAnswered,
    missing,
    targetPriceQuestion,
    followUpQuestions,
  };
}
