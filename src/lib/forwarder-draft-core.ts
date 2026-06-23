export type ForwarderDraftInquiry = {
  subject: string;
  origin: string | null;
  destination: string | null;
  mode: string | null;
  containerCount: number | null;
  containerType: string | null;
  dimensions: string | null;
  stackable: string | null;
  topLoad: string | null;
  dangerousGoods: string | null;
  customsBy: string | null;
  commodity: string | null;
  weight: number | null;
  volume: number | null;
  incoterms: string | null;
  cargoReadyDate: Date | null;
};

export function forwarderModeList(value: string | null | undefined) {
  return (value ?? "")
    .split(/[,\s]+/)
    .map((mode) => mode.trim().toUpperCase())
    .filter(Boolean);
}

export function coversForwarderMode(forwarder: { modeCoverage: string | null }, mode: string | null | undefined) {
  const modes = forwarderModeList(forwarder.modeCoverage);
  return modes.length === 0 || (!!mode && modes.includes(mode.toUpperCase()));
}

export function forwarderModeCoverageLabel(value: string | null) {
  const modes = forwarderModeList(value);
  return modes.length ? modes.join(", ") : "All modes";
}

export function buildForwarderDraft(inquiry: ForwarderDraftInquiry, forwarder: { name: string; email: string }) {
  const subject = `RFQ - ${inquiry.mode ?? "Freight"} - ${inquiry.origin ?? "Origin"} to ${inquiry.destination ?? "Destination"}`;
  const lines = [
    `Hello ${forwarder.name},`,
    "",
    "Can you please quote the below shipment?",
    "",
    `Route: ${inquiry.origin ?? "-"} to ${inquiry.destination ?? "-"}`,
    `Mode: ${inquiry.mode ?? "-"}`,
    inquiry.incoterms ? `Incoterms: ${inquiry.incoterms}` : null,
    inquiry.commodity ? `Commodity: ${inquiry.commodity}` : null,
    inquiry.weight ? `Weight: ${inquiry.weight.toLocaleString()} kg` : null,
    inquiry.volume ? `Volume: ${inquiry.volume.toLocaleString()} cbm` : null,
    inquiry.mode === "SEA-FCL" ? `Equipment: ${inquiry.containerCount ?? "-"} x ${inquiry.containerType ?? "-"}` : null,
    inquiry.dimensions ? `Dimensions: ${inquiry.dimensions}` : null,
    inquiry.stackable ? `Stackable: ${inquiry.stackable}` : null,
    inquiry.stackable === "NO" ? `Top load requested/acceptable: ${inquiry.topLoad ?? "-"}` : null,
    `Dangerous goods: ${inquiry.dangerousGoods ?? "-"}`,
    `Customs responsibility: ${inquiry.customsBy ?? "-"}`,
    inquiry.cargoReadyDate ? `Cargo ready: ${inquiry.cargoReadyDate.toISOString().slice(0, 10)}` : null,
    "",
    "Please include all-in cost, transit time, validity, service notes, and any exclusions.",
    "",
    "Best,",
  ].filter(Boolean);

  return { subject, body: lines.join("\n") };
}
