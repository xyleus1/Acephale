export type StageHint =
  | "INQUIRY-CARRIER-RFQ"
  | "INQUIRY-CUSTOMER-CLARIFY"
  | "QUOTED-CUSTOMER-QUOTE"
  | "QUOTED-CUSTOMER-FOLLOWUP"
  | "BOOKED-CARRIER-CONFIRM"
  | "BOOKED-CUSTOMER-CONFIRM"
  | "IN_TRANSIT-CUSTOMER-UPDATE"
  | "CUSTOMS-BROKER-DOCS"
  | "DELIVERED-CUSTOMER-POD";

export type DraftResult = { subject: string; body: string };

export const STAGE_TEMPLATES: Record<StageHint, { stageHint: StageHint; toLabel: string; label: string }> = {
  "INQUIRY-CARRIER-RFQ":         { stageHint: "INQUIRY-CARRIER-RFQ",         toLabel: "Carrier",  label: "Draft rate request to carrier" },
  "INQUIRY-CUSTOMER-CLARIFY":    { stageHint: "INQUIRY-CUSTOMER-CLARIFY",    toLabel: "Customer", label: "Draft clarification ask" },
  "QUOTED-CUSTOMER-QUOTE":       { stageHint: "QUOTED-CUSTOMER-QUOTE",       toLabel: "Customer", label: "Draft customer quote" },
  "QUOTED-CUSTOMER-FOLLOWUP":    { stageHint: "QUOTED-CUSTOMER-FOLLOWUP",    toLabel: "Customer", label: "Draft quote follow-up" },
  "BOOKED-CARRIER-CONFIRM":      { stageHint: "BOOKED-CARRIER-CONFIRM",      toLabel: "Carrier",  label: "Draft booking confirmation" },
  "BOOKED-CUSTOMER-CONFIRM":     { stageHint: "BOOKED-CUSTOMER-CONFIRM",     toLabel: "Customer", label: "Draft customer booking note" },
  "IN_TRANSIT-CUSTOMER-UPDATE":  { stageHint: "IN_TRANSIT-CUSTOMER-UPDATE",  toLabel: "Customer", label: "Draft status update" },
  "CUSTOMS-BROKER-DOCS":         { stageHint: "CUSTOMS-BROKER-DOCS",         toLabel: "Broker",   label: "Request customs docs from broker" },
  "DELIVERED-CUSTOMER-POD":      { stageHint: "DELIVERED-CUSTOMER-POD",      toLabel: "Customer", label: "Draft POD note" },
};

export function templatesForStatus(status: string): StageHint[] {
  switch (status) {
    case "INQUIRY":    return ["INQUIRY-CARRIER-RFQ", "INQUIRY-CUSTOMER-CLARIFY"];
    case "QUOTED":     return ["QUOTED-CUSTOMER-QUOTE", "QUOTED-CUSTOMER-FOLLOWUP"];
    case "BOOKED":     return ["BOOKED-CARRIER-CONFIRM", "BOOKED-CUSTOMER-CONFIRM"];
    case "IN_TRANSIT": return ["IN_TRANSIT-CUSTOMER-UPDATE"];
    case "CUSTOMS":    return ["IN_TRANSIT-CUSTOMER-UPDATE"];
    case "DELIVERED":  return ["DELIVERED-CUSTOMER-POD"];
    default: return [];
  }
}
