from pathlib import Path
import argparse,ast,hashlib,json
HERE=Path(__file__).resolve().parent
ORIGINAL=HERE/'imports/telemetry_observation_5a.py'
EXPECTED='e088c613a823f3fa44babcc14fd930195d6bb74f1016d1a70f7b4af030c3e4ea'
def exact_path(value):
    p=Path(value)
    if not p.is_absolute() or '..' in p.parts or not p.is_relative_to('/REQUIRED_BINDINGS/research-root'):
        raise ValueError('Explicit AWS worker path below /REQUIRED_BINDINGS/research-root required')
    return str(p)
def prepare(paths,output):
    raw=ORIGINAL.read_bytes()
    if hashlib.sha256(raw).hexdigest()!=EXPECTED:
        raise ValueError('Original telemetry observer changed')
    text=raw.decode()
    replacements=[
      ("SOURCE_PATH = BASE / 'training-source-5a36a8b3'",'SOURCE_PATH = Path('+repr(exact_path(paths['sourceDirectory']))+')'),
      ("    provider_path = BASE / 'provider-receipt.json'",'    provider_path = Path('+repr(exact_path(paths['providerReceiptPath']))+')'),
      ("    expected_path = BASE / 'artifacts' / ('serving-' + config['occurrenceId']) / 'serving-completed.json'",'    expected_path = Path('+repr(exact_path(paths['servingReceiptPath']))+')'),
      ("sha(BASE / 'provider-receipt.json')","sha(Path("+repr(exact_path(paths['providerReceiptPath']))+"))")]
    for old,new in replacements:
        if text.count(old)!=1: raise ValueError('Exact telemetry path seam changed')
        text=text.replace(old,new,1)
    # Every query, trace-selection, numerical proof, container inspection and archive
    # verifier body remains the original implementation. Only four path expressions change.
    oldtree=ast.parse(raw.decode());newtree=ast.parse(text)
    oldfunctions={n.name:ast.dump(n,include_attributes=False)for n in oldtree.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))}
    newfunctions={n.name:ast.dump(n,include_attributes=False)for n in newtree.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))}
    if set(oldfunctions)!=set(newfunctions) or [n for n in oldfunctions if oldfunctions[n]!=newfunctions[n]]!=['bindings','recheck_inputs']:
        raise ValueError('Unexpected telemetry function change')
    reverse=text
    for old,new in replacements: reverse=reverse.replace(new,old,1)
    if reverse.encode()!=raw: raise ValueError('Non-path source change')
    out=Path(output);out.parent.mkdir(parents=True,exist_ok=True)
    with out.open('xb') as f:f.write(text.encode())
    return {'kind':'acephale-aws-native-telemetry-path-adapter-v2','path':str(out),'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),
            'originalSourceSha256':EXPECTED,'pathBindings':paths,'onlyPathExpressionsChanged':4,'nativeProofGatesUnchanged':True,
            'maximumTraces':16,'nineActualContainerIdentitiesRequired':True,'persistedTempoEvidenceRequired':True,
            'actualWorkerInvocationPerformed':False}
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--paths',required=True);parser.add_argument('--output',required=True)
    args=parser.parse_args();print(json.dumps(prepare(json.loads(Path(args.paths).read_text()),args.output),sort_keys=True))
