from pathlib import Path
import argparse,hashlib,json,html,re,datetime,importlib.metadata
from markdown_it import MarkdownIt
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,PageBreak,Preformatted,LongTable,TableStyle,KeepTogether,Image
from reportlab.lib.styles import getSampleStyleSheet,ParagraphStyle
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.enums import TA_CENTER
import fitz

def inline(t):
    parts=[]
    for c in t.children or []:
        if c.type=='text':parts.append(html.escape(c.content))
        elif c.type=='code_inline':parts.append('<font name="Code">'+html.escape(c.content)+'</font>')
        elif c.type=='strong_open':parts.append('<b>')
        elif c.type=='strong_close':parts.append('</b>')
        elif c.type=='em_open':parts.append('<i>')
        elif c.type=='em_close':parts.append('</i>')
        elif c.type=='link_open':parts.append('<link href="'+html.escape(c.attrGet('href'),quote=True)+'" color="#225f7a">')
        elif c.type=='link_close':parts.append('</link>')
        elif c.type in ('softbreak','hardbreak'):parts.append(' ' if c.type=='softbreak' else '<br/>')
        elif c.type=='image':parts.append(html.escape(c.content))
        else:parts.append(html.escape(c.content))
    return ''.join(parts)

def render_markdown(text,styles):
    ts=MarkdownIt('commonmark').enable('table').parse(text);flow=[];i=0;listdepth=0
    while i<len(ts):
        t=ts[i]
        if t.type in ('bullet_list_open','ordered_list_open'):listdepth+=1
        elif t.type in ('bullet_list_close','ordered_list_close'):listdepth-=1
        elif t.type=='heading_open':
            level=int(t.tag[1:]);flow.append(Paragraph(inline(ts[i+1]),styles['Title' if level==1 else 'H'+str(min(level,4))]));i+=2
        elif t.type=='paragraph_open':
            children=ts[i+1].children or []
            if len(children)==1 and children[0].type=='image':
                from reportlab.lib.utils import ImageReader
                path=(SOURCE_ROOT/children[0].attrGet('src')).resolve()
                if not path.is_relative_to(SOURCE_ROOT.resolve())or not path.is_file():raise ValueError('Exact manuscript figure path')
                width,height=ImageReader(str(path)).getSize()
                items=[Image(str(path),width=468,height=468*height/width),Spacer(1,5)]
                if i+5<len(ts)and ts[i+3].type=='paragraph_open'and ts[i+4].type=='inline':
                    items.append(Paragraph(inline(ts[i+4]),styles['Body']));i+=3
                flow.append(KeepTogether(items));i+=2
            else:
                flow.append(Paragraph(('&#8226; 'if listdepth else '')+inline(ts[i+1]),styles['BulletBody' if listdepth else 'Body']));i+=2
        elif t.type in ('fence','code_block'):
            lines=[]
            for line in t.content.splitlines():
                while len(line)>100:lines.append(line[:100]);line='    '+line[100:]
                lines.append(line)
            flow.append(Preformatted('\n'.join(lines),styles['CodeBlock']))
        elif t.type=='table_open':
            rows=[];row=[];j=i+1
            while ts[j].type!='table_close':
                q=ts[j]
                if q.type=='tr_open':row=[]
                elif q.type=='inline':row.append(Paragraph(inline(q),styles['Cell']))
                elif q.type=='tr_close':rows.append(row)
                j+=1
            n=max(map(len,rows))
            widths=[468/n]*n
            if n==6 and rows[0][0].getPlainText()=='Retained report / condition':
                widths=[120]+[(468-120)/5]*5
            tbl=LongTable(rows,colWidths=widths,repeatRows=1,hAlign='LEFT')
            tbl.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#edf1f4')),('VALIGN',(0,0),(-1,-1),'TOP'),('LINEBELOW',(0,0),(-1,0),.7,colors.HexColor('#76818a')),('LINEBELOW',(0,1),(-1,-1),.25,colors.HexColor('#d6dce0')),('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5)]));flow.extend([tbl,Spacer(1,10)]);i=j
        elif t.type=='hr':flow.append(Spacer(1,12))
        i+=1
    return flow

def page(canvas,doc):
    canvas.saveState();canvas.setFont('Body',8);canvas.setFillColor(colors.HexColor('#666666'))
    canvas.drawString(72,758,'ACEPHALE  |  WORKING DRAFT - RESULTS INCOMPLETE');canvas.drawRightString(540,34,str(doc.page));canvas.restoreState()

def main():
    global SOURCE_ROOT
    parser=argparse.ArgumentParser();parser.add_argument('--source',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    SOURCE_ROOT=args.source
    font=Path('/usr/share/fonts/truetype/dejavu')
    for name,file in [('Body','DejaVuSerif.ttf'),('BodyBold','DejaVuSerif-Bold.ttf'),('BodyItalic','DejaVuSerif-Italic.ttf'),('BodyBoldItalic','DejaVuSerif-BoldItalic.ttf'),('Code','DejaVuSansMono.ttf')]:pdfmetrics.registerFont(TTFont(name,str(font/file)))
    pdfmetrics.registerFontFamily('Body',normal='Body',bold='BodyBold',italic='BodyItalic',boldItalic='BodyBoldItalic')
    styles={}
    styles['Body']=ParagraphStyle('Body',fontName='Body',fontSize=10,leading=14,spaceAfter=7)
    styles['BulletBody']=ParagraphStyle('BulletBody',parent=styles['Body'],leftIndent=12)
    styles['Title']=ParagraphStyle('Title',parent=styles['Body'],fontName='BodyBold',fontSize=18,leading=23,spaceBefore=12,spaceAfter=16,alignment=TA_CENTER)
    for n,size in ((2,13),(3,11),(4,10)):styles['H'+str(n)]=ParagraphStyle('H'+str(n),parent=styles['Body'],fontName='BodyBold',fontSize=size,leading=size+4,spaceBefore=13,spaceAfter=7,keepWithNext=True)
    styles['CodeBlock']=ParagraphStyle('CodeBlock',fontName='Code',fontSize=7,leading=9,spaceBefore=4,spaceAfter=8)
    styles['Cell']=ParagraphStyle('Cell',parent=styles['Body'],fontSize=8,leading=11,spaceAfter=0,splitLongWords=True)
    names=['manuscript.md','related-work.md','references.md','methods.md','analysis-plan.md'];story=[];inputs=[]
    for n,name in enumerate(names):
        path=args.source/name;b=path.read_bytes();inputs.append({'path':str(path),'sha256':hashlib.sha256(b).hexdigest()})
        if name in ('methods.md','analysis-plan.md'):
            story.append(PageBreak())
            label='Appendix A. Frozen methods' if name=='methods.md' else 'Appendix B. Analysis plan'
            story.append(Paragraph(label,styles['H2']))
        story.extend(render_markdown(b.decode('utf-8'),styles))
    out=args.output/'acephale-working-manuscript.pdf'
    SimpleDocTemplate(str(out),pagesize=(612,792),rightMargin=72,leftMargin=72,topMargin=56,bottomMargin=54,title='Acephale: source-grounded goal conditioning (working draft)',author='').build(story,onFirstPage=page,onLaterPages=page)
    doc=fitz.open(out);pages=[]
    for i,p in enumerate(doc):
        dest=args.output/('page-%02d.png'%(i+1));p.get_pixmap(matrix=fitz.Matrix(1.25,1.25)).save(dest);pages.append({'page':i+1,'textCharacters':len(p.get_text()),'render':str(dest)})
    manifest={'status':'working-draft-incomplete-results','inputs':inputs,'pdf':{'path':str(out),'sha256':hashlib.sha256(out.read_bytes()).hexdigest()},'pages':pages,'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'packages':{p:importlib.metadata.version(p)for p in ('reportlab','pypdf','markdown-it-py','PyMuPDF')}}
    (args.output/'build.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({'pdf':manifest['pdf'],'pages':len(pages),'status':manifest['status']}))
if __name__=='__main__':main()
