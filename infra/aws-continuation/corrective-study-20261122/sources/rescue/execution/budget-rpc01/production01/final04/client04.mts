import {readFileSync,writeFileSync,openSync,closeSync,fsyncSync,renameSync,existsSync} from "node:fs";import {join} from "node:path";import {randomUUID,createHash} from "node:crypto";
const sha=(x:any)=>createHash("sha256").update(x).digest("hex");
const cfgPath=process.env.ACEPHALE_BUDGET_RPC_CONFIG,expected=process.env.ACEPHALE_BUDGET_RPC_SHA256,participant=process.env.ACEPHALE_BUDGET_RPC_PARTICIPANT;
if(!cfgPath||!expected||!participant)throw Error("Explicit original budget broker binding required");
const raw=readFileSync(cfgPath);if(sha(raw)!==expected)throw Error("Budget broker binding changed");const cfg=JSON.parse(raw.toString());
if(cfg.constructorProtocol!=="exact-path-only-v1")throw Error("Exact path-only constructor binding required");
if(cfg.sessionProtocol!=="per-instance-v1")throw Error("Per-instance session protocol required");
if(!cfg.participants.includes(participant))throw Error("Unknown budget participant");
const wait=new Int32Array(new SharedArrayBuffer(4));
function call(sessionId:string,action:string,args:any[]=[]){const id=randomUUID(),base=join(cfg.queueRoot,id),q={version:2,id,participant,sessionId,action,args};const responseFd=openSync(base+".result.json","wx",0o600);try{writeFileSync(responseFd,JSON.stringify({id,pending:true})+"\n");fsyncSync(responseFd);}finally{closeSync(responseFd);}const f=openSync(base+".pending-request","wx",0o600);
 try{writeFileSync(f,JSON.stringify(q)+"\n");fsyncSync(f);}finally{closeSync(f);}renameSync(base+".pending-request",base+".request.json");
 const until=Date.now()+120000;let r:any;while(true){r=JSON.parse(readFileSync(base+".result.json","utf8"));if(r.id!==id)throw Error("Budget response mismatch");if(r.pending!==true)break;if(existsSync(join(cfg.queueRoot,"TERMINAL.json")))throw Error("Original budget owner ended; request not retried");if(Date.now()>until)throw Error("Original budget result unobserved; request not retried");Atomics.wait(wait,0,0,10);}
 if(r.id!==id)throw Error("Budget response mismatch");if(!r.ok){const e=new Error(r.error.message);e.name=r.error.name;throw e;}return r.value;
}
export class DurableBudget {readonly ledger:any;readonly policy:any;readonly recovery:any;readonly infrastructureFunding:any;private closed=false;private readonly sessionId=randomUUID();
 constructor(path:string,...unsupported:any[]){if(arguments.length!==1)throw Error("Budget constructor options are incompatible with the original path-only owner");if(path!==cfg.journalPath)throw Error("Exact original journal required");const m=call(this.sessionId,"open");this.policy=m.policy;this.recovery=m.recovery;this.infrastructureFunding=m.infrastructureFunding;
 this.ledger={allocations:m.allocations,totalCeilingMicrodollars:m.totalCeilingMicrodollars};for(const name of ["snapshot","remaining","reserve","reserveMany","reserveChild","settle","finishParent"])this.ledger[name]=(...args:any[])=>{if(this.closed)throw Error("Budget instance is closed");return call(this.sessionId,"ledger."+name,args);};}
 validateManifestPolicy(...args:any[]){if(this.closed)throw Error("Budget instance is closed");return call(this.sessionId,"validateManifestPolicy",args);}
 close(){if(!this.closed){call(this.sessionId,"close");this.closed=true;}}
}
