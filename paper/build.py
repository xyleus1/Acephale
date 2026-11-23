"""Build the presentation from saved tables; no models or statistical estimation."""
import argparse,os,subprocess,sys,shutil
from pathlib import Path
HERE=Path(__file__).resolve().parent
def main():
    p=argparse.ArgumentParser();p.add_argument("--output",type=Path,default=HERE/"build/acephale-paper.pdf");a=p.parse_args()
    output=a.output.resolve();output.parent.mkdir(parents=True,exist_ok=True)
    build=HERE/"build/tex";build.mkdir(parents=True,exist_ok=True)
    subprocess.run([sys.executable,str(HERE/"plot_figures.py"),"--source",str(HERE)],check=True,timeout=120)
    tex=["pdflatex","-interaction=nonstopmode","-halt-on-error","-output-directory=build/tex","manuscript.tex"]
    env=dict(os.environ,SOURCE_DATE_EPOCH="1795478400")
    for cmd in (tex,["bibtex","build/tex/manuscript"],tex,tex):
        subprocess.run(cmd,cwd=HERE,env=env,check=True,timeout=120)
    shutil.copyfile(build/"manuscript.pdf",output);print(output)
if __name__=="__main__":main()
