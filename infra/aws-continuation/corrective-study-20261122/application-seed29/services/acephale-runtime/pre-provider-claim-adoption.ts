import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { hash } from "../../src/lib/acephale/canonical";

const DISPOSITION_SHA = "05472d3019e79a2e0fb9a62252b2ee2bcb315e22aec45a25ca2356507130703e";
const PARTICIPANT = "corrective-development-1-20261122-01:segment-1";
function requireFact(value: unknown, reason: string): asserts value {
  if (!value) throw new Error("Pre-provider claim adoption rejected: " + reason);
}
function pinned(ref: {path:string;sha256:string}, expected: string) {
  requireFact(ref && ref.sha256 === expected && typeof ref.path === "string", "proof identity");
  const bytes = readFileSync(ref.path);
  requireFact(createHash("sha256").update(bytes).digest("hex") === expected, "proof bytes");
  return JSON.parse(bytes.toString("utf8"));
}
/** Explicit, read-only adoption of the one acknowledged pre-provider startup claim.
 * Normal invocations retain the original duplicate rejection. No ledger mutation. */
export function adoptPreProviderClaims(receipt:any, runIds:string[], snapshot:any[],
 parentId:(id:string)=>string, claimId:(id:string)=>string): boolean {
 const path = process.env.ACEPHALE_PRE_PROVIDER_CLAIM_ADOPTION_FILE;
 if (!path) return false;
 const d = pinned({path,sha256:DISPOSITION_SHA},DISPOSITION_SHA);
 requireFact(process.env.ACEPHALE_BUDGET_RPC_PARTICIPANT === PARTICIPANT, "participant");
 requireFact(d.attemptId === "corrective-development-1-20261122-01" &&
   d.unitId === "corrective/development/1" &&
   d.inputSha256 === "40b63e4f60ae8eec740ec8ea4eb3b3dffd48497bb24cde467f3b433326d8e9e7",
   "same assignment");
 requireFact(d.actorDecisionsObserved === 0 && d.providerCallsObserved === 0 &&
   d.serviceReadyRows === 0 && d.publicBoundaryBytes === 0 &&
   d.ownedProcessesDrained === true && d.financialClaimAlreadyCommitted === true &&
   d.originalOutcomeRowsUnmodified === true && d.unknownChargeFlagsPreserved === true &&
   d.cohortCompleted === false && d.workerExecutionCompleted === false, "pre-provider boundary");
 const original = pinned({path:"/REQUIRED_BINDINGS/research-root/workspaces/operator/corrective-continuation-01/reservations/development-20261122-01/reservation.json",
   sha256:"e45a420a3d6bdab1bc59e00efa95c052d43edf10cfff45a6b2e19607eb056ad2"},
   "e45a420a3d6bdab1bc59e00efa95c052d43edf10cfff45a6b2e19607eb056ad2");
 requireFact(hash(receipt) === hash(original) && hash(runIds) === hash(original.plan.segments[0]) &&
   runIds.length === 18, "same reservation, plan, segment and order");
 const request = pinned(d.financialClaimRequest,"542ec2ac4df55b7b3b547e13113d93f48203c578e9434e04db758026ad6fedc8");
 const ack = pinned(d.financialClaimAcknowledgement,"3c690804c453abf91fc87d37979b6aeb563877b7361b71616b75d505d68ac270");
 const markers = runIds.map(id=>({id:claimId(id),allocation:original.plan.hosted.allocation,maximum:0}));
 requireFact(request.action === "ledger.reserveMany" && request.participant === PARTICIPANT &&
   request.sessionId === d.rpcSessionId && ack.id === request.id && ack.ok === true &&
   hash(request.args) === hash([markers]) && hash(d.financialClaimMarkers) === hash(markers),
   "exact acknowledged zero markers");
 const entries = new Map(snapshot.map(entry=>[entry.id,entry]));
 requireFact(entries.size === snapshot.length, "duplicate snapshot ids");
 for (const id of runIds) {
   const parent = entries.get(parentId(id)), marker = entries.get(claimId(id));
   requireFact(parent && !parent.parentId && parent.actual === undefined &&
     parent.maximum === original.plan.hosted.maxCostMicrodollarsPerRun &&
     parent.allocation === original.plan.hosted.allocation &&
     !snapshot.some(e=>e.parentId === parentId(id)), "parent consumed or changed");
   requireFact(marker && !marker.parentId && marker.actual === undefined &&
     marker.maximum === 0 && marker.allocation === original.plan.hosted.allocation &&
     !snapshot.some(e=>e.parentId === claimId(id)), "marker consumed or changed");
 }
 return true;
}
