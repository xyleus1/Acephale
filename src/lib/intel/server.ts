import "server-only";

import censusPublicHardwareSnapshot from "./research/generated/census-public-hardware-v1.json";
import {
  validateCensusPublicHardwareSnapshot,
  type CensusPublicHardwareSnapshot,
} from "./research/census-public-hardware";

let validatedCensusPublicHardwareSnapshot: CensusPublicHardwareSnapshot | null = null;

export function getCensusPublicHardwareSnapshot(): CensusPublicHardwareSnapshot {
  validatedCensusPublicHardwareSnapshot ??= validateCensusPublicHardwareSnapshot(
    censusPublicHardwareSnapshot as CensusPublicHardwareSnapshot
  );
  return validatedCensusPublicHardwareSnapshot;
}

// Public server-only Intel entrypoint. Route actions and server components use
// this module instead of reaching into implementation leaves.

export { extractLoadIdea } from "./preflight/extract";
export { extractChinaHardwareLoad } from "./preflight/extract-china-import";
export { enrichLoadCheck } from "./preflight/enrich";
export {
  fetchMarketBaseline,
  formatUsdCompact,
} from "./market/indicators";

export {
  getImportGeniusPublicPreviewEvidence,
  IMPORTGENIUS_PUBLIC_PREVIEW_CHECKED_DATE,
  IMPORTGENIUS_PUBLIC_PREVIEW_EVIDENCE,
} from "./research/company-evidence";

export {
  handleChinaCorridorWatchExport,
  handleHardwareImportsExport,
  type ChinaCorridorWatchExport,
  type HardwareImportsExportDependencies,
} from "./hardware-imports-export";

export {
  buildChinaWestCoastCorridorWatch,
  buildOceanHardwareRoutingResearchBrief,
} from "./research/corridor-watch";

export { buildChinaUsCustomsDecisionGuide } from "./research/china-customs-guide";

export {
  buildCensusOceanSourceUrl,
  CENSUS_OCEAN_HARDWARE_MAX_FETCH_WALL_CLOCK_MS,
  CENSUS_OCEAN_HARDWARE_QUERY_PARTITIONS,
  parseCensusOceanTable,
  resolveCensusOceanHardwareSnapshot,
  type CensusOceanHardwareCoverage,
  type CensusOceanHardwarePartitionId,
  type CensusOceanHardwareRow,
  type CensusOceanHardwareScopeResult,
  type CensusOceanHardwareSnapshot,
  type CensusOceanQueryFailure,
  type CensusOceanQueryFailureCode,
  type ResolveCensusOceanHardwareSnapshotInput,
} from "./research/census-ocean";
