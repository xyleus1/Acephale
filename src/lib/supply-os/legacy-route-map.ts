import type { SupplyOsPanel } from "./panel-routing";

type LegacyRouteRule = {
  route: string;
  panel: SupplyOsPanel;
};

const LEGACY_ROUTE_RULES: LegacyRouteRule[] = [
  { route: "/dashboard/domestic-pricing", panel: "logistics" },
  { route: "/dashboard/supplier-finder", panel: "suppliers" },
  { route: "/dashboard/intelligence", panel: "scenarios" },
  { route: "/dashboard/outreach", panel: "suppliers" },
  { route: "/dashboard/pricing", panel: "scenarios" },
  { route: "/dashboard/reports", panel: "scenarios" },
  { route: "/dashboard/carriers", panel: "logistics" },
  { route: "/dashboard/activity", panel: "tracking" },
  { route: "/dashboard/search", panel: "materials" },
  { route: "/dashboard/market", panel: "scenarios" },
  { route: "/dashboard/brain", panel: "scenarios" },
  { route: "/dashboard/intel", panel: "scenarios" },
  { route: "/dashboard/inbox", panel: "tracking" },
  { route: "/dashboard/loads", panel: "logistics" },
  { route: "/dashboard/jobs", panel: "logistics" },
  { route: "/dashboard/rfq", panel: "suppliers" },
  { route: "/dashboard/crm", panel: "materials" },
];

const WORKSTREAM_PANELS: Record<string, SupplyOsPanel> = {
  procurement: "suppliers",
  "supplier-outreach": "suppliers",
  "shipment-planning": "logistics",
  customs: "logistics",
  fulfillment: "tracking",
};

function matchesRoute(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

function destination(pathname: string, search: string, panel: SupplyOsPanel) {
  const params = new URLSearchParams(search);
  params.set("panel", panel);
  params.set("legacyPath", pathname);
  return `/dashboard/supply-os?${params.toString()}`;
}

export function legacySupplyOsDestination(pathname: string, search = "") {
  if (pathname === "/dashboard/supply-os/new") {
    return destination(pathname, search, "materials");
  }

  const workstreamMatch = pathname.match(/^\/dashboard\/supply-os\/workstreams\/([^/]+)\/?$/);
  if (workstreamMatch) {
    return destination(
      pathname,
      search,
      WORKSTREAM_PANELS[workstreamMatch[1] ?? ""] ?? "materials",
    );
  }

  const rule = LEGACY_ROUTE_RULES.find((candidate) => matchesRoute(pathname, candidate.route));
  return rule ? destination(pathname, search, rule.panel) : null;
}
