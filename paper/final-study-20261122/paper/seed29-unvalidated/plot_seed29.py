"""Render copied, unvalidated distributed seed29 evidence. No statistical estimation."""
from pathlib import Path
import json,hashlib,sys
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter

ROOT=Path(__file__).resolve().parent
S=ROOT/"sources"
OUT=ROOT/"output"
EXPECTED={
 "goals-fixed-report.json":"9e64b8213fdf474b2548168912d67209a4a83fe9361b59bd5b931363faca63c5",
 "record-coverage.json":"f94c6762d155d4e8fd46cfa9b62047d86bbd460ded3ce384c5aedc9d74e01bc5",
}
def read(name):
 raw=(S/name).read_bytes()
 if hashlib.sha256(raw).hexdigest()!=EXPECTED[name]:
  raise ValueError("Source hash mismatch: "+name)
 return json.loads(raw)
def ref(path):
 raw=path.read_bytes()
 return {"path":str(path.relative_to(ROOT)),"sha256":hashlib.sha256(raw).hexdigest(),"bytes":len(raw)}
def save(fig,stem):
 result=[]
 for suffix in ("svg","pdf","png"):
  p=OUT/(stem+"."+suffix)
  if p.exists():raise FileExistsError(p)
  kw={"facecolor":"white"}
  if suffix=="png":kw["dpi"]=240
  elif suffix=="svg":kw["metadata"]={"Date":None}
  else:kw["metadata"]={"CreationDate":None,"ModDate":None,"Title":stem,"Subject":"UNVALIDATED distributed replay amendment; copied original results"}
  fig.savefig(p,**kw)
  result.append(ref(p))
 plt.close(fig)
 return result

if matplotlib.__version__!="3.11.2":
 raise RuntimeError("Expected existing Matplotlib 3.11.2, observed "+matplotlib.__version__)
g=read("goals-fixed-report.json")
ready=read("record-coverage.json")
comparison=g["paired_comparisons"][0]
assert comparison["baseline"]=="conditional" and comparison["treatment"]=="neutral"
assert g["schema_version"]=="acephale-fixed-panel-report-v3"
metrics=comparison["metrics"]
for key in ("binary_log_loss_nats_difference","brier_difference"):
 v=metrics[key]
 assert v["paired_trials"]==442 and v["families"]==36
 assert v["weighting"]=="equal_family_mean_of_paired_trial_differences"
 assert v["bootstrap_samples"]==2000 and v["bootstrap_seed"]==42
 assert len(v["ci95"])==2 and v["ci95"][0]<=v["estimate"]<=v["ci95"][1]
counts=ready["counts"]
for key in ("neutral-fixed","goals-fixed","goals-selected"):
 c=counts[key]
 assert c["expected"]==c["recorded"]==746
 assert c["coverageComplete"] and c["notDispatched"]==0
 assert c["completed"]+c["failed"]==746
 assert not c["missingCheckpointIds"] and not c["responsesWithoutTerminalPrediction"]
OUT.mkdir(exist_ok=False)
plt.rcParams.update({
 "font.family":"DejaVu Sans","font.size":10,"axes.titlesize":11,
 "axes.labelsize":10,"svg.fonttype":"none","svg.hashsalt":"acephale-seed29-unvalidated-figures-v1",
 "pdf.fonttype":42,"axes.spines.top":False,"axes.spines.right":False,
 "axes.spines.left":False,"axes.edgecolor":"#8C969F",
 "text.color":"#243947","axes.labelcolor":"#243947","xtick.color":"#43535E"
})
fig=plt.figure(figsize=(8.3,6.1))
fig.text(.07,.965,"UNVALIDATED  |  Distributed replay amendment",size=10,color="#9B493B",weight="bold")
fig.text(.07,.915,"Paired candidate-score differences",size=17,weight="bold")
fig.text(.07,.873,"442 jointly scored checkpoints across 36 families; equal family weighting",size=10.5)
specs=[
 ("binary_log_loss_nats_difference","Binary log loss (nats)",(.10,.555,.85,.16),(-.11,.11),[-.10,-.05,0,.05,.10]),
 ("brier_difference","Brier score",(.10,.255,.85,.16),(-.010,.030),[-.01,0,.01,.02,.03]),
]
for key,title,rect,xlim,ticks in specs:
 ax=fig.add_axes(rect)
 v=metrics[key];est=v["estimate"];lo,hi=v["ci95"]
 ax.axvline(0,color="#84929A",lw=1,ls=(0,(3,3)),zorder=1)
 ax.errorbar(est,.5,xerr=[[est-lo],[hi-est]],fmt="o",ms=7,color="#16776D",capsize=5,elinewidth=2,zorder=3)
 ax.set_xlim(*xlim);ax.set_ylim(0,1);ax.set_yticks([]);ax.set_xticks(ticks)
 ax.xaxis.set_major_formatter(FuncFormatter(lambda x,pos:"0" if abs(x)<1e-12 else f"{x:.2f}"))
 ax.set_title(title,loc="left",fontweight="bold",pad=25)
 ax.text(0,1.05,f"Estimate {est:+.5f}; 95% CI [{lo:+.5f}, {hi:+.5f}]",transform=ax.transAxes,size=9.5,color="#43535E")
 ax.set_xlabel("Neutral minus goal-conditioned",labelpad=7)
fig.text(.10,.155,"Negative favors neutral",size=9.5,color="#43535E",ha="left")
fig.text(.95,.155,"Positive favors goal-conditioned",size=9.5,color="#43535E",ha="right")
fig.text(.07,.093,"Intervals copied from the original report: 2,000 family-bootstrap draws; seed 42.",size=9,color="#43535E")
fig.text(.07,.060,"Both intervals include zero. No bootstrap rerun; no task-success or latency estimate.",size=9,color="#43535E")
files=save(fig,"seed29-paired-differences")

fig=plt.figure(figsize=(8.3,5.0))
fig.text(.07,.955,"UNVALIDATED  |  Distributed replay amendment",size=10,color="#9B493B",weight="bold")
fig.text(.07,.892,"Prediction-record completion",size=17,weight="bold")
fig.text(.07,.844,"746 declared condition-checkpoint records per condition",size=10.5)
ax=fig.add_axes((.225,.28,.725,.43))
colors=("#285D7B","#B75A49")
rows=[("neutral-fixed","Neutral fixed"),("goals-fixed","Goals fixed"),("goals-selected","Goals selected")]
for i,(key,label) in enumerate(rows):
 c=counts[key];y=2-i;completed=c["completed"];failed=c["failed"]
 ax.barh(y,completed,height=.50,color=colors[0],edgecolor="white",lw=.6,label="Prediction completed" if i==0 else None)
 ax.barh(y,failed,left=completed,height=.50,color=colors[1],edgecolor="white",lw=.6,label="Failed prediction" if i==0 else None)
 ax.text(completed/2,y,str(completed),ha="center",va="center",weight="bold",color="white",size=11)
 if failed>=20:
  ax.text(completed+failed/2,y,str(failed),ha="center",va="center",weight="bold",color="white",size=11)
 else:
  ax.annotate(str(failed)+" failed",xy=(completed+failed/2,y),xytext=(completed-16,y+.38),
    ha="right",va="center",size=9,color=colors[1],
    arrowprops={"arrowstyle":"-","color":colors[1],"lw":.8})
ax.set_yticks([2,1,0],[label for key,label in rows])
ax.set_xlim(0,746);ax.set_ylim(-.55,2.55)
ax.set_xticks([0,200,400,600,746]);ax.tick_params(axis="y",length=0,pad=12)
ax.set_xlabel("Recorded condition-checkpoint pairs",labelpad=9)
fig.legend(*ax.get_legend_handles_labels(),loc="upper left",bbox_to_anchor=(.215,.803),ncol=2,frameon=False,
 fontsize=9.5,handlelength=1.4,columnspacing=2)
fig.text(.07,.120,"Pipeline completion is not tool or task accuracy.",size=10,weight="bold")
fig.text(.07,.075,"Completed predictions need not contain candidate scores. All failure records remain retained.",size=9,color="#43535E")
files+=save(fig,"seed29-record-coverage")
data={
 "kind":"acephale-copied-seed29-figure-data-v1","status":"UNVALIDATED",
 "methodStatus":"distributed-replay-amendment","pairedComparison":comparison,
 "completionCounts":{key:counts[key] for key,label in rows},
 "scientificAcceptanceClaimed":False,"statisticalReanalysisPerformed":False,
 "bootstrapRecomputed":False,"rawRowMeansUsedForPairedContrast":False,
 "operations":["Copy original paired estimates, CI endpoints and bootstrap metadata",
               "Copy completed and failed terminal-record counts",
               "Render intervals and stack the copied coverage counts"],
 "sourceFiles":[ref(S/name) for name in EXPECTED],
 "sourceProvenance":"provenance.json; original source hashes and public coverage projection",
 "matplotlibVersion":matplotlib.__version__,"python":sys.version,"files":files
}
(ROOT/"figure-data-and-provenance.json").write_bytes((json.dumps(data,sort_keys=True,indent=2)+"\n").encode())
print(json.dumps({"matplotlib":matplotlib.__version__,"figures":files,"statisticsRecomputed":False}))
