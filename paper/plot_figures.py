"""Deterministic figures from copied tables; no statistical estimation."""
from pathlib import Path
import argparse,csv,json
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

def setup_style():
    plt.rcParams.update({"font.family":"DejaVu Sans","font.size":8,"axes.titlesize":9,"axes.titleweight":"bold","axes.labelsize":8,"xtick.labelsize":7.5,"ytick.labelsize":7.5,"legend.fontsize":7.5,"legend.frameon":False,"text.color":"#222222","axes.labelcolor":"#222222","axes.edgecolor":"#222222","axes.linewidth":.65,"axes.spines.top":False,"axes.spines.right":False,"grid.color":"#D9D9D9","grid.linewidth":.4,"lines.linewidth":1,"lines.markersize":3.5,"pdf.fonttype":42,"ps.fonttype":42,"svg.fonttype":"none","svg.hashsalt":"acephale-v0.2.0-figures","figure.facecolor":"white","savefig.facecolor":"white","mathtext.fontset":"cm"})
def save_figure(fig,root,name):
    fig.savefig(root/"figures"/(name+".pdf"),metadata={"CreationDate":None,"ModDate":None})
    fig.savefig(root/"figures"/(name+".svg"),metadata={"Date":None,"Creator":"Acephale"})
    fig.savefig(root/"figures"/(name+".png"),dpi=300)

def read(p):
    with p.open() as f:return list(csv.DictReader(f))
def plot(root):
    root=Path(root);rows=read(root/"tables/outcomes.csv")
    setup_style()
    fig,ax=plt.subplots(1,2,figsize=(7.0,3.4),layout="constrained")
    y=list(range(len(rows)));labels=[r["stage"][:3]+" / "+r["arm"].replace("_prefetch","").replace("_memory","") for r in rows]
    ax[0].barh(y,[int(r["scheduled"]) for r in rows],color="#D9D9D9",label="Scheduled")
    ax[0].barh(y,[int(r["completed"]) for r in rows],color="#0072B2",label="Report completed")
    ax[0].set_yticks(y,labels);ax[0].invert_yaxis();ax[0].set_title("Retained trial denominator");ax[0].set_xlabel("Trials");ax[0].legend(fontsize=7)
    for i,r in enumerate(rows):
        if r["meanSeconds"]:ax[1].barh(i,float(r["meanSeconds"]),color="#D55E00")
        else:ax[1].text(0,i,"unavailable",va="center",fontsize=8)
    ax[1].set_yticks(y,labels=[]);ax[1].invert_yaxis();ax[1].set_title("Mean observed exit time");ax[1].set_xlabel("Seconds (includes failed exits)")
    save_figure(fig,root,"outcomes");plt.close(fig)
    c=read(root/"tables/coverage.csv");b=read(root/"tables/head-availability.csv")
    fig,ax=plt.subplots(1,2,figsize=(7.0,3.2),layout="constrained")
    y=list(range(len(c)))
    ax[0].barh(y,[int(x["eligible"]) for x in c],color="#D9D9D9",label="Eligible")
    ax[0].barh(y,[int(x["fullPoolHits"]) for x in c],color="#0072B2",label="Full pool hit")
    ax[0].set_yticks(y,["Visit only","All reads"]);ax[0].set_xlabel("Calibration checkpoints");ax[0].set_title("Exact-read coverage");ax[0].legend(fontsize=7)
    for i,x in enumerate(c):ax[0].text(max(1,int(x["eligible"])*.04),i,f'{x["fullPoolHits"]}/{x["eligible"]} hits',va="center")
    y=list(range(len(b)));ax[1].barh(y,[int(x["declared"]) for x in b],color="#D9D9D9",label="Declared")
    ax[1].barh(y,[int(x["available"]) for x in b],color="#D55E00",label="Available")
    ax[1].set_yticks(y,[x["stage"] for x in b]);ax[1].set_xlabel("Checkpoints");ax[1].set_title("Native recipe availability");ax[1].legend(fontsize=7)
    save_figure(fig,root,"coverage");plt.close(fig)
if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--source",required=True);a=p.parse_args();plot(a.source)
