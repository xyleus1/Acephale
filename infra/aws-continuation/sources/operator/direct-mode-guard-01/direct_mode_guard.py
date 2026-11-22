"""Explicit amended-mode gate; never rewrites canonical scientific results."""
import hashlib,json,time
from pathlib import Path
USER_DEADLINE=1795413600
LEGACY_FAILURE='permanent-required-unit-failure'
def checked(ref):
 p=Path(ref['path']);raw=p.read_bytes()
 if p.is_symlink() or p.stat().st_uid!=0 or p.stat().st_mode&0o022 or hashlib.sha256(raw).hexdigest()!=ref['sha256']:raise ValueError('Changed direct-mode FileRef')
 return json.loads(raw)
def decide(mode,root,gate,now,source_sha):
 if mode.get('enabled') is not True:return None
 if mode.get('owner')!='EXECUTION' or mode.get('validationStatus')!='unvalidated' or mode.get('scientificAcceptanceAsserted') is not False or mode.get('hardDeadline')!=USER_DEADLINE:raise ValueError('Exact direct mode required')
 common={'directMode':True,'studyComplete':False,'scientificAcceptanceAsserted':False,'validationStatus':'unvalidated','holdNewHostedDispatch':mode['holdNewHostedDispatch'],'units':[]}
 if not root or root.get('controllerSourceSha256')!=source_sha:return {**common,'stop':True,'reason':'direct-controller-authority-mismatch'}
 if now>=min(USER_DEADLINE,float(root.get('hardDeadline',USER_DEADLINE))):return {**common,'stop':True,'reason':'direct-mode-user-hard-deadline'}
 if root.get('executionEnabled') is not True or root.get('stopRequested') is True:return {**common,'stop':True,'reason':'direct-root-execution-stopped'}
 if not gate:return {**common,'stop':True,'reason':'direct-capacity-authority-missing'}
 if gate.get('studyComplete') is True:return {**common,'stop':True,'reason':'direct-study-already-complete'}
 if gate.get('stopRequested') is True and gate.get('stopReason')!=LEGACY_FAILURE:return {**common,'stop':True,'reason':gate.get('stopReason') or 'direct-explicit-capacity-stop'}
 return {**common,'stop':False,'reason':'direct-user-authorized-unvalidated-work','clearLegacyFailureStop':gate.get('stopRequested') is True}
def _values(gate):
 return {':kind':{'S':'acephale-aws-capacity-coordinator-v1'},':source':{'S':gate['sourceCommit']},':cfg':{'S':gate['capacityConfigSha256']},':deadline':{'N':str(gate['hardDeadline'])},':false':{'BOOL':False},':true':{'BOOL':True}}
def tick(controller,mode,now=None):
 now=time.time() if now is None else now
 grant=checked(mode['userGrant'])
 if grant.get('directUserAuthorization') is not True or grant.get('validationDeferred') is not True or grant.get('hardDeadline')!=USER_DEADLINE:raise ValueError('Original explicit unvalidated user grant required')
 root=controller.claims.decoded('coordinator');gate=controller.claims.decoded('coordinator#capacity-v1')
 result=decide(mode,root,gate,now,controller.controller_source_sha256)
 if result is None:return None
 # A different source or missing authority cannot write another controller's gate.
 if result['reason'] in ('direct-controller-authority-mismatch','direct-capacity-authority-missing'):return result
 key={'pk':{'S':'coordinator#capacity-v1'}};table=controller.claims.table
 base='#k=:kind AND sourceCommit=:source AND capacityConfigSha256=:cfg AND hardDeadline=:deadline AND studyComplete=:false'
 vals=_values(gate)
 if result.get('clearLegacyFailureStop'):
  vals[':old']={'S':LEGACY_FAILURE};vals[':next']={'S':result['reason']}
  authority={'TableName':table,'Key':{'pk':{'S':'coordinator'}},'ConditionExpression':'controllerSourceSha256=:code AND executionEnabled=:true AND stopRequested=:false AND hardDeadline>:now','ExpressionAttributeValues':{':code':{'S':controller.controller_source_sha256},':true':{'BOOL':True},':false':{'BOOL':False},':now':{'N':str(int(now))}}}
  update={'TableName':table,'Key':key,'ConditionExpression':base+' AND stopRequested=:true AND stopReason=:old','UpdateExpression':'SET stopRequested=:false, stopReason=:next','ExpressionAttributeNames':{'#k':'kind'},'ExpressionAttributeValues':vals}
  controller.claims.ddb.transact_write_items(TransactItems=[{'ConditionCheck':authority},{'Update':update}])
  result['legacyStopCleared']=True
 elif result['stop'] and gate.get('stopRequested') is not True and gate.get('studyComplete') is not True:
  vals[':reason']={'S':result['reason']}
  controller.claims.ddb.update_item(TableName=table,Key=key,ConditionExpression=base+' AND stopRequested=:false',UpdateExpression='SET capacityEnabled=:false, stopRequested=:true, stopReason=:reason',ExpressionAttributeNames={'#k':'kind'},ExpressionAttributeValues=vals)
 # No acquisition enable, unit/attempt transition, journal release, or worker call.
 return result
