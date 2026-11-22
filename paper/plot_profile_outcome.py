from pathlib import Path
import json,hashlib
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
D=Path(__file__).resolve().parent
e=json.loads((D/'negative-outcome-evidence.json').read_bytes());s=e['summary']
assert (s['declaredProfileRows'],s['completedMeasurements'],s['retainedProfileFailures'],s['minimumCompletedRequired'])==(20,8,12,10)
assert not s['readyForAggregation'] and not s['acceptedPerformanceEstimate']
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':11,'svg.hashsalt':'acephale-opportunity-outcome-v1'})
f,a=plt.subplots(figsize=(9.4,3.5))
f.subplots_adjust(left=.06,right=.98,top=.69,bottom=.28)
a.barh([0],[8],height=.47,color='#346d89')
a.barh([0],[12],left=[8],height=.47,color='#bfc7cd')
a.text(4,0,'8 completed',ha='center',va='center',color='white',weight='bold')
a.text(14,0,'12 profile failures',ha='center',va='center',color='#222b32',weight='bold')
a.set_xlim(0,20);a.set_xticks([0,5,10,15,20]);a.set_yticks([]);a.set_xlabel('Declared profile rows')
a.spines[['top','right','left']].set_visible(False);a.spines['bottom'].set_color('#8c969f');a.tick_params(axis='y',length=0)
f.suptitle('Seed17 opportunity profile did not meet the aggregation gate',x=.06,ha='left',y=.95,fontsize=13,weight='bold')
f.text(.06,.81,'20 rows evaluated; completed 8 of the minimum 10 required.',ha='left',fontsize=11)
f.text(.06,.075,'Failure: actor_did_not_request_profiled_read. Counts only; no accepted latency or task-success estimate.',ha='left',fontsize=8.5,color='#4c555d')
out=D/'figures/seed17-opportunity-outcome'
f.savefig(str(out)+'.png',dpi=180)
f.savefig(str(out)+'.svg',metadata={'Date':None})
f.savefig(str(out)+'.pdf',metadata={'CreationDate':None,'ModDate':None})
plt.close(f)
manifest={'kind':'acephale-paper-count-figure-v1','source':{'path':str(D/'negative-outcome-evidence.json'),'sha256':hashlib.sha256((D/'negative-outcome-evidence.json').read_bytes()).hexdigest()},'counts':s,'statisticalEstimationPerformed':False,'files':[]}
for suffix in ('.png','.svg','.pdf'):
 p=Path(str(out)+suffix);b=p.read_bytes();manifest['files'].append({'path':str(p),'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)})
(D/'figures/seed17-opportunity-outcome.json').write_bytes((json.dumps(manifest,sort_keys=True,indent=2)+'\n').encode())
print(json.dumps(manifest))
