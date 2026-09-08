import type { SupplyAccessContext } from "@/lib/supply-os/persistence";
import type {
  SupplyStateDependency,
  SupplyStateProjectionType,
  SupplyStateScope,
  SupplyWorldEvidenceRef,
} from "@/lib/supply-os/state-runtime/types";

// Increment whenever semantic selectors or dependency coverage changes so an
// older projection can never masquerade as a packet built by the current
// compiler.
export const SUPPLY_STATE_COMPILER_VERSION = "supply-world-state-v1.2";

export type SupplyStateProjectionPayload = {
  currentState: Record<string, unknown>;
  derivedState: Record<string, unknown>;
  openLoops: Array<Record<string, unknown>>;
  uncertainties: Array<Record<string, unknown>>;
};

export type SupplyStateProjectionSnapshot = {
  id: string | null;
  scope: SupplyStateScope;
  projectionType: SupplyStateProjectionType;
  compilerVersion: string;
  sourceFingerprint: string;
  payload: SupplyStateProjectionPayload;
  payloadHash: string;
  evidenceRefs: SupplyWorldEvidenceRef[];
  dependencies: SupplyStateDependency[];
  builtAt: string;
  dirtyAt: string | null;
  projectionHit: boolean;
  sourceCounts: Record<string, number>;
  timingsMs: Record<string, number>;
};

export type SupplyStateProjectionBuild = Omit<
  SupplyStateProjectionSnapshot,
  "id" | "dirtyAt" | "projectionHit"
> & {
  hadReaderFailure: boolean;
};

export type SupplyStateProjectionRequest = {
  scope: SupplyStateScope;
  access?: SupplyAccessContext | null;
  compilerVersion?: string;
};

export function projectionTypeForSupplyStateScope(
  scope: SupplyStateScope,
): SupplyStateProjectionType {
  if (scope.type === "company") return "company_context_v1";
  if (scope.type === "procurement_request") return "procurement_request_v1";
  if (scope.type === "supplier") return "supplier_relationship_v1";
  if (scope.type === "item") return "item_supply_v1";
  return "workspace_supply_v1";
}
