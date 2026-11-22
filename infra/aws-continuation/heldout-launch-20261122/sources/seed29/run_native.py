import sys,importlib.util
from pathlib import Path
SOURCE=Path('/workspace/acephale/workspaces/operator/science-source')
sys.path.insert(0,str(SOURCE/'research/acephale/src'))
transport=Path('/workspace/acephale/workspaces/operator/native-path-transport-01/native_path_launcher.py')
spec0=importlib.util.spec_from_file_location('seed17_original_path_transport',transport)
transport_module=importlib.util.module_from_spec(spec0);spec0.loader.exec_module(transport_module);transport_module.install()
p=Path(__file__).with_name('infra_native_runner.py')
spec=importlib.util.spec_from_file_location('acephale.unvalidated_seed17_native_runner',p)
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
if __name__=='__main__':raise SystemExit(m.main())
