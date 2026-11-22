"""Read output namespaces from the actual pinned owner transport, without executing it."""
import ast,base64,hashlib,json
from pathlib import Path
def need(v,m):
 if not v:raise ValueError(m)
def checked(r):
 b=Path(r['path']).read_bytes();need(hashlib.sha256(b).hexdigest()==r['sha256'],'Actual transport source changed');return b
def value(node,env):
 if isinstance(node,ast.Constant)and isinstance(node.value,(str,int)):return node.value
 if isinstance(node,ast.Name)and node.id in env:return env[node.id]
 if isinstance(node,ast.BinOp)and isinstance(node.op,ast.Add):return value(node.left,env)+value(node.right,env)
 if isinstance(node,ast.Subscript):return value(node.value,env)[value(node.slice,env)]
 if isinstance(node,ast.JoinedStr):return ''.join(str(value(x,env))for x in node.values)
 if isinstance(node,ast.FormattedValue):
  need(node.conversion in(-1,115),'Original transport string formatting only');v=value(node.value,env)
  return format(v,value(node.format_spec,env))if node.format_spec else str(v)
 raise ValueError('Unsupported transport namespace expression')
def raw_index_prefix(source,target,block_index,spec=None):
 tree=ast.parse(source);env={'h':'0'*64,'n':block_index}
 if spec is not None:env['spec']=spec
 assignments=[n for n in ast.walk(tree)if isinstance(n,ast.Assign)]
 for n in sorted(assignments,key=lambda n:n.lineno):
  for t in n.targets:
   if isinstance(t,ast.Name)and t.id in('TARGET','PREFIX','SEQUENCE','prefix','A'):
    try:env[t.id]=value(n.value,env)
    except ValueError:pass
 keys=[]
 for n in assignments:
  if any(isinstance(t,ast.Name)and t.id=='key'for t in n.targets)and any(isinstance(x,ast.Constant)and isinstance(x.value,str)and'RAW-INDEX-'in x.value for x in ast.walk(n.value)):
   keys.append(value(n.value,env))
 need(len(keys)==1,'One actual raw-index publication expression')
 key=keys[0];suffix='RAW-INDEX-'+'0'*64+'.json';need(key.endswith(suffix),'Actual content-addressed raw-index suffix')
 prefix=key[:-len(suffix)]
 need(prefix.startswith('workers/'+target+'/unvalidated/')and prefix.endswith('/')and'..'not in prefix.split('/'),'Actual target output namespace')
 return prefix+'RAW-INDEX-'
def from_transport(transport_ref):
 t=json.loads(checked(transport_ref));c=json.loads(checked(t['contract']))
 if t['transport']=='existing-regional-ssm':
  source=checked(t['workerSource']).decode();tree=ast.parse(source);nodes=[n for n in tree.body if isinstance(n,ast.Assign)and any(isinstance(x,ast.Name)and x.id=='SPEC_B64'for x in n.targets)];need(len(nodes)==1,'One actual EC2 transport specification')
  spec=json.loads(base64.b64decode(ast.literal_eval(nodes[0].value)));need(spec['claimRef']==t['claimProjection']and spec['resourceAttemptId']==c['targetResourceAttemptId'],'Exact EC2 input identity')
  prefix=raw_index_prefix(source,c['targetResourceAttemptId'],c['blockIndex'],spec)
 else:
  command=json.loads(checked(t['command']));source=command['argv'][-1];prefix=raw_index_prefix(source,c['targetResourceAttemptId'],c['blockIndex'])
 return {'prefix':prefix,'resourceAttemptId':c['targetResourceAttemptId'],'blockIndex':c['blockIndex'],'transport':transport_ref,'contract':t['contract'],'claimProjection':t['claimProjection'],'runRoot':c['nativeCommand'][c['nativeCommand'].index('--output')+1],'actualProtectedOwnerSource':True}
