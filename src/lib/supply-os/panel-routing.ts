export const SUPPLY_OS_PANELS = ["materials", "suppliers", "scenarios", "logistics", "tracking"] as const;

export type SupplyOsPanel = (typeof SUPPLY_OS_PANELS)[number];

export function normalizeSupplyOsPanel(value: string | null | undefined): SupplyOsPanel {
  return SUPPLY_OS_PANELS.includes(value as SupplyOsPanel) ? value as SupplyOsPanel : "materials";
}

export function supplyOsPanelHref(currentHref: string, panel: SupplyOsPanel): string {
  const url = new URL(currentHref, "https://supply-os.local");
  if (panel === "materials") url.searchParams.delete("panel");
  else url.searchParams.set("panel", panel);
  return `${url.pathname}${url.search}${url.hash}`;
}
