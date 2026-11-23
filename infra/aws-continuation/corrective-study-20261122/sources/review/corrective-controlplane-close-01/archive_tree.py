"""Private complete-tree archiver; callable only after owner drain. No import-time actions."""
import hashlib,json,os,pathlib,shutil,stat,tarfile
def need(v,m):
 if not v:raise ValueError(m)
def raw(v):return (json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
def digest_file(p):
 h=hashlib.sha256()
 with p.open('rb')as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
def inventory(root):
 root=pathlib.Path(root);need(root.is_dir()and not root.is_symlink(),'literal archive tree root')
 entries=[]
 def visit(p):
  before=p.lstat();mode=before.st_mode
  row=dict(path=p.relative_to(root).as_posix(),mode=stat.S_IMODE(mode),uid=before.st_uid,gid=before.st_gid,mtimeNs=before.st_mtime_ns)
  if stat.S_ISLNK(mode):row.update(type='symlink',target=os.readlink(p))
  elif stat.S_ISDIR(mode):row.update(type='directory')
  elif stat.S_ISREG(mode):row.update(type='file',bytes=before.st_size,sha256=digest_file(p))
  else:raise ValueError('unsupported persistent entry type; retain source: '+str(p))
  after=p.lstat()
  need((before.st_dev,before.st_ino,before.st_mode,before.st_size,before.st_mtime_ns,before.st_ctime_ns)==(after.st_dev,after.st_ino,after.st_mode,after.st_size,after.st_mtime_ns,after.st_ctime_ns),'tree entry changed during inventory '+str(p))
  entries.append(row)
  if row['type']=='directory':
   for child in sorted(p.iterdir(),key=lambda x:x.name):visit(child)
 visit(root);return entries
def archive_tree(source,label,scope,output_root,publish_file,publish_json):
 source=pathlib.Path(source);output_root=pathlib.Path(output_root)
 need(label and pathlib.Path(label).name==label and '\\'not in label,'one archive label')
 before=inventory(source);estimated=sum(x.get('bytes',0)for x in before)+len(before)*4096+67108864
 output_root.mkdir(parents=True,exist_ok=True)
 need(shutil.disk_usage(output_root).free>estimated,'insufficient local archive workspace; source retained')
 target=output_root/(label+'.tar.gz');need(not target.exists(),'exclusive new archive output; no overwrite')
 with tarfile.open(target,'x:gz',compresslevel=1,dereference=False,format=tarfile.PAX_FORMAT)as tf:
  for row in before:
   p=source if row['path']=='.'else source/row['path']
   tf.add(p,arcname='tree'if row['path']=='.'else'tree/'+row['path'],recursive=False)
 expected={'tree'if x['path']=='.'else'tree/'+x['path']:x for x in before}
 with tarfile.open(target,'r:gz')as tf:
  members=tf.getmembers();need(len(members)==len(expected)and len({m.name for m in members})==len(expected),'exact archive membership')
  for member in members:
   need(member.name in expected,'unexpected archive member');row=expected[member.name]
   need(member.mode==row['mode']and member.uid==row['uid']and member.gid==row['gid'],'archive owner/mode metadata')
   if row['type']=='file':
    need(member.isfile()or member.islnk(),'file archive type')
    f=tf.extractfile(member);h=hashlib.sha256();n=0
    for b in iter(lambda:f.read(1048576),b''):h.update(b);n+=len(b)
    need(n==row['bytes']and h.hexdigest()==row['sha256'],'archive exact file bytes '+member.name)
   elif row['type']=='directory':need(member.isdir(),'directory archive type')
   else:need(member.issym()and member.linkname==row['target'],'literal symlink retained, never followed')
 after=inventory(source);need(after==before,'source tree changed during archive; retain source')
 archive=publish_file(target)
 manifest=publish_json(label+'-MANIFEST.json',dict(kind='acephale-drained-private-tree-archive-v1',sourceRoot=str(source),scope=scope,entries=before,entryCount=len(before),complete=True,archive=archive,readbackVerified=True,unchangedDuringArchive=True,symlinksFollowed=False,unrelatedContentExcludedByScopeOnly=True))
 return dict(archive=archive,manifest=manifest,complete=True,readbackVerified=True,unchangedDuringArchive=True,entryCount=len(before))
