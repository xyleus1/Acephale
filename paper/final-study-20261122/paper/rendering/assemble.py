from pathlib import Path
import argparse,hashlib,json,re,shutil
EXPECTED_BIB='d61d74e232591e80074f1d3db171eba26c135f00910b58806238cb254cd3aade'
def sha(b):return hashlib.sha256(b).hexdigest()
def references(text):
    # The pinned three-entry BibTeX uses braced scalar values. Reject unsupported syntax.
    entries=[];i=0
    while i<len(text):
        if text[i].isspace():i+=1;continue
        m=re.match(r'@misc\{([A-Za-z0-9]+),',text[i:])
        if not m:raise ValueError('Pinned BibTeX entry syntax')
        key=m.group(1);i+=m.end();fields={}
        while True:
            while i<len(text) and (text[i].isspace() or text[i]==','):i+=1
            if text[i]=='}':i+=1;break
            m=re.match(r'([A-Za-z]+)=\{',text[i:])
            if not m:raise ValueError('Pinned braced field syntax')
            name=m.group(1);i+=m.end();start=i;depth=1
            while depth:
                if i>=len(text):raise ValueError('Unclosed BibTeX value')
                if text[i]=='{':depth+=1
                elif text[i]=='}':depth-=1
                i+=1
            if name in fields:raise ValueError('Duplicate bibliography field')
            fields[name]=text[start:i-1]
        if not {'title','author','year','note','url'}<=fields.keys():raise ValueError('Incomplete bibliography')
        entries.append((key,fields))
    if [x[0] for x in entries]!=['sui2026paste','li2026memory','tau2pinned']:raise ValueError('Exact verified bibliography')
    lines=['## References','']
    for number,(key,v) in enumerate(entries,1):
        author=v['author'].replace('{','').replace('}','')
        author='; '.join(author.split(' and '))
        extra=(' arXiv:'+v['eprint']+'.') if 'eprint' in v else ''
        lines += [f"{number}. {author} ({v['year']}). *{v['title']}*.{extra} {v['note']}. [Source]({v['url']}).",'']
    return '\n'.join(lines)
def main():
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    original=a.source/'references.bib';b=original.read_bytes()
    if sha(b)!=EXPECTED_BIB:raise ValueError('Use the exact verified bibliography')
    if a.output.exists():raise ValueError('Fresh output directory required')
    a.output.mkdir(parents=True)
    rows=[]
    for name in ('manuscript.md','related-work.md','methods.md','analysis-plan.md','references.bib'):
        data=(a.source/name).read_bytes();(a.output/name).write_bytes(data);rows.append({'name':name,'sha256':sha(data),'bytes':len(data)})
    shutil.copytree(a.source/'figures',a.output/'figures')
    refs=references(b.decode('utf-8')).encode();(a.output/'references.md').write_bytes(refs)
    receipt={'kind':'acephale-paper-final-layout-assembly-v1','source':str(a.source),'suppliedEditedTextCopiedUnchanged':True,
     'statisticalComputationPerformed':False,'status':'edited-exploratory-source',
     'order':['manuscript.md','related-work.md','references.md','Appendix A: methods.md','Appendix B: analysis-plan.md'],
     'copiedText':rows,'generatedReferences':{'sha256':sha(refs),'bytes':len(refs),'sourceBibSha256':sha(b)}}
    (a.output/'assembly.json').write_bytes((json.dumps(receipt,sort_keys=True,indent=2)+'\n').encode())
    print(json.dumps(receipt))
if __name__=='__main__':main()
