"""Verify a received operator archive without accepting path escapes or links."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import tarfile


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def verify(archive, receipt_path, output, expected_lease_id, expected_source_commit):
    receipt = json.loads(receipt_path.read_text(encoding='utf-8'))
    if sha(archive) != receipt['sha256'] or archive.stat().st_size != receipt['bytes']:
        raise ValueError('Transferred archive differs from remote export')
    output.mkdir(exist_ok=False)
    with tarfile.open(archive, 'r:gz') as source:
        for item in source.getmembers():
            path = PurePosixPath(item.name)
            if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0] != 'artifacts' or not (item.isfile() or item.isdir()):
                raise ValueError('Unsafe archive member')
        source.extractall(output, filter='data')
    inventory = json.loads((output / 'artifacts/export-inventory.json').read_text(encoding='utf-8'))
    if (inventory.get('leaseId') != expected_lease_id or inventory.get('sourceCommit') != expected_source_commit
            or type(inventory.get('passed')) is not bool or type(receipt.get('qualificationAndInventoryPassed')) is not bool
            or inventory['passed'] != receipt['qualificationAndInventoryPassed']):
        raise ValueError('Export lease, source or qualification flags differ from expected operator inputs')
    names = set()
    for item in inventory['files']:
        relative = PurePosixPath(item['path'])
        if relative.is_absolute() or '..' in relative.parts or relative.as_posix() in names:
            raise ValueError('Invalid export inventory member')
        path = output / 'artifacts' / relative
        if path.is_symlink() or not path.is_file() or path.stat().st_size != item['bytes'] or sha(path) != item['sha256']:
            raise ValueError('Export member checksum mismatch')
        names.add(relative.as_posix())
    actual = {path.relative_to(output / 'artifacts').as_posix() for path in (output / 'artifacts').rglob('*') if path.is_file()}
    if actual != names | {'export-inventory.json'}:
        raise ValueError('Export inventory is incomplete')
    result = {'schemaVersion': 1, 'archiveSha256': receipt['sha256'], 'filesVerified': len(names),
        'qualificationAndInventoryPassed': receipt['qualificationAndInventoryPassed'], 'localExportVerified': True,
        'sourceCommit': inventory['sourceCommit'], 'leaseId': inventory['leaseId'], 'providerReadyAsserted': False,
        'nativeBenchmarkScore': False}
    with (output / 'local-export-verification.json').open('x', encoding='utf-8') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--receipt', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--expected-lease-id', required=True)
    parser.add_argument('--expected-source-commit', required=True)
    args = parser.parse_args()
    print(json.dumps(verify(args.archive, args.receipt, args.output, args.expected_lease_id, args.expected_source_commit)))
