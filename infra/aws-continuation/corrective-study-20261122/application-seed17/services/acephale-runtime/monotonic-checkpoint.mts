import {hash} from "/REQUIRED_BINDINGS/research-root/workspaces/operator/science-source/src/lib/acephale/canonical.ts";
export function validateMonotonicLedgerCheckpoint(value:any, owner:any, ledgerPath:string){
 const c=value, live=owner.ledger.snapshot(), recovery=owner.recovery;
 if(!c||c.version!==1||c.ledgerPathHash!==hash(ledgerPath)||!Array.isArray(c.entries)||c.entriesHash!==hash(c.entries))throw Error("Frozen original checkpoint identity differs");
 if(!recovery||typeof recovery.checkpointUsed!=="boolean"||!Number.isSafeInteger(recovery.verifiedPrefixBytes)||recovery.verifiedPrefixBytes<0||!Number.isSafeInteger(recovery.replayedRecords)||recovery.replayedRecords<0)throw Error("Original journal recovery evidence absent");
 if(!Array.isArray(live))throw Error("Original journal snapshot absent");
 const valid=(r:any)=>r&&typeof r.id==="string"&&typeof r.allocation==="string"&&Number.isSafeInteger(r.maximum)&&r.maximum>=0&&(r.actual===undefined||(Number.isSafeInteger(r.actual)&&r.actual>=0&&r.actual<=r.maximum));
 if(c.entries.some((r:any)=>!valid(r))||live.some((r:any)=>!valid(r)))throw Error("Original reservation shape differs");
 const prior=new Map(c.entries.map((r:any)=>[r.id,r])), current=new Map(live.map((r:any)=>[r.id,r]));
 if(prior.size!==c.entries.length||current.size!==live.length)throw Error("Duplicate original reservation identity");
 const settlements:any[]=[];
 for(const p of c.entries){
  const n:any=current.get(p.id);if(!n)throw Error("Prior original reservation disappeared");
  const {actual:pa,...pb}=p,{actual:na,...nb}=n;
  if(hash(pb)!==hash(nb))throw Error("Prior original reservation binding changed");
  if(pa!==undefined&&na!==pa)throw Error("Prior settled actual changed");
  if(pa===undefined&&na!==undefined)settlements.push({id:p.id,maximum:p.maximum,actual:na});
 }
 const additions=live.filter((r:any)=>!prior.has(r.id));
 return {kind:"goalspec-unvalidated-monotonic-checkpoint-compatibility-v1",unvalidated:true,baselineDocumentHash:hash(c),baselineEntriesHash:c.entriesHash,observedEntriesHash:hash(live),ledgerPathHash:c.ledgerPathHash,baselineReservations:c.entries.length,observedReservations:live.length,exactHistoricalSnapshot:hash(live)===c.entriesHash,verifiedByOriginalOwner:recovery,journalValidation:"Original source-bound owner verifies checkpoint byte prefix and every subsequent journal-chain record; this adapter verifies reservation ancestry",newReservations:additions,newlySettledPriorReservations:settlements,priorUnknownStillHeld:c.entries.filter((r:any)=>r.actual===undefined&&current.get(r.id)?.actual===undefined).map((r:any)=>r.id),reservationMaximumsChanged:false,globalLimitsChanged:false,unknownReservationsReset:false};
}
