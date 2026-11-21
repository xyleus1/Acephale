"""Root invocation seals actual finite allocation; no API calls or shared resource changes."""
import argparse,base64,datetime,hashlib,json,os,time
from pathlib import Path
import allocate_root as a
HERE=Path(__file__).parent
def ref(p):return {'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
def build(deadline,now):
 a.need(type(deadline)is int and now+10800<deadline<=min(now+43200,1795413600),'Exact finite approved deadline')
 agent=(HERE/'node_agent.py').read_bytes();agenthash=hashlib.sha256(agent).hexdigest()
 script="""#!/bin/bash
set -euo pipefail
umask 077
test "$(id -u)" = 0
mkdir -p /opt/acephale-hyperpod-agent/state
/usr/bin/python3 - <<'AGENT'
import base64,hashlib,os,pathlib
b=base64.b64decode('__AGENT_BASE64__')
assert hashlib.sha256(b).hexdigest()=='__AGENT_SHA__'
p=pathlib.Path('/opt/acephale-hyperpod-agent/node_agent.py')
if p.exists():
 assert p.read_bytes()==b
else:
 fd=os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
 with os.fdopen(fd,'wb') as f:f.write(b);f.flush();os.fsync(f.fileno())
AGENT
if ! /usr/bin/python3 -m venv /opt/acephale-hyperpod-agent/venv; then
 apt-get update
 DEBIAN_FRONTEND=noninteractive apt-get install -y python3-venv
 /usr/bin/python3 -m venv /opt/acephale-hyperpod-agent/venv
fi
/opt/acephale-hyperpod-agent/venv/bin/python -m pip install --disable-pip-version-check 'boto3==1.44.9'
cat > /etc/systemd/system/acephale-hyperpod-node-agent.service <<'UNIT'
[Unit]
Description=Exact HyperPod A10001 root-command transport
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=root
Environment=ACEPHALE_HYPERPOD_DEADLINE=__DEADLINE__
ExecStart=/opt/acephale-hyperpod-agent/venv/bin/python -I /opt/acephale-hyperpod-agent/node_agent.py
Restart=on-failure
RestartSec=10
KillMode=control-group
TimeoutStopSec=40
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now acephale-hyperpod-node-agent.service
systemctl is-active --quiet acephale-hyperpod-node-agent.service
"""
 script=script.replace('__AGENT_BASE64__',base64.b64encode(agent).decode()).replace('__AGENT_SHA__',agenthash).replace('__DEADLINE__',str(deadline))
 life=HERE/'on-init-complete.sh';a.write(life,script.encode())
 lifecycle={'SourceS3Uri':'s3://sagemaker-acephale-hyperpod-971290362335-us-east-1/lifecycle/hyperpod-a100-01/','OnInitComplete':'on-init-complete.sh'}
 q=json.loads((HERE/'create-cluster-template.json').read_text())
 q['VpcConfig']={'SecurityGroupIds':['sg-09da29843ffd52111'],'Subnets':['subnet-065dcca5edf1e4ba7']}
 for g in q['InstanceGroups']:g['ImageId']='ami-0b875b649935d7957';g['LifeCycleConfig']=lifecycle
 tags={x['Key']:x['Value'] for x in q['Tags']};tags.update(HardDeadline=str(deadline),ScientificDispatchAllowed='false')
 q['Tags']=[{'Key':k,'Value':v}for k,v in tags.items()]
 sch=json.loads((HERE/'cleanup-schedule-template.json').read_text())
 sch['ScheduleExpression']='at('+datetime.datetime.fromtimestamp(deadline,datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S')+')'
 c={'kind':'acephale-root-hyperpod-allocation-v1','rootApproved':True,'resourceAttemptId':a.ATTEMPT,'region':a.REGION,'networkStackArn':a.STACK,'issuedAt':now,'deadline':deadline,'reservedMicrousd':a.HOLD,'scientificDispatchAllowed':False,'createRequest':q,'lifecycle':lifecycle,'lifecycleSource':ref(life),'cleanupSchedule':sch,'files':[ref(HERE/x)for x in ['allocate_root.py','node_agent.py','on-init-complete.sh','network-observed.json','managed-images.json','managed-image-parameters.json','targeted-quota.json','prices-usage-east1.json']],'compatibility':{'imageId':'ami-0b875b649935d7957','managedImageReleaseVersion':None,'managedImageReleaseVersionStatus':'Must be recorded from actual DescribeClusterNode before qualification','os':'Ubuntu22.04','glibc':'2.35','lockedPythonExecutableRequiresGlibc':'2.34','lockedNodeExecutableRequiresGlibc':'2.28','operationalVenvCopied':False,'driverObservedBeforeScientificQualification':False,'minimumDriverMajor':580}}
 a.validate(c,now)
 return c
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--deadline',required=True,type=int);z=ap.parse_args()
 a.need(os.geteuid()==0,'Root authorization invocation')
 now=int(time.time());out=HERE/'allocation.json'
 if out.exists():
  c=json.loads(out.read_text());a.need(c['deadline']==z.deadline,'Immutable approved deadline');a.validate(c,now)
 else:c=build(z.deadline,now);a.write(out,a.raw(c))
 h=hashlib.sha256(out.read_bytes()).hexdigest()
 unit="""[Unit]
Description=Finite HyperPod A10001 cluster and isolated network cleanup
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=root
ExecStart=/srv/acephale/ops-venv/bin/python __SOURCE__ --configuration __CONFIG__ --sha256 __SHA__ --mode watch
Restart=on-failure
RestartSec=10
KillMode=control-group
TimeoutStopSec=45
[Install]
WantedBy=multi-user.target
""".replace('__SOURCE__',str(HERE/'allocate_root.py')).replace('__CONFIG__',str(out)).replace('__SHA__',h)
 a.write(HERE/a.UNIT,unit.encode());print(json.dumps({'configuration':ref(out),'cleanupUnit':ref(HERE/a.UNIT),'source':ref(HERE/'allocate_root.py'),'deadline':z.deadline}))
if __name__=='__main__':main()
