"""CPU-only exact seven-file image derivative: no container start, GPU, model or service actions."""
import argparse,datetime,hashlib,json,pathlib,shutil,subprocess,sys,tempfile
PIN='sha256:befccf0e7e4089aa23926bb6f887a85c0d46c2a99e6de5c5ffdf5cb7957c5b34'
BASE='vllm/vllm-openai@'+PIN
TAG='goalspec-numerics-seed29-precision:09'
PACKAGE='/usr/local/lib/python3.12/dist-packages/vllm'
REL='vllm/third_party/flash_linear_attention/ops/'
ORIGINAL={'fused_gdn_prefill_post_conv.py': '590717b2107abc90d72548de06b5d315229eb2775c94614f3f545df11cc2b5df', 'fused_sigmoid_gating.py': '000ab8996af9788fdb8843a6a3b91833e7a14c8acc0e1ea073a536330f64cb6f', 'fused_recurrent.py': 'fe6f1311014809040497aa0a623e7fa97f4b3457cdc7ee1f1f8aed21f326f755', 'chunk_scaled_dot_kkt.py': 'ae443be743a95b2b2fb8859d2ee8f9921887a50b1b33b5ede4058a8bb5438856', 'causal_conv1d.py': 'cb16cc9250c4195c09d6d83b43bba607c2d749b621d8d135a920443d1577265f', 'activation.py': 'bebeddbd4997f49f54471ee31ac42b22c3c11dfe25244e55d20c36f390489c05', 'layernorm.py': 'b7621f663a97caf6908507b6cbe03adf23d0001a441d44af2b24c1ad0fc8bf57'}
CANDIDATE={'fused_gdn_prefill_post_conv.py': 'f03089c0805edf80822f88525514d9361c30014c5351433c0784a38c8cca3f01', 'fused_sigmoid_gating.py': '691ab98586417ce60a66dea51ebbcc21943aa54bfb739186cbe5efd21c1cd26b', 'fused_recurrent.py': '71c402ef6335e9ced5e71f25f43c978f470ff507b93afcff9c668dea6abe2f99', 'chunk_scaled_dot_kkt.py': '05ea9ad35ffa9024d5cc5fa65b83d7c796e57f1f262278c3136c6f7600a6633a', 'causal_conv1d.py': '8b772f74811a6ef008c551340fc8a872978b83e616fe8fdff22311e89743e80b', 'activation.py': '41b7b94909a4c391a857d0dc77e5a4c8b777e6d54fcb9ad1a93a067dbad36a0b', 'layernorm.py': 'b64b44871c8cf0da893e7db9f8e4e9b06c90c957ebf1843b1be3fe4e1233d3e6'}
NATIVE='ae9c8a293020e422e0b6b61d1024263dc476a772337f5d39d46d18baa7ce0ad9'
LOCATIONS={name:'third_party/flash_linear_attention/ops/'+name for name in ORIGINAL}
LOCATIONS['causal_conv1d.py']='model_executor/layers/mamba/ops/causal_conv1d.py'
LOCATIONS['activation.py']='model_executor/layers/activation.py'
LOCATIONS['layernorm.py']='ir/ops/layernorm.py'
ATOMIC_PATHS=['vllm/'+LOCATIONS['activation.py'],'vllm/'+LOCATIONS['layernorm.py']]
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  while b:=f.read(8*1024*1024):h.update(b)
 return h.hexdigest()
def docker(*args):
 p=subprocess.run(['docker',*args],capture_output=True,text=True,timeout=600)
 if p.returncode:raise RuntimeError('docker '+args[0]+' failed with exit '+str(p.returncode))
 return p.stdout.strip()
def inspect(image):
 j=json.loads(docker('image','inspect',image))[0]
 return {'id':j['Id'],'repoDigests':j.get('RepoDigests',[])}
def capture(image,directory):
 directory.mkdir();container=docker('create','--network','none','--entrypoint','/bin/true',image)
 try:
  for name in ORIGINAL:docker('cp',container+':'+PACKAGE+'/'+LOCATIONS[name],str(directory/name))
  docker('cp',container+':'+PACKAGE+'/_C_stable_libtorch.abi3.so',str(directory/'_C_stable_libtorch.abi3.so'))
 finally:docker('rm',container)
 return {p.name:sha(p) for p in directory.iterdir() if p.is_file()}
def validate_stage_manifest(root):
 manifest=json.loads((root/'manifest.json').read_text())
 if manifest.get('kind')!='acephale-python-kernel-candidate-stage-v3' or manifest.get('fileCount')!=7 or manifest.get('sourceImageDigest')!=PIN:raise ValueError('Exact seven-file v3 pinned-image manifest required')
 expected={('vllm/'+LOCATIONS[name],ORIGINAL[name],CANDIDATE[name]) for name in ORIGINAL}
 rows=manifest.get('changedFiles',[])
 actual={(x.get('path'),x.get('originalSha256'),x.get('patchedSha256')) for x in rows}
 if len(rows)!=7 or actual!=expected:raise ValueError('Exact seven-file manifest hashes/paths required')
 if manifest.get('atomicFileGroups')!=[ATOMIC_PATHS]:raise ValueError('Activation and IR normalization must be applied atomically')
 for name,value in {'predictorOnly':True,'nativeExtensionChanged':False,'requiresSpeculativeConfigNone':True,'configuredModelDtypeChanged':False,'weightsChanged':False,'acceptanceThresholdChanged':False,'autotuneChoicesChanged':False,'cachePolicyChanged':False}.items():
  if manifest.get(name) is not value:raise ValueError('Candidate scope flag mismatch: '+name)
 return manifest

def main():
 p=argparse.ArgumentParser();p.add_argument('--base-image',default=BASE);p.add_argument('--tag',default=TAG);p.add_argument('--candidate-root',type=pathlib.Path,required=True);p.add_argument('--output',type=pathlib.Path,required=True);a=p.parse_args()
 if a.output.exists():raise ValueError('Output must not exist; retain prior receipts')
 a.output.mkdir(parents=True);report={'schemaVersion':1,'observedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'started','scope':'CPU build only; no GPU or started containers; authority controlled by calling pipeline','baseReference':BASE,'candidateTag':a.tag,'deploymentAccepted':False,'intendedRole':'predictor','requiredSpeculativeConfig':None,'scopeEnforcement':'Calling pipeline must verify predictor identity and absent speculative configuration before use'}
 try:
  stage_manifest=validate_stage_manifest(a.candidate_root)
  report.update(fileCount=7,atomicFileGroups=[ATOMIC_PATHS],sourceManifestSha256=sha(a.candidate_root/'manifest.json'))
  base=inspect(a.base_image)
  if base['id']!=inspect(BASE)['id']:raise ValueError('Requested base differs from pinned immutable image')
  if not any(x.endswith('@'+PIN) for x in base['repoDigests']):raise ValueError('Pinned base RepoDigest absent')
  report['baseImage']=base
  context=a.output/'context';context.mkdir();staged={}
  for name,expected in CANDIDATE.items():
   source=a.candidate_root/'vllm'/LOCATIONS[name]
   if not source.is_file() or sha(source)!=expected:raise ValueError('Candidate hash mismatch: '+name)
   shutil.copyfile(source,context/name);staged[name]=expected
  original=capture(base['id'],a.output/'original-capture')
  for name,expected in ORIGINAL.items():
   if original.get(name)!=expected:raise ValueError('Original source hash mismatch: '+name)
  if original.get('_C_stable_libtorch.abi3.so')!=NATIVE:raise ValueError('Original native binary hash mismatch')
  report['originalFileHashes']=original
  text='FROM '+BASE+'\n'+''.join('COPY '+name+' '+PACKAGE+'/'+LOCATIONS[name]+'\n' for name in ORIGINAL)
  (context/'Dockerfile').write_text(text);report['dockerfileSha256']=sha(context/'Dockerfile');report['candidateFileHashes']=staged
  existing=subprocess.run(['docker','image','inspect',a.tag],capture_output=True,text=True,timeout=30)
  if existing.returncode==0:raise ValueError('Candidate tag already exists; refuse overwrite')
  docker('build','--pull=false','--network=none','--tag',a.tag,'--file',str(context/'Dockerfile'),str(context))
  candidate=inspect(a.tag);report['candidateImage']=candidate
  actual=capture(candidate['id'],a.output/'candidate-capture')
  for name,expected in CANDIDATE.items():
   if actual.get(name)!=expected:raise ValueError('Built candidate hash mismatch: '+name)
  if actual.get('_C_stable_libtorch.abi3.so')!=original['_C_stable_libtorch.abi3.so']:raise ValueError('Native extension changed')
  changed=[{'path':PACKAGE+'/'+LOCATIONS[name],'originalSha256':ORIGINAL[name],'patchedSha256':CANDIDATE[name]} for name in ORIGINAL]
  layer_manifest={'baseImageId':base['id'],'imageId':candidate['id'],'baseReference':BASE,'dockerfileSha256':report['dockerfileSha256'],'changedFiles':changed,'nativeExtensionBeforeSha256':original['_C_stable_libtorch.abi3.so'],'nativeExtensionAfterSha256':actual['_C_stable_libtorch.abi3.so'],'dockerHistoryCommands':'FROM exact pinned image plus seven COPY instructions; no RUN'}
  manifest_path=a.output/'image-layer-manifest.json';manifest_path.write_text(json.dumps(layer_manifest,indent=2)+'\n')
  identity={'imageId':candidate['id'],'baseImageId':base['id'],'changedFiles':changed,'imageLayerManifest':{'path':str(manifest_path.resolve()),'sha256':sha(manifest_path)}}
  report.update(identity)
  report.update(status='built_and_captured',candidateImage=identity,actualCandidateFileHashes=actual,nativeExtensionUnchanged=True,nativeExtensionBeforeSha256=original['_C_stable_libtorch.abi3.so'],nativeExtensionAfterSha256=actual['_C_stable_libtorch.abi3.so'],finishedUtc=datetime.datetime.now(datetime.timezone.utc).isoformat())
 except Exception as e:
  report.update(status='failed',error=str(e));(a.output/'receipt.json').write_text(json.dumps(report,indent=2)+'\n');raise
 (a.output/'receipt.json').write_text(json.dumps(report,indent=2)+'\n');(a.output/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
if __name__=='__main__':main()
