import type { RfqQualification } from "./rfq-qualification";
import type { StrategyBlockerResolution } from "./commercial-strategy";

export type MissingInfoDraftInput = {
  subject: string;
  fromEmail?: string | null;
  origin?: string | null;
  destination?: string | null;
  mode?: string | null;
  commodity?: string | null;
  containerCount?: number | null;
  containerType?: string | null;
  incoterms?: string | null;
  weight?: number | null;
  volume?: number | null;
  parsedData?: string | null;
  qualification: RfqQualification;
  blockerResolutionPlan?: StrategyBlockerResolution[];
};

type ReferenceDealParsedData = {
  source?: string;
  sheet?: {
    contact?: string | null;
    contract?: string | null;
    type?: string | null;
    quantity?: string | null;
    unit?: string | null;
  };
};

function clean(value: string | null | undefined) {
  const text = (value ?? "").trim();
  return text && text !== "-" ? text : null;
}

function parseReferenceSource(parsedData: string | null | undefined): ReferenceDealParsedData["sheet"] | null {
  if (!parsedData) return null;
  try {
    const parsed = JSON.parse(parsedData) as ReferenceDealParsedData;
    if (parsed.source !== "reference-deal") return null;
    return parsed.sheet ?? null;
  } catch {
    return null;
  }
}

function modeLabel(mode: string | null | undefined) {
  const labels: Record<string, string> = {
    "SEA-FCL": "sea FCL",
    "SEA-LCL": "sea LCL",
    AIR: "air freight",
    ROAD: "road freight",
    COURIER: "courier",
  };
  return mode ? (labels[mode] ?? mode) : null;
}

function knownContext(input: MissingInfoDraftInput) {
  const source = parseReferenceSource(input.parsedData);
  const parts = [
    clean(input.commodity) ?? clean(source?.contract),
    input.origin || input.destination ? `${clean(input.origin) ?? "origin TBD"} to ${clean(input.destination) ?? "destination TBD"}` : null,
    modeLabel(input.mode),
    input.containerCount && input.containerType ? `${input.containerCount} x ${input.containerType}` : clean(input.containerType),
    input.weight ? `${Math.round(input.weight).toLocaleString()} kg` : null,
    input.volume ? `${input.volume.toLocaleString()} CBM` : null,
    clean(input.incoterms) ? `${clean(input.incoterms)} terms` : null,
    source?.quantity || source?.unit ? `${[source.quantity, source.unit].filter(Boolean).join(" ")}` : null,
  ].filter(Boolean);

  if (parts.length === 0) return null;
  return `I currently have this noted as: ${parts.join(" · ")}.`;
}

function questionForMissing(field: string) {
  const normalized = field.toLowerCase();
  const map: Record<string, string> = {
    origin: "Please confirm the pickup/origin location.",
    destination: "Please confirm the delivery/destination location.",
    "transport mode": "Please confirm the preferred transport mode.",
    "load / commodity": "Please confirm the cargo/product description.",
    weight: "Please confirm the total gross weight.",
    "dangerous goods declaration": "Please confirm whether the cargo is dangerous goods.",
    "customs responsibility": "Please confirm who will handle customs work.",
    "container count": "Please confirm the number of containers.",
    "container size/type": "Please confirm the container size/type.",
    "lcl dimensions or cbm": "Please confirm the LCL dimensions or total CBM.",
    "complete lcl dimensions": "Please confirm complete LCL dimensions: quantity, length, width, and height for each package line.",
    stackability: "Please confirm whether the cargo is stackable.",
    "top-load preference": "If non-stackable, please confirm whether top-load is requested. We cannot guarantee it, but it helps us price the constraint correctly.",
    "dimensions or cbm": "Please confirm dimensions or total CBM.",
    "complete dimensions": "Please confirm complete dimensions: quantity, length, width, and height for each package line.",
  };
  return map[normalized] ?? `Please confirm ${field}.`;
}

export function buildMissingInfoDraft(input: MissingInfoDraftInput) {
  const subject = input.subject.toLowerCase().startsWith("re:")
    ? input.subject
    : `Re: ${input.subject}`;
  const context = knownContext(input);
  const blockerPlan = (input.blockerResolutionPlan ?? []).filter((item) => item.ask.trim());
  const questions = blockerPlan.length > 0
    ? blockerPlan.map((item) => item.ask)
    : input.qualification.missing.map(questionForMissing);
  if (!blockerPlan.some((item) => item.key === "target_price") && input.qualification.targetPriceQuestion) {
    questions.push("If you have a target price, it helps us leverage agencies better; if not, no problem.");
  }
  const blockerContext = blockerPlan.length > 0
    ? `The most important items to clear first are: ${blockerPlan.slice(0, 3).map((item) => item.label).join(", ")}.`
    : null;

  const body = [
    "Hello,",
    "",
    "Thanks for the request. To price this correctly, can you please confirm the below?",
    context,
    blockerContext,
    "",
    ...questions.map((q) => `- ${q}`),
    "",
    "Best,",
    "Derya",
  ].filter((line) => line !== null && line !== undefined).join("\n");

  return {
    to: input.fromEmail ?? "",
    subject,
    body,
    questions,
    context,
    blockerResolutionPlan: blockerPlan,
  };
}
