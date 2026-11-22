from pathlib import Path
import fitz,json,hashlib
R=Path('/srv/acephale/workspaces/report/paper-render-03');p=R/'output-01/acephale-working-manuscript.pdf';doc=fitz.open(p);pages=[]
for i,page in enumerate(doc):
 bad=[]
 for b in page.get_text('dict')['blocks']:
  if b.get('type')!=0:continue
  for l in b['lines']:
   for s in l['spans']:
    x0,y0,x1,y1=s['bbox']
    if x0<0 or y0<0 or x1>page.rect.width+.1 or y1>page.rect.height+.1:bad.append({'text':s['text'],'bbox':s['bbox']})
 pages.append({'page':i+1,'textCharacters':len(page.get_text()),'images':len(page.get_images()),'textOutsidePage':bad,'containsFigureCaption':'Figure 1.'in page.get_text()})
assert all(not p['textOutsidePage']and p['textCharacters']>50 for p in pages)
v={'pdf':{'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()},'pages':pages,'pageBoundsPassed':True,'visualReviewRequired':True}
(R/'layout-check-final.json').write_text(json.dumps(v,indent=2)+'\n');print(json.dumps({'pages':len(pages),'figurePages':[p['page']for p in pages if p['images']],'textOutsidePages':False}))
