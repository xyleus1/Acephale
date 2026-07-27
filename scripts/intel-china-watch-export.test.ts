import assert from "node:assert/strict";
import snapshotJson from "../src/lib/intel/research/generated/census-public-hardware-v1.json";
import {
  handleChinaCorridorWatchExport,
  type ChinaCorridorWatchExport,
} from "../src/lib/intel/hardware-imports-export";
import {
  validateCensusPublicHardwareSnapshot,
  type CensusPublicHardwareSnapshot,
} from "../src/lib/intel/research/census-public-hardware";

const snapshot = validateCensusPublicHardwareSnapshot(
  snapshotJson as CensusPublicHardwareSnapshot
);

async function main() {
  let deniedSnapshotReads = 0;
  const getDeniedSnapshot = () => {
    deniedSnapshotReads += 1;
    return snapshot;
  };

  const anonymousResponse = await handleChinaCorridorWatchExport({
    requireSession: async () => {
      throw new Error("No session");
    },
    getSnapshot: getDeniedSnapshot,
  });
  assert.equal(anonymousResponse.status, 401);

  const unknownRoleResponse = await handleChinaCorridorWatchExport({
    requireSession: async () => ({ role: "EMPLOYEE" }),
    getSnapshot: getDeniedSnapshot,
  });
  assert.equal(unknownRoleResponse.status, 403);

  const customerResponse = await handleChinaCorridorWatchExport({
    requireSession: async () => ({ role: "CUSTOMER" }),
    getSnapshot: getDeniedSnapshot,
  });
  assert.equal(customerResponse.status, 403);
  assert.equal(
    deniedSnapshotReads,
    0,
    "denied requests do not read or derive the watch artifact"
  );

  for (const role of ["ADMIN", "MANAGER", "SALES"]) {
    const allowedResponse = await handleChinaCorridorWatchExport({
      requireSession: async () => ({ role }),
      getSnapshot: () => snapshot,
    });
    assert.equal(allowedResponse.status, 200, `${role} can export the watch`);
  }

  const authorizedResponse = await handleChinaCorridorWatchExport({
    requireSession: async () => ({ role: "ADMIN" }),
    getSnapshot: () => snapshot,
  });
  assert.equal(
    authorizedResponse.headers.get("content-type"),
    "application/json; charset=utf-8"
  );
  assert.equal(
    authorizedResponse.headers.get("content-disposition"),
    'attachment; filename="derya-china-west-coast-watch-2026-05.json"'
  );
  assert.equal(
    authorizedResponse.headers.get("cache-control"),
    "private, max-age=300"
  );

  const body = await authorizedResponse.text();
  assert.ok(body.endsWith("\n"));
  const payload = JSON.parse(body) as ChinaCorridorWatchExport;
  assert.equal(payload.schemaVersion, 2);
  assert.equal(payload.watch.originCountryName, "China");
  assert.equal(payload.watch.routeReadiness, "research_only");
  assert.equal(
    payload.watch.fixedBasketOriginHistory?.completeYears.length,
    16
  );
  assert.equal(
    payload.watch.fixedBasketOriginHistory?.completeYears[0]
      .westCoastGateways.metrics?.vesselValueUsd,
    45_360_375_377
  );
  assert.equal(payload.watch.sources.length, 35);
  assert.equal(payload.watch.currentCategoryGatewaySegmentCount, 23);
  assert.equal(
    payload.watch.currentYtd.westCoastGateways.metrics?.vesselValueUsd,
    8_890_123_614
  );
  assert.equal(payload.routingBrief.routeReadiness, "research_only");
  assert.equal(payload.routingBrief.categoryResearch.length, 5);
  assert.equal(payload.customsGuide.kind, "china_us_customs_decision_guide");
  assert.equal(payload.customsGuide.gates.length, 8);
  assert.equal(payload.customsGuide.readiness.landedCost, "not_assessable");
  assert.equal(
    payload.customsGuide.authorities.every(
      (authority) => authority.source.reviewedAt != null
    ),
    true,
    "the export preserves reviewed official customs authority"
  );
  assert.doesNotMatch(
    body,
    /\b(best gateway|recommended route)\b/i,
    "the export remains a research brief instead of a route recommendation"
  );

  console.log(
    JSON.stringify({
      ok: true,
      anonymousStatus: anonymousResponse.status,
      unknownRoleStatus: unknownRoleResponse.status,
      customerStatus: customerResponse.status,
      authorizedStatus: authorizedResponse.status,
      origin: payload.watch.originCountryName,
      segmentCount: payload.watch.currentCategoryGatewaySegmentCount,
    })
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
