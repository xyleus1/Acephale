"""Exact root-selected OpenAI secret version, injected only into an owned child environment."""
import json
from contextlib import contextmanager
ARN='REQUIRED_RESOURCE_ARN'
VERSION='d9cef044-4f0e-45e5-b4d4-38993fc4a51f'
NAMES=('OPENAI_API_KEY','OPENAI_ORG_ID','OPENAI_PROJECT_ID')
def need(v,m):
 if not v:raise ValueError(m)
def public_environment(environment):
 need(type(environment)is dict,'Concrete child environment')
 return {k:v for k,v in environment.items()if k not in NAMES}
@contextmanager
def child_environment(environment,reference,client):
 need(reference=={'arn':ARN,'versionId':VERSION,'jsonKeys':list(NAMES)},'Exact root-protected secret metadata')
 result=client.get_secret_value(SecretId=ARN,VersionId=VERSION)
 need(result.get('ARN')==ARN and result.get('VersionId')==VERSION and isinstance(result.get('SecretString'),str),'Exact observed secret version')
 values=json.loads(result['SecretString'])
 need(type(values)is dict and set(values)==set(NAMES) and all(type(values[k])is str and values[k] and '\x00' not in values[k]for k in NAMES),'Original actor credential JSON schema')
 child=public_environment(environment);child.update(values)
 try:yield child
 finally:
  for k in NAMES:child.pop(k,None);values.pop(k,None)
  result.clear()
