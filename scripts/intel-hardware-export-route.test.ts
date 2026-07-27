import assert from "node:assert/strict";
import snapshotJson from "../src/lib/intel/research/generated/census-public-hardware-v1.json";
import { handleHardwareImportsExport } from "../src/lib/intel/hardware-imports-export";
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

  const anonymousResponse = await handleHardwareImportsExport({
    requireSession: async () => {
      throw new Error("No session");
    },
    getSnapshot: getDeniedSnapshot,
  });
  assert.equal(anonymousResponse.status, 401, "anonymous export requests return 401");
  assert.equal(await anonymousResponse.text(), "Unauthorized");

  const unknownRoleResponse = await handleHardwareImportsExport({
    requireSession: async () => ({ role: "EMPLOYEE" }),
    getSnapshot: getDeniedSnapshot,
  });
  assert.equal(unknownRoleResponse.status, 403, "unknown roles return 403");
  assert.equal(await unknownRoleResponse.text(), "Forbidden");

  const customerResponse = await handleHardwareImportsExport({
    requireSession: async () => ({ role: "CUSTOMER" }),
    getSnapshot: getDeniedSnapshot,
  });
  assert.equal(customerResponse.status, 403, "customer roles return 403");
  assert.equal(await customerResponse.text(), "Forbidden");
  assert.equal(
    deniedSnapshotReads,
    0,
    "denied requests do not load the export artifact"
  );

  for (const role of ["ADMIN", "MANAGER", "SALES"]) {
    const allowedResponse = await handleHardwareImportsExport({
      requireSession: async () => ({ role }),
      getSnapshot: () => snapshot,
    });
    assert.equal(allowedResponse.status, 200, `${role} export requests return 200`);
  }

  const authorizedResponse = await handleHardwareImportsExport({
    requireSession: async () => ({ role: "ADMIN" }),
    getSnapshot: () => snapshot,
  });
  assert.equal(
    authorizedResponse.headers.get("content-type"),
    "application/json; charset=utf-8"
  );
  assert.equal(
    authorizedResponse.headers.get("content-disposition"),
    `attachment; filename="derya-hardware-imports-${snapshot.asOfMonth}.json"`
  );
  assert.equal(
    authorizedResponse.headers.get("cache-control"),
    "private, max-age=300"
  );

  const body = await authorizedResponse.text();
  assert.ok(body.endsWith("\n"), "the JSON attachment ends with a newline");
  const exportedSnapshot = JSON.parse(body) as CensusPublicHardwareSnapshot;
  assert.deepEqual(
    exportedSnapshot,
    snapshot,
    "the authorized response exports the complete validated snapshot"
  );
  assert.equal(exportedSnapshot.schemaVersion, 4);
  assert.ok(
    exportedSnapshot.currentWestCoastCorridors.positiveVesselSegments.length > 0,
    "the schema-v4 export includes current gateway corridor data"
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        anonymousStatus: anonymousResponse.status,
        unknownRoleStatus: unknownRoleResponse.status,
        customerStatus: customerResponse.status,
        authorizedStatus: authorizedResponse.status,
        schemaVersion: exportedSnapshot.schemaVersion,
        corridorCount:
          exportedSnapshot.currentWestCoastCorridors.positiveVesselSegments.length,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
