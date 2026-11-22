"""Render copied original development counts. No models or statistical estimation."""
from pathlib import Path
import hashlib,json
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
ROOT=Path(__file__).resolve().parent
DATA_SHA="2293973a7724d02199353f35960256bc4b5fc84936eea4628acdb68cec977262"
REPORT_SHA="3b07d424fbeb348c7a425b2a307746e9ce0a15d4a6463f4ec7a1520e1c7105c8"
def read(name,sha):
 b=(ROOT/name).read_bytes()
 if hashlib.sha256(b).hexdigest()!=sha:raise ValueError("Source changed: "+name)
 return json.loads(b)
d=read("figure-data.json",DATA_SHA)
read("development-original-report.json",REPORT_SHA)
if matplotlib.__version__!="3.11.2":raise RuntimeError("Expected existing Matplotlib 3.11.2")
assert d["validationStatus"]=="unvalidated" and d["scientificAcceptanceAsserted"]is False
out=ROOT/"output";out.mkdir(exist_ok=False)
plt.rcParams.update({"font.family":"DejaVu Sans","font.size":10,"svg.fonttype":"none","svg.hashsalt":"development-unvalidated-counts-v1","pdf.fonttype":42,"text.color":"#243947","axes.labelcolor":"#243947","xtick.color":"#43535E","ytick.color":"#243947","axes.edgecolor":"#98A3AA","axes.spines.top":False,"axes.spines.right":False,"axes.spines.left":False})
fig=plt.figure(figsize=(8.6,5.8))
fig.text(.065,.957,"UNVALIDATED  |  Direct native execution amendment",fontsize=10,color="#9B493B",weight="bold")
fig.text(.065,.893,"Development outcomes by arm",fontsize=18,weight="bold")
fig.text(.065,.846,"6 families - 12 runs per arm - 12 original three-arm paired blocks",fontsize=10.3)
ax=fig.add_axes((.275,.305,.66,.415))
navy="#285D7B";teal="#19857B"
for i,row in enumerate(d["rows"]):
 y=2-i
 ax.barh(y+.16,row["rewardCompletions"],height=.28,color=navy,label="Reward completion"if i==0 else None)
 ax.barh(y-.16,row["constraintCleanRewardCompletions"],height=.28,color=teal,label="Reward + constraint clean"if i==0 else None)
 ax.text(row["rewardCompletions"]-.17,y+.16,f'{row["rewardCompletions"]}/12',ha="right",va="center",weight="bold",color="white",fontsize=10.3)
 ax.text(row["constraintCleanRewardCompletions"]-.17,y-.16,f'{row["constraintCleanRewardCompletions"]}/12',ha="right",va="center",weight="bold",color="white",fontsize=10.3)
ax.set_yticks([2,1,0],[r["label"] for r in d["rows"]])
ax.tick_params(axis="y",length=0,pad=12)
ax.set_xticks([0,3,6,9,12]);ax.set_xlim(0,12.05);ax.set_ylim(-.55,2.55)
ax.set_axisbelow(True);ax.grid(axis="x",color="#E5E9EC",linewidth=.7)
ax.set_xlabel("Original development arm-runs",labelpad=9)
fig.legend(*ax.get_legend_handles_labels(),loc="upper left",bbox_to_anchor=(.267,.806),ncol=2,frameon=False,fontsize=9.5,handlelength=1.6,columnspacing=1.8)
fig.text(.065,.177,"All 36 timings invalid - Zero speculative starts",fontsize=10.5,weight="bold")
fig.text(.065,.126,"Reward and configured constraint compliance are distinct recorded outcomes.",fontsize=9.4,color="#43535E")
fig.text(.065,.087,"Mixed hardware/runtime; original within-block pairing retained. Counts copied without re-estimation.",fontsize=9,color="#43535E")
fig.text(.065,.048,"Development evidence only; no latency gain, heldout completion, or canonical acceptance is asserted.",fontsize=9,color="#43535E")
fig.canvas.draw()
renderer=fig.canvas.get_renderer();bounds=[]
for obj in fig.findobj():
 if isinstance(obj,matplotlib.text.Text) and obj.get_visible() and obj.get_text():
  bb=obj.get_window_extent(renderer)
  if bb.width>0 and bb.height>0:
   if bb.x0<-.5 or bb.y0<-.5 or bb.x1>fig.bbox.width+.5 or bb.y1>fig.bbox.height+.5:
    bounds.append({"text":obj.get_text(),"bounds":[bb.x0,bb.y0,bb.x1,bb.y1]})
if bounds:raise ValueError("Figure text outside page: "+json.dumps(bounds))
refs=[]
for ext in("svg","pdf","png"):
 p=out/("development-reward-constraint-counts."+ext)
 kw={"facecolor":"white"}
 if ext=="png":kw["dpi"]=240
 elif ext=="svg":kw["metadata"]={"Date":None}
 else:kw["metadata"]={"Title":"Unvalidated development outcomes by arm","Subject":"Copied original outcome counts; no valid timing or speculative work","Author":"","CreationDate":None,"ModDate":None}
 fig.savefig(p,**kw)
 b=p.read_bytes();refs.append({"path":str(p.relative_to(ROOT)),"sha256":hashlib.sha256(b).hexdigest(),"bytes":len(b)})
plt.close(fig)
(ROOT/"render-receipt.json").write_bytes((json.dumps({"matplotlibVersion":matplotlib.__version__,"statisticsRecomputed":False,"boundsViolations":bounds,"files":refs},sort_keys=True,indent=2)+"\n").encode())
print(json.dumps(refs))
