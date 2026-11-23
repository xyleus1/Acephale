import {registerHooks} from "node:module";
import {readFileSync,writeFileSync,openSync,writeSync,fsyncSync,closeSync,mkdirSync,realpathSync} from "node:fs";
import {createHash,randomUUID} from "node:crypto";
import {fileURLToPath,pathToFileURL} from "node:url";
import {resolve,join} from "node:path";
const routes=[{"seed": 29, "script": {"path": "/REQUIRED_BINDINGS/research-root/workspaces/review/corrective-qualified-inputs-03/seed29-first01/application/scripts/acephale-infra-native-profile.ts", "sha256": "4d7aa9221b955e7a5721f09bc8890bf80771da46d912f0b6d9725108dfcff1c5", "bytes": 25279}, "durable": {"path": "/REQUIRED_BINDINGS/research-root/workspaces/review/corrective-qualified-inputs-03/seed29-first01/application/services/acephale-runtime/durable-budget.ts", "sha256": "f5cd1d9614a8afd31009f5099a4340d5b02b211977fb686db83e10e03d697e2d", "bytes": 13679}, "hosted": {"path": "/REQUIRED_BINDINGS/research-root/workspaces/review/corrective-qualified-inputs-03/seed29-first01/application/services/acephale-runtime/infra-hosted-workers.ts", "sha256": "36ee4517a960a4e7de9af6521f9ce3fe2ab64a8dd701a8a1dd80f27478a61d21", "bytes": 6713}, "budget": {"path": "/REQUIRED_BINDINGS/research-root/workspaces/review/corrective-profile-rpc-01/profile-budget.mts", "sha256": "d5930627787dcf5780b728cefb7c063a66f3dc19fd6097d29dac5b6abc12f1be", "bytes": 418}, "proxy": {"path": "/REQUIRED_BINDINGS/research-root/workspaces/review/corrective-profile-rpc-01/checkpoint-proxy-seed29.mts", "sha256": "398027288c27448c480a8749a7abfe725df40f97e5b002eb631857223d145094", "bytes": 1025}}, {"seed": 17, "script": {"path": "/REQUIRED_BINDINGS/research-root/workspaces/operator/corrective-seed17-qualification-01/restored-success03/application/scripts/acephale-infra-native-profile.ts", "sha256": "4d7aa9221b955e7a5721f09bc8890bf80771da46d912f0b6d9725108dfcff1c5", "bytes": 25279}, "durable": {"path": "/REQUIRED_BINDINGS/research-root/workspaces/operator/corrective-seed17-qualification-01/restored-success03/application/services/acephale-runtime/durable-budget.ts", "sha256": "f5cd1d9614a8afd31009f5099a4340d5b02b211977fb686db83e10e03d697e2d", "bytes": 13679}, "hosted": {"path": "/REQUIRED_BINDINGS/research-root/workspaces/operator/corrective-seed17-qualification-01/restored-success03/application/services/acephale-runtime/infra-hosted-workers.ts", "sha256": "36ee4517a960a4e7de9af6521f9ce3fe2ab64a8dd701a8a1dd80f27478a61d21", "bytes": 6713}, "budget": {"path": "/REQUIRED_BINDINGS/research-root/workspaces/review/corrective-profile-rpc-01/profile-budget.mts", "sha256": "d5930627787dcf5780b728cefb7c063a66f3dc19fd6097d29dac5b6abc12f1be", "bytes": 418}, "proxy": {"path": "/REQUIRED_BINDINGS/research-root/workspaces/review/corrective-profile-rpc-01/checkpoint-proxy-seed17.mts", "sha256": "d251fae3ee977907019c6139f677935f3de4287ac1a811e5a339ca7d5d2ecaff", "bytes": 1035}}];
const check=r=>{if(createHash("sha256").update(readFileSync(r.path)).digest("hex")!==r.sha256)throw Error("Exact profile operational source changed: "+r.path);};
const url=p=>pathToFileURL(p).href;
registerHooks({resolve(specifier,context,next){
 const result=next(specifier,context);
 if(!result.url.startsWith("file:"))return result;
 const path=fileURLToPath(result.url);
 if(path==="/REQUIRED_BINDINGS/research-root/workspaces/report/corrective-native-plumbing-02/durable-budget-rpc-alias.ts"){check({"path": "/REQUIRED_BINDINGS/research-root/workspaces/report/corrective-native-plumbing-02/durable-budget-rpc-alias.ts", "sha256": "08deb51aaa430d11b6f85a73885ab85b45bca16f1af853a88821d75ce9affbc6"});return {...result,format:"module"};}
 for(const row of routes){
  if(context.parentURL===url(row.script.path)&&path===row.durable.path){
   check(row.script);check(row.durable);check(row.budget);return {...result,url:url(row.budget.path),format:"module"};
  }
  if(context.parentURL===url(row.script.path)&&path===row.hosted.path){
   check(row.script);check(row.hosted);check(row.proxy);return {...result,url:url(row.proxy.path),format:"module"};
  }
 }
 return result;
}});
const main=process.argv[1]&&resolve(process.argv[1]);
const selected=routes.find(row=>row.script.path===main);
if(selected&&process.argv[2]==="prepare"){
 check(selected.script);
 const logRoot=process.env.ACEPHALE_PROFILE_PREPARE_LOG_ROOT;
 if(!logRoot||!/^\/srv\/acephale\/artifacts\/(corrective-profile-prepare-logs\/seed(17|29)|corrective-prospective80-seed(17|29)-20261122-01-runtime[0-9]{2}\/node-prepare-logs)$/.test(logRoot))throw Error("Exact private prepare log root required");
 const dir=join(logRoot,process.pid+"-"+randomUUID());mkdirSync(dir,{recursive:true,mode:0o700});
 process.env.ACEPHALE_PROFILE_PREPARE_ACTIVE_LOG=dir;
 const configuration=resolve(process.argv[3]);
 writeFileSync(join(dir,"COMMAND.json"),JSON.stringify({argv:process.argv,cwd:process.cwd(),configuration,configurationSha256:createHash("sha256").update(readFileSync(configuration)).digest("hex"),startedAt:Date.now(),measurementInvoked:false})+"\n",{flag:"wx",mode:0o600});
 const handles=[];
 for(const [stream,name] of [[process.stdout,"stdout.log"],[process.stderr,"stderr.log"]]){
  const fd=openSync(join(dir,name),"wx",0o600);handles.push(fd);const original=stream.write;
  stream.write=function(chunk,...args){writeSync(fd,Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk,typeof args[0]==="string"?args[0]:"utf8"));return original.call(this,chunk,...args);};
 }
 process.on("exit",code=>{for(const fd of handles){fsyncSync(fd);closeSync(fd);}writeFileSync(join(dir,"EXIT.json"),JSON.stringify({exitCode:code,finishedAt:Date.now()})+"\n",{flag:"wx",mode:0o600});});
}
