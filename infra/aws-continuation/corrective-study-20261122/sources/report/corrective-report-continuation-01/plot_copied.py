"""Plot stored original trial rates only; no estimation or outcome processing."""
from pathlib import Path
import argparse,hashlib,json
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
def main():
 p=argparse.ArgumentParser();p.add_argument('--data',required=True);p.add_argument('--sha256',required=True);p.add_argument('--output',required=True);a=p.parse_args()
 b=Path(a.data).read_bytes();assert hashlib.sha256(b).hexdigest()==a.sha256;d=json.loads(b)
 assert matplotlib.__version__=='3.11.2' and d['statisticsRecomputed']is False
 out=Path(a.output);out.mkdir(parents=True,exist_ok=False)
 plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'svg.fonttype':'none','svg.hashsalt':'corrective-original-trial-rates-v1','pdf.fonttype':42,'axes.spines.top':False,'axes.spines.right':False})
 fig,ax=plt.subplots(figsize=(8.6,4.7));fig.subplots_adjust(left=.26,right=.94,top=.73,bottom=.24)
 labels={'base':'Base actor','neutral_memory_prefetch':'Neutral memory','acephale':'Goal-conditioned'}
 for i,row in enumerate(d['rows']):
  y=2-i
  for offset,key,color,label in [(.16,'rewardTrialRate','#285D7B','DB reward'),(-.16,'knownConstraintCleanTrialRate','#19857B','Known constraint clean')]:
   v=row[key]
   if v is None:ax.text(.02,y+offset,'NA',va='center',color=color);continue
   assert 0<=v<=1
   ax.barh(y+offset,v,height=.28,color=color,label=label if i==0 else None)
   ax.text(min(v+.025,.94),y+offset,format(v,'.4f'),va='center',ha='left'if v<.9 else'right',color='#243947',fontsize=9)
 ax.set_yticks([2,1,0],[labels[r['arm']]+' (n='+str(r['scheduled'])+')'for r in d['rows']])
 ax.set_xlim(0,1.05);ax.set_xticks([0,.25,.5,.75,1]);ax.set_xlabel('Original stored trial rate')
 ax.grid(axis='x',color='#E5E9EC',linewidth=.7);ax.set_axisbelow(True)
 fig.text(.06,.94,'WORKING RESULTS  |  Acceptance not asserted',fontsize=10,color='#9B493B',weight='bold')
 fig.text(.06,.88,'Corrective '+d['stage']+' outcomes',fontsize=18,weight='bold')
 fig.legend(*ax.get_legend_handles_labels(),loc='upper left',bbox_to_anchor=(.25,.83),ncol=2,frameon=False,fontsize=9)
 fig.text(.06,.12,'Original failures, censoring and unknown audits retain their denominators.',fontsize=9)
 fig.text(.06,.075,'Rates copied without re-estimation. Timing validity and family intervals are reported separately.',fontsize=8.5)
 fig.canvas.draw();renderer=fig.canvas.get_renderer();bad=[]
 for obj in fig.findobj():
  if isinstance(obj,matplotlib.text.Text)and obj.get_visible()and obj.get_text():
   bb=obj.get_window_extent(renderer)
   if bb.width and bb.height and (bb.x0<-.5 or bb.y0<-.5 or bb.x1>fig.bbox.width+.5 or bb.y1>fig.bbox.height+.5):bad.append(obj.get_text())
 assert not bad,bad
 files=[]
 for ext in ('png','svg','pdf'):
  p=out/('rates.'+ext);kw={'facecolor':'white'}
  if ext=='png':kw['dpi']=200
  elif ext=='svg':kw['metadata']={'Date':None}
  else:kw['metadata']={'Title':'Corrective '+d['stage']+' original trial rates','Author':'','CreationDate':None,'ModDate':None}
  fig.savefig(p,**kw);z=p.read_bytes();files.append({'path':str(p),'sha256':hashlib.sha256(z).hexdigest(),'bytes':len(z)})
 plt.close(fig)
 (out/'FIGURE.json').write_text(json.dumps({'dataSha256':a.sha256,'matplotlibVersion':matplotlib.__version__,'statisticsComputed':False,'boundsViolations':bad,'files':files},indent=2)+'\n')
 print(json.dumps({'files':files}))
if __name__=='__main__':main()
