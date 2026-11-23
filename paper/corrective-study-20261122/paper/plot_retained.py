from pathlib import Path
import json,hashlib
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.ticker import MaxNLocator
D=Path(__file__).resolve().parent
S=D/'sources'
expected={'seed17-goals-fixed-score-report.json':'8909cf9306588359116befe9f810f3fdc8a2596b766691f65fde27800cc14687','seed17-neutral-fixed-score-report.json':'d0eb584b34f682d47538780307c221ed9f376cec0a87323e7fc78447e3f35ab6'}
for n,h in expected.items():assert hashlib.sha256((S/n).read_bytes()).hexdigest()==h
g=json.loads((S/'seed17-goals-fixed-score-report.json').read_text());n=json.loads((S/'seed17-neutral-fixed-score-report.json').read_text())
comparison=g['paired_comparisons'][0]
assert comparison['treatment']=='neutral'and comparison['baseline']=='conditional'
m=comparison['metrics'];assert all(v['paired_trials']==230 and v['families']==34 and v['weighting']=='equal_family_mean_of_paired_trial_differences'for v in m.values())
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':9,'axes.titlesize':10,'axes.labelsize':8.5,'svg.fonttype':'none','svg.hashsalt':'acephale-seed17-retained-v1','pdf.fonttype':42,'axes.spines.top':False,'axes.spines.right':False})
fig=plt.figure(figsize=(6.5,4.7),layout='constrained')
gs=fig.add_gridspec(2,2,height_ratios=[1.45,1])
ax=fig.add_subplot(gs[0,:]);cond=[n['conditions']['neutral'],g['conditions']['neutral']]
labels=['Standalone neutral','Goals-fixed (both conditions)'];colors=['#285D7B','#DCE2E6','#B75A49'];names=['Scored','Completed, unscored','Failed']
bars=[]
for i,c in enumerate(cond):
 values=[c['scored_checkpoints'],c['status_counts']['completed']-c['scored_checkpoints'],c['status_counts']['failed']]
 assert sum(values)==c['declared_checkpoints']==746
 start=0
 for j,v in enumerate(values):
  ax.barh(1-i,v,left=start,height=.45,color=colors[j],edgecolor='white',linewidth=.6,label=names[j]if i==0 else None)
  if v>=25:ax.text(start+v/2,1-i,str(v),ha='center',va='center',color='white'if j!=1 else'#243947',fontsize=8.5,fontweight='bold')
  else:ax.annotate('1 failed',xy=(start+v/2,1-i),xytext=(start-15,1-i+.34),ha='right',fontsize=7.5,color=colors[j],arrowprops={'arrowstyle':'-','color':colors[j],'lw':.6})
  start+=v
 bars.append({'condition':labels[i],'declared':746,'scored':values[0],'completedUnscored':values[1],'failed':values[2]})
ax.set_yticks([1,0],labels);ax.set_xlim(0,780);ax.set_ylim(-.6,1.65);ax.set_xticks([0,200,400,600,746]);ax.set_xlabel('Declared checkpoints');ax.set_title('A  Coverage of the retained reports',loc='left',fontweight='bold')
ax.legend(ncol=3,loc='upper left',bbox_to_anchor=(0,1.0),frameon=False,fontsize=7.7,handlelength=1.2,columnspacing=1.5)
ax.spines['left'].set_visible(False);ax.tick_params(axis='y',length=0)
for j,(key,title,label,xlim)in enumerate([
 ('binary_log_loss_nats_difference','B  Paired log loss','Neutral minus goal-conditioned\nbinary log loss (nats)',(-.015,.285)),
 ('brier_difference','C  Paired Brier score','Neutral minus goal-conditioned\nBrier score',(-.002,.037))]):
 a=fig.add_subplot(gs[1,j]);v=m[key];est=v['estimate'];lo,hi=v['ci95']
 a.axvline(0,color='#84929A',lw=.8,ls='--',zorder=0)
 a.errorbar(est,.5,xerr=[[est-lo],[hi-est]],fmt='o',ms=6,color='#16776D',capsize=4,elinewidth=1.7)
 a.text(est,.82,f"{est:.3f}"if j==0 else f"{est:.4f}",ha='center',va='center',fontsize=10,fontweight='bold',color='#134E49')
 a.text(.02,.02,'230 paired checkpoints; 34 families',transform=a.transAxes,fontsize=7.1,color='#5B6870')
 a.set_ylim(0,1);a.set_yticks([]);a.set_xlim(*xlim);a.xaxis.set_major_locator(MaxNLocator(4));a.set_xlabel(label);a.set_title(title,loc='left',fontweight='bold');a.spines['left'].set_visible(False)
fig.savefig(D/'figures/seed17-retained-evidence.png',dpi=260,facecolor='white')
fig.savefig(D/'figures/seed17-retained-evidence.pdf',facecolor='white',metadata={'CreationDate':None,'ModDate':None})
fig.savefig(D/'figures/seed17-retained-evidence.svg',facecolor='white',metadata={'Date':None})
plt.close(fig)
out={'kind':'acephale-retained-report-figure-provenance-v1','sourceFiles':[{'path':str(S/n),'sha256':h}for n,h in expected.items()],'pairedComparison':comparison,'coverage':bars,'transformations':['Direct report estimate and CI copy','completedUnscored=completed-scored for mutually exclusive display categories'],'statisticalReanalysisPerformed':False,'syntheticDataUsed':False,'outputFiles':[],'matplotlibVersion':matplotlib.__version__}
for n in('png','pdf','svg'):
 p=D/('figures/seed17-retained-evidence.'+n);out['outputFiles'].append({'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size})
(D/'figures/seed17-retained-evidence.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({'figures':out['outputFiles'],'bootstrapRerun':False}))
