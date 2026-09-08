import "server-only";

import { prisma } from "@/lib/prisma";
import type { SupplyWorldEvidenceRef } from "@/lib/supply-os/state-runtime/types";
import {
  boundSupplyStateValue,
  emptySupplyStateReaderResult,
  makeSupplyStateDependency,
  safeIso,
  type SupplyStateReaderInput,
  type SupplyStateReaderResult,
} from "./types";
import { workspaceIdForStateScope } from "./workspace-snapshot";
import {
  planningResultListValue,
  workspaceIdentityValue,
  workspacePresentationValue,
} from "./selectors";

type PlanningReaderDependencies = {
  findWorkspace: typeof prisma.supplyWorkspace.findFirst;
  findSnapshot: typeof prisma.supplySnapshot.findFirst;
  findPlanningResults: typeof prisma.supplyPlanningResult.findMany;
};

const defaultDependencies: PlanningReaderDependencies = {
  findWorkspace: (args) => prisma.supplyWorkspace.findFirst(args),
  findSnapshot: (args) => prisma.supplySnapshot.findFirst(args),
  findPlanningResults: (args) => prisma.supplyPlanningResult.findMany(args),
};

export async function readPlanningState(
  input: SupplyStateReaderInput,
  dependencies: PlanningReaderDependencies = defaultDependencies,
): Promise<SupplyStateReaderResult> {
  const workspaceId = workspaceIdForStateScope(input.scope);
  if (!workspaceId) return emptySupplyStateReaderResult();
  const result = emptySupplyStateReaderResult();
  const workspace = await dependencies.findWorkspace({
    where: { id: workspaceId, officeId: input.scope.officeId, status: "ACTIVE" },
    select: {
      id: true,
      companyId: true,
      externalKey: true,
      name: true,
      status: true,
      version: true,
      archivedAt: true,
    },
  });
  if (!workspace) {
    result.dependencies.push(makeSupplyStateDependency({
      key: `workspace.identity:${workspaceId}`,
      source: "APP_DB",
      entityType: "SupplyWorkspace",
      entityRef: workspaceId,
      value: null,
      policy: "STRICT",
      reason: "The planning workspace is missing or inactive.",
    }));
    return result;
  }
  result.dependencies.push(
    makeSupplyStateDependency({
      key: `workspace.identity:${workspaceId}`,
      source: "APP_DB",
      entityType: "SupplyWorkspace",
      entityRef: workspaceId,
      value: workspaceIdentityValue(workspace),
      policy: "STRICT",
      reason: "The planning workspace ownership or lifecycle changed.",
    }),
    makeSupplyStateDependency({
      key: `workspace.presentation:${workspaceId}`,
      source: "APP_DB",
      entityType: "SupplyWorkspace",
      entityRef: workspaceId,
      value: workspacePresentationValue(workspace),
      policy: "ADVISORY",
      reason: "The planning workspace presentation changed.",
    }),
  );
  const [snapshot, rows] = await Promise.all([
    dependencies.findSnapshot({
      where: { officeId: input.scope.officeId, workspaceId, status: "PUBLISHED" },
      orderBy: [{ version: "desc" }, { id: "desc" }],
      select: { id: true, version: true, sourceHash: true, publishedAt: true },
    }),
    dependencies.findPlanningResults({
      where: { officeId: input.scope.officeId, workspaceId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 10,
      select: {
        id: true,
        snapshotId: true,
        engineVersion: true,
        snapshotHash: true,
        normalizedInputHash: true,
        assumptions: true,
        unknowns: true,
        evidenceReferences: true,
        output: true,
        outputHash: true,
        createdAt: true,
      },
    }),
  ]);
  const evidenceRefs: SupplyWorldEvidenceRef[] = rows.map((row) => ({
    kind: "planning_result" as const,
    id: row.id,
    outputHash: row.outputHash,
  }));
  result.evidenceRefs.push(...evidenceRefs);
  result.dependencies.push(makeSupplyStateDependency({
    key: `planning.latest_results:${workspaceId}`,
    source: "APP_DB",
    entityType: "SupplyPlanningResultList",
    entityRef: workspaceId,
    value: planningResultListValue(rows),
    policy: "ADVISORY",
    reason: "The bounded latest deterministic planning-result list changed.",
    evidenceRefs,
  }));
  for (const row of rows) {
    result.dependencies.push(makeSupplyStateDependency({
      key: `planning.result:${row.id}`,
      source: "APP_DB",
      entityType: "SupplyPlanningResult",
      entityRef: row.id,
      value: {
        outputHash: row.outputHash,
        snapshotHash: row.snapshotHash,
        normalizedInputHash: row.normalizedInputHash,
      },
      version: row.outputHash,
      policy: "ADVISORY",
      reason: "A deterministic planning result used by this state packet changed.",
      evidenceRefs: evidenceRefs.filter((reference) => reference.id === row.id),
    }));
  }
  result.derivedState.planning = rows.map((row) => ({
    id: row.id,
    snapshotId: row.snapshotId,
    engineVersion: row.engineVersion,
    snapshotHash: row.snapshotHash,
    normalizedInputHash: row.normalizedInputHash,
    outputHash: row.outputHash,
    isStale: !snapshot || snapshot.id !== row.snapshotId,
    assumptions: boundSupplyStateValue(row.assumptions, { maxArray: 40, maxString: 1_000 }),
    unknowns: boundSupplyStateValue(row.unknowns, { maxArray: 40, maxString: 1_000 }),
    evidenceReferences: boundSupplyStateValue(row.evidenceReferences, { maxArray: 80, maxString: 500 }),
    output: boundSupplyStateValue(row.output, { maxArray: 50, maxString: 2_000 }),
    createdAt: safeIso(row.createdAt),
  }));
  if (rows.some((row) => !snapshot || row.snapshotId !== snapshot.id)) {
    result.uncertainties.push({
      kind: "stale_supply_planning_results_present",
      currentSnapshotId: snapshot?.id ?? null,
      staleCount: rows.filter((row) => !snapshot || row.snapshotId !== snapshot.id).length,
    });
  }
  result.sourceCounts = { supplyPlanningResults: rows.length };
  return result;
}
