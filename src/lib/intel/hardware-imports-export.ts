import type { CensusPublicHardwareSnapshot } from "./research/census-public-hardware";
import {
  buildChinaWestCoastCorridorWatch,
  buildOceanHardwareRoutingResearchBrief,
  type CensusPublicOriginCorridorWatch,
  type OceanHardwareRoutingResearchBrief,
} from "./research/corridor-watch";
import {
  buildChinaUsCustomsDecisionGuide,
  type ChinaCustomsDecisionGuide,
} from "./research/china-customs-guide";

type HardwareImportsExportSession = {
  role: string;
};

const HARDWARE_IMPORTS_EXPORT_ROLES = new Set([
  "ADMIN",
  "MANAGER",
  "SALES",
]);

export type HardwareImportsExportDependencies = {
  requireSession: () => Promise<HardwareImportsExportSession>;
  getSnapshot: () => CensusPublicHardwareSnapshot;
};

export type ChinaCorridorWatchExport = {
  schemaVersion: 2;
  watch: CensusPublicOriginCorridorWatch;
  routingBrief: OceanHardwareRoutingResearchBrief;
  customsGuide: ChinaCustomsDecisionGuide;
};

async function authorizeExport(
  requireSession: HardwareImportsExportDependencies["requireSession"]
): Promise<Response | null> {
  let session: HardwareImportsExportSession;
  try {
    session = await requireSession();
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!HARDWARE_IMPORTS_EXPORT_ROLES.has(session.role)) {
    return new Response("Forbidden", { status: 403 });
  }
  return null;
}

export async function handleHardwareImportsExport(
  dependencies: HardwareImportsExportDependencies
): Promise<Response> {
  const denied = await authorizeExport(dependencies.requireSession);
  if (denied) return denied;

  const snapshot = dependencies.getSnapshot();

  return new Response(`${JSON.stringify(snapshot, null, 2)}\n`, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="derya-hardware-imports-${snapshot.asOfMonth}.json"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}

export async function handleChinaCorridorWatchExport(
  dependencies: HardwareImportsExportDependencies
): Promise<Response> {
  const denied = await authorizeExport(dependencies.requireSession);
  if (denied) return denied;

  const watch = buildChinaWestCoastCorridorWatch(dependencies.getSnapshot());
  const payload: ChinaCorridorWatchExport = {
    schemaVersion: 2,
    watch,
    routingBrief: buildOceanHardwareRoutingResearchBrief(watch),
    customsGuide: buildChinaUsCustomsDecisionGuide(),
  };

  return new Response(`${JSON.stringify(payload, null, 2)}\n`, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="derya-china-west-coast-watch-${watch.asOfMonth}.json"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}
