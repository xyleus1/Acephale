"""Original native profiling module with the declared source-bound Node selection overlay."""
from pathlib import Path
import argparse,hashlib,json,sys
p=argparse.ArgumentParser()
p.add_argument('--source',required=True);p.add_argument('--application-root',required=True)
p.add_argument('--application-binding',required=True);p.add_argument('--application-binding-sha256',required=True)
p.add_argument('--config',required=True);p.add_argument('--output',required=True);p.add_argument('--upstream-root',required=True)
a=p.parse_args();source=Path(a.source).resolve();application=Path(a.application_root).resolve()
raw=Path(a.application_binding).read_bytes();assert hashlib.sha256(raw).hexdigest()==a.application_binding_sha256
binding=json.loads(raw);assert binding['applicationSourceRoot']==str(application)
for r in binding['files']:
 path=application/r['path'];assert path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest()==r['sha256']
hook=application/'scripts/acephale-infra-native-profile.ts'
assert hashlib.sha256(hook.read_bytes()).hexdigest()=='4d7aa9221b955e7a5721f09bc8890bf80771da46d912f0b6d9725108dfcff1c5'
# Restore only existing frozen native imports excluded by Python -I.
# Keep the selected interpreter's existing site-package precedence.
frozen_site=Path('/REQUIRED_BINDINGS/research-root/workspaces/report/locked-environments-03/tau3/lib/python3.12/site-packages')
upstream_source=Path(a.upstream_root).resolve()/'src'
assert frozen_site.is_dir() and (upstream_source/'tau2').is_dir()
sys.path.append(str(frozen_site))
sys.path.insert(0,str(upstream_source))
sys.path.insert(0,str(source/'research/acephale/src'))
from acephale.experiment_runner import verify_source
verify_source(source,'5a36a8b3835820fe65b3615ead31fb6fb7bc9672')
import acephale.infra_native_profile as original
assert Path(original.__file__).resolve()==source/'research/acephale/src/acephale/infra_native_profile.py'
# Translate only this retained source-directory reference at its filesystem boundary.
# Original receipt bytes, data, task arguments and all bundle validation stay unchanged.
import acephale.custom_native_tasks as _custom_tasks
_verify_custom_bundle_original=_custom_tasks.verify_custom_bundle
def _verify_retained_custom_bundle(directory, upstream_root=None):
 if str(directory)==r'REQUIRED_BINDINGS_WORKSPACE\outputs\acephale-study-20261113\generated-native':
  directory=Path('/REQUIRED_BINDINGS/research-root/migration/raw/REQUIRED_BINDINGS_WORKSPACE/outputs/acephale-study-20261113/generated-native')
  assert hashlib.sha256((directory/'receipt.json').read_bytes()).hexdigest()=='be60a406056e071d5aa7b0ba30627948192e6bb23d2b1ef8b538bbf8c934084b'
 return _verify_custom_bundle_original(directory,upstream_root)
_custom_tasks.verify_custom_bundle=_verify_retained_custom_bundle
original.ROOT=application
original.SCRIPT='scripts/acephale-infra-native-profile.ts'
print(json.dumps(original.run_profile(Path(a.config),Path(a.output),Path(a.upstream_root))))
