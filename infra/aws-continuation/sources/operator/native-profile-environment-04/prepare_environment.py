SPEC_SHA='25a733f8fb5ec3f9c41a56801b19fb7d5789b197d977857a23b2a04fdfe810b3'
from pathlib import Path
import hashlib,json,os,subprocess,sys
BASE=Path('/srv/acephale/workspaces/operator/native-profile-environment-04')
PYTHON=Path('/srv/acephale/workspaces/report/locked-environments-02/python-root/local/bin/python3.12')
TAU=Path('/srv/acephale/workspaces/report/locked-environments-03/tau3/lib/python3.12/site-packages')
SOURCE=Path('/srv/acephale/workspaces/report/locked-environments-02/training5a/lib/python3.12/site-packages')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 spec=json.loads((BASE/'package-files.json').read_bytes())
 if sha(BASE/'package-files.json')!=SPEC_SHA:raise ValueError('Exact package map')
 if sha(PYTHON)!='4dbf3143240288fb2170257ffaa7bd030cdda5d2703d1f5f30b627042267e2e3':raise ValueError('Frozen Python')
 if not TAU.is_dir():raise ValueError('Existing native source environment')
 for row in spec:
  p=SOURCE/row['relative']
  if p.is_symlink()or sha(p)!=row['sha256']:raise ValueError('Frozen package changed')
 dest=BASE/'venv'
 if dest.exists():raise ValueError('New environment only; inspect prior receipt before adoption')
 env=dict(os.environ,LD_LIBRARY_PATH='/srv/acephale/workspaces/report/locked-environments-02/python-root/local/lib',PYTHONDONTWRITEBYTECODE='1')
 subprocess.run([str(PYTHON),'-I','-m','venv','--without-pip',str(dest)],env=env,check=True)
 site=dest/'lib/python3.12/site-packages'
 for row in spec:
  p=site/row['relative'];p.parent.mkdir(parents=True,exist_ok=True)
  with p.open('xb')as f:f.write((SOURCE/row['relative']).read_bytes());f.flush();os.fsync(f.fileno())
 # addsitedir is necessary to process the original pinned tau3 editable source .pth.
 with (site/'original-native-environment.pth').open('x')as f:f.write("import site; site.addsitedir("+repr(str(TAU))+")\n");f.flush();os.fsync(f.fileno())
 command=[str(dest/'bin/python'),'-I','/srv/acephale/migration/raw/C/Users/apexs/outputs/acephale-staged-study-20261113/phase2-orchestration/source_bound_analysis_5a.py','/srv/acephale/workspaces/operator/science-source','5a36a8b3835820fe65b3615ead31fb6fb7bc9672','acephale.infra_native_profile','--verify-import']
 r=subprocess.run(command,env=env,text=True,capture_output=True,timeout=120)
 receipt={'kind':'acephale-isolated-native-profile-environment-v1','python':str(dest/'bin/python'),'basePythonSha256':sha(PYTHON),'originalNativeSitePackages':str(TAU),'additionalPackage':'rfc8785==0.1.4','packageFilesSha256':SPEC_SHA,'packageFiles':spec,'command':command,'exitCode':r.returncode,'stdout':r.stdout,'stderr':r.stderr,'scientificDispatchPerformed':False,'originalEnvironmentsChanged':False}
 with (BASE/'receipt.json').open('x')as f:json.dump(receipt,f,sort_keys=True,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
 print(json.dumps(receipt))
 return r.returncode
if __name__=='__main__':raise SystemExit(main())
