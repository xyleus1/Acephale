import {registerHooks} from "node:module";import {readFileSync,realpathSync} from "node:fs";import {createHash} from "node:crypto";import {fileURLToPath,pathToFileURL} from "node:url";
const raw=readFileSync(process.env.ACEPHALE_BUDGET_RPC_CONFIG);if(createHash("sha256").update(raw).digest("hex")!==process.env.ACEPHALE_BUDGET_RPC_SHA256)throw Error("Exact budget RPC configuration required");
const c=JSON.parse(raw);const targets=new Map(c.redirectTargets.map(r=>[realpathSync(r.path),r.sha256]));
if(createHash("sha256").update(readFileSync(c.client.path)).digest("hex")!==c.client.sha256)throw Error("Budget client changed");
registerHooks({resolve(specifier,context,next){const r=next(specifier,context);if(r.url.startsWith("file:")){const p=fileURLToPath(r.url);if(targets.has(p)){if(createHash("sha256").update(readFileSync(p)).digest("hex")!==targets.get(p))throw Error("Original financial source changed");return {...r,url:pathToFileURL(c.client.path).href,format:"module"};}}return r;}});
