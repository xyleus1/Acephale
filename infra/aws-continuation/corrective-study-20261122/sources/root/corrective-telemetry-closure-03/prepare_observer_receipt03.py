"""Path adapter successor: read the actual nested native qualification receipt without changing original evidence."""
from pathlib import Path
import hashlib,importlib.util,ast
ORIGINAL=Path('/REQUIRED_BINDINGS/research-root/workspaces/root/corrective-telemetry-01/prepare_observer_paths02.py')
SHA='55a99df6e34dd84e8f6ef005cf375f8d2b207a7dd61076b09c546555a33ca69b'
HELPER="def qualification_receipt(proof):\n    # Current native proof wraps its original canonical receipt; the outer file is byte-pinned by bindings().\n    if isinstance(proof, dict) and set(proof) == {'version', 'binding', 'response', 'receipt'}:\n        require(proof['version'] == 1, 'Original native proof wrapper version')\n        receipt = sealed(proof['receipt'])\n        binding = proof['binding']\n        artifact = sealed(binding['artifact'])\n        require(receipt['version'] == 1 and receipt['kind'] == 'acephale-native-lora-serving-qualification'\n            and receipt['responseHash'] == digest(proof['response']), 'Original native receipt and response binding')\n        require(receipt['artifactHash'] == artifact['contentHash']\n            and all(receipt[key] == artifact[key] for key in ('servingProbeHash', 'servingWeightsHash', 'baseReceiptHash', 'servedModel')),\n            'Original native artifact binding')\n        inventory = binding['inventory']\n        require(receipt['sourceCommit'] == inventory['sourceCommit'] == binding['deployment']['sourceCommit'] == SOURCE\n            and receipt['inventoryEvidenceHash'] == binding['deployment']['evidenceHash']\n            and receipt['inventoryObservedAt'] == inventory['observedAt'], 'Original qualification inventory binding')\n        predictor = inventory['containers']['predictor']\n        require(all(receipt[receipt_key] == predictor[inventory_key] for receipt_key, inventory_key in\n            (('containerId', 'id'), ('containerStartedAt', 'startedAt'), ('imageId', 'imageId'), ('commandHash', 'commandHash'))),\n            'Original qualification predictor identity')\n        return receipt\n    return sealed(proof)\n"
def prepare(paths,output):
 assert hashlib.sha256(ORIGINAL.read_bytes()).hexdigest()==SHA
 spec=importlib.util.spec_from_file_location('path_adapter02',ORIGINAL);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 output=Path(output);prior=output.with_name('telemetry_observer_path_only02.py')
 m.prepare(paths,prior);source=prior.read_text()
 assert source.count("sealed(proof).get('passed')")==1
 patched=source.replace("sealed(proof).get('passed')","qualification_receipt(proof).get('passed')",1)
 patched=patched.replace('def bindings(',HELPER+'\n\ndef bindings(',1)
 with output.open('x')as f:f.write(patched)
 output.chmod(0o600)
 old={n.name:ast.dump(n)for n in ast.parse(source).body if isinstance(n,ast.FunctionDef)}
 new={n.name:ast.dump(n)for n in ast.parse(patched).body if isinstance(n,ast.FunctionDef)}
 assert all(old[k]==new[k]for k in old if k!='bindings')
 return {'path':str(output),'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'bytes':output.stat().st_size}
