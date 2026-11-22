import hashlib,importlib.util,time
from pathlib import Path
PARENT={'path':'/srv/acephale/workspaces/operator/direct-owner-handler-03/owner_handler.py','sha256':'b9573db281f5597ee906aac496c37e4a4410628bea2948b0de450702d6e8020b'}
def module(ref,name):
 p=Path(ref['path']);assert hashlib.sha256(p.read_bytes()).hexdigest()==ref['sha256']
 s=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def tick(controller,config,now=None,allow_dispatch=True):
 now=time.time()if now is None else now
 result=module(PARENT,'existing_direct_owner_handler03').tick(controller,config,now=now,allow_dispatch=allow_dispatch)
 gc=config['generationProducer']
 try:result['generationProducer']=module(gc['source'],'owned_generation_bridge04').tick(controller,gc,now,allow_dispatch=allow_dispatch)
 except Exception as e:result['generationProducer']={'state':'retained-producer-error','errorType':type(e).__name__,'error':str(e),'newHostedDispatchHeld':True,'scientificAcceptanceAsserted':False}
 cc=config.get('cpuCallbacks')
 if cc:
  try:result['cpuCallbacks']=module(cc['source'],'owned_original_cpu_callbacks').tick(controller,cc,now,allow_dispatch=allow_dispatch,owner_state=result)
  except Exception as e:result['cpuCallbacks']={'state':'retained-cpu-callback-error','errorType':type(e).__name__,'error':str(e),'scientificAcceptanceAsserted':False}
 return result
