"""Bounded operator bootstrap. Requires a separately reserved, enrolled GPU lease.

This script never launches or terminates cloud instances, opens public ports,
reads hosted API credentials, changes budgets, or marks provider readiness.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import ipaddress
import json
import math
import os
import re
import secrets
import shutil
import signal
import subprocess
import sys
import tarfile
import threading
import time
import urllib.request
from pathlib import Path

BASE = Path('/srv/acephale')
SOURCE = BASE / 'source'
ARTIFACTS = BASE / 'artifacts'
PACKAGE = Path(__file__).resolve().parent
COMPOSE_PROJECT = 'acephale-infra-v1'
OPERATOR_FILES = {'bootstrap.py', 'bootstrap.sh', 'serving-qualification.mjs', 'images.pinned.json'}
SHA = re.compile(r'[a-f0-9]{40}\Z')
LEASE = re.compile(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\Z')


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def write_new(path, value):
    with Path(path).open('x', encoding='utf-8') as stream:
        json.dump(value, stream, indent=2, ensure_ascii=False, allow_nan=False)
        stream.write('\n')


def load_config(path, now=None):
    now = time.time() if now is None else now
    value = json.loads(Path(path).read_text(encoding='utf-8-sig'))
    if (value.get('schemaVersion') != 2 or not SHA.fullmatch(value.get('sourceCommit', ''))
            or not LEASE.fullmatch(value.get('leaseId', '')) or value.get('hardwareProfile') != 'a100-40gb-v1'
            or type(value.get('setupDeadline')) not in (float, int)
            or type(value.get('hardDeadline')) not in (float, int)
            or not math.isfinite(value['setupDeadline']) or not math.isfinite(value['hardDeadline'])
            or not now + 120 < value['setupDeadline'] <= now + 1800
            or not value['setupDeadline'] < value['hardDeadline'] <= now + 8 * 3600):
        raise ValueError('Exact source, A100 profile and active bounded lease deadlines required')
    hashes = value.get('operatorFiles', {})
    if set(hashes) != OPERATOR_FILES or any(not re.fullmatch(r'[a-f0-9]{64}', hashes[name])
        or not (PACKAGE / name).is_file() or (PACKAGE / name).is_symlink()
        or sha(PACKAGE / name) != hashes[name] for name in OPERATOR_FILES):
        raise ValueError('Exact source-bound operator package hashes required')
    for key in ('providerReceipt', 'orchestratorInventory'):
        item = value.get(key)
        if not isinstance(item, str) or Path(item).name != item or not item.endswith('.json'):
            raise ValueError('Receipt paths must name regular JSON files beside the configuration')
        receipt = Path(path).resolve().parent / item
        if receipt.is_symlink() or not receipt.is_file():
            raise ValueError('Missing regular operator receipt')
        value[key] = str(receipt)
    return value


def safe_container(item, service):
    labels = item.get('Config', {}).get('Labels', {})
    networks = item.get('NetworkSettings', {}).get('Networks', {})
    network = COMPOSE_PROJECT + '_research'
    if (not item.get('State', {}).get('Running') or not re.fullmatch(r'[a-f0-9]{64}', item.get('Id', ''))
            or labels.get('com.docker.compose.project') != COMPOSE_PROJECT
            or labels.get('com.docker.compose.service') != service or network not in networks):
        raise ValueError('Running task-owned container required')
    address = networks[network].get('IPAddress', '')
    if not ipaddress.ip_address(address).is_private:
        raise ValueError('Private research bridge address required')
    if service in {'actor', 'predictor', 'postgres'} and set(networks) != {network}:
        raise ValueError('Models and research database must have no egress network')
    return address


def signal_group(process, number):
    try:
        os.killpg(process.pid, number)
    except ProcessLookupError:
        pass


def drain_group(process):
    """A leader exiting does not establish that its descendants have stopped."""
    signal_group(process, signal.SIGTERM)
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        pass
    finally:
        # Always kill remaining group members, including after a successful leader.
        signal_group(process, signal.SIGKILL)
    process.wait(timeout=5)


class Bootstrap:
    def __init__(self, configuration):
        self.configuration = configuration
        self.deadline = configuration['setupDeadline'] - 45
        self.processes = set()
        self.mutex = threading.Lock()
        self.log_sequence = 0
        self.aborted = threading.Event()
        self.environment = {k: v for k, v in os.environ.items() if k not in {
            'OPENAI_API_KEY', 'LAMBDA_API_KEY', 'HF_TOKEN', 'HUGGING_FACE_HUB_TOKEN', 'DOCKER_HOST', 'DOCKER_CONTEXT'}}
        self.environment.update(ACEPHALE_MODELS_DIR=str(BASE / 'models'), ACEPHALE_ARTIFACTS_DIR=str(ARTIFACTS),
            ACEPHALE_POSTGRES_PASSWORD_FILE=str(BASE / 'secrets/postgres.password'),
            ACEPHALE_GRAFANA_PASSWORD_FILE=str(BASE / 'secrets/grafana.password'), PYTHONDONTWRITEBYTECODE='1')
        self.compose = ['docker', 'compose', '-f', str(SOURCE / 'infra/acephale-infra-v1/compose.resolved.json')]
        self.control = ['python3', str(SOURCE / 'infra/acephale-infra-v1/control.py')]

    def remaining(self):
        if self.aborted.is_set():
            raise RuntimeError('Another required bootstrap phase failed')
        remaining = self.deadline - time.time()
        if remaining <= 0:
            raise TimeoutError('Setup deadline reached; no readiness asserted')
        return remaining

    def event(self, phase, **fields):
        row = {'phase': phase, 'timestamp': time.time(), 'secondsUntilSetupDeadline': self.configuration['setupDeadline'] - time.time(), **fields}
        with self.mutex, (ARTIFACTS / 'bootstrap-events.jsonl').open('a', encoding='utf-8') as stream:
            stream.write(json.dumps(row, allow_nan=False) + '\n')
        print(json.dumps(row, allow_nan=False), flush=True)

    def run(self, argv, *, timeout=600, capture=False, name=None, check=True, cwd=SOURCE):
        with self.mutex:
            self.log_sequence += 1
            path = ARTIFACTS / f'{self.log_sequence:03d}-{name or Path(argv[0]).name}.log'
        with path.open('x', encoding='utf-8') as stream:
            with self.mutex:
                limit = min(timeout, self.remaining())
                process = subprocess.Popen(argv, cwd=cwd, env=self.environment, stdout=subprocess.PIPE if capture else stream,
                                           stderr=stream, text=True, start_new_session=True)
                self.processes.add(process)
            end = time.monotonic() + limit
            stdout = None
            try:
                while True:
                    self.remaining()
                    left = end - time.monotonic()
                    if left <= 0:
                        raise TimeoutError(f'Bounded command exceeded limit: {path.name}')
                    try:
                        stdout, _ = process.communicate(timeout=min(0.25, left))
                        break
                    except subprocess.TimeoutExpired:
                        continue
            finally:
                drain_group(process)
                # communicate keeps partial captured output across timeout retries.
                if capture:
                    if stdout is None:
                        stdout, _ = process.communicate(timeout=5)
                    if stdout:
                        stream.write(stdout)
                with self.mutex:
                    self.processes.discard(process)
        if process.returncode and check:
            raise RuntimeError(f'Command failed; retained {path.name}, exit {process.returncode}')
        return (stdout or '').strip() if capture else process.returncode

    def container(self, service):
        return json.loads(self.run(['docker', 'inspect', f'{COMPOSE_PROJECT}-{service}-1'], capture=True, name=f'inspect-{service}'))[0]

    def http(self, url, *, timeout=3):
        with urllib.request.urlopen(url, timeout=min(timeout, self.remaining())) as response:
            if response.status != 200:
                raise ValueError('Health endpoint did not return success')
            data = response.read()
            content_type = response.headers.get('Content-Type', '')
        return json.loads(data) if data and 'json' in content_type else data.decode('utf-8') if data else None

    def parallel(self, operations):
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(operations)) as pool:
            futures = [pool.submit(operation) for operation in operations]
            try:
                for future in concurrent.futures.as_completed(futures):
                    future.result()
            except BaseException:
                self.aborted.set()
                with self.mutex:
                    for process in list(self.processes):
                        signal_group(process, signal.SIGTERM)
                # The executor joins each operation; run() drains its whole group
                # on the next bounded communicate poll before that operation exits.
                raise

    def wait_health(self, service, port, path, limit=300):
        until = min(self.deadline, time.time() + limit)
        while time.time() < until:
            item = self.container(service)
            address = safe_container(item, service)
            try:
                result = self.http(f'http://{address}:{port}{path}')
                self.event(service + '_healthy', containerId=item['Id'], address=address)
                return result
            except (OSError, ValueError):
                time.sleep(min(3, self.remaining()))
        raise TimeoutError(f'{service} health deadline exceeded')

    def prepare(self):
        if SOURCE.exists() or (BASE / 'secrets').exists():
            raise ValueError('Bootstrap requires a fresh research host, not an existing deployment')
        self.run(['git', 'clone', '--no-checkout', 'https://github.com/xyleus1/Acephale.git', str(SOURCE)], cwd=BASE)
        self.run(['git', 'checkout', '--detach', self.configuration['sourceCommit']])
        self.run(['chmod', '-R', 'a+rX', str(SOURCE)])
        if self.run(['git', 'rev-parse', 'HEAD'], capture=True) != self.configuration['sourceCommit']:
            raise ValueError('Source commit mismatch')
        if self.run(['git', 'status', '--porcelain=v1', '--untracked-files=normal'], capture=True):
            raise ValueError('Dirty source checkout')
        for name, expected in self.configuration['operatorFiles'].items():
            if sha(SOURCE / 'infra/acephale-infra-v1/lambda-operator' / name) != expected:
                raise ValueError('Executing operator differs from the pinned source checkout')
        for name, mode in [('models', 0o750), ('secrets', 0o700)]:
            (BASE / name).mkdir(mode=mode)
        for name in ('postgres', 'grafana'):
            path = BASE / 'secrets' / (name + '.password')
            with path.open('x', encoding='utf-8') as stream:
                stream.write(secrets.token_urlsafe(48) + '\n')
            path.chmod(0o444)
        # Directory 0700 protects the two exact secret bind mounts. Never export it.
        with (BASE / 'serving.env').open('x', encoding='utf-8') as stream:
            stream.write(''.join('export ' + key + '=' + value + '\n' for key, value in self.environment.items() if key.startswith('ACEPHALE_')))
        self.run(['setfacl', '-m', 'u:1000:rwx,u:10001:rwx', str(ARTIFACTS)])
        self.run(['setfacl', '-d', '-m', 'u:1000:rwx,u:10001:rwx', str(ARTIFACTS)])
        self.run(['python3', '-m', 'venv', str(BASE / 'downloader')])
        self.run([str(BASE / 'downloader/bin/python'), '-m', 'pip', 'install', '--disable-pip-version-check', 'huggingface_hub==2.4.0'])
        for key, destination in [('providerReceipt', 'provider-receipt.json'), ('orchestratorInventory', 'orchestrator-inventory.json')]:
            shutil.copyfile(self.configuration[key], BASE / destination)
        if any(sha(PACKAGE / name) != self.configuration['operatorFiles'][name]
               for name in ('serving-qualification.mjs', 'images.pinned.json')):
            raise ValueError('Reviewed qualification or image-lock input changed')
        shutil.copyfile(PACKAGE / 'serving-qualification.mjs', ARTIFACTS / 'serving-qualification.mjs')
        shutil.copyfile(PACKAGE / 'images.pinned.json', ARTIFACTS / 'images.pinned.json')
        provider = json.loads((BASE / 'provider-receipt.json').read_text())
        if provider.get('leaseId') != self.configuration['leaseId']:
            raise ValueError('Provider identity is for a different lease')
        preflight = json.loads(self.run(self.control + ['preflight', '--hardware-profile', self.configuration['hardwareProfile']], capture=True))
        if preflight.get('readyForGpuExecution') is not True:
            raise ValueError('Hardware preflight failed')
        write_new(ARTIFACTS / 'host-preflight.json', preflight)
        write_new(ARTIFACTS / 'config-validation.json', json.loads(self.run(self.control + ['validate-config'], capture=True)))
        sys.path.insert(0, str(SOURCE / 'infra/acephale-infra-v1'))
        import collect_inventory
        self.inventory = collect_inventory
        self.versions = self.inventory.read(SOURCE / 'infra/acephale-infra-v1/versions.json')
        self.inventory.checked_orchestrator(self.inventory.read(BASE / 'orchestrator-inventory.json'), self.configuration['sourceCommit'], self.versions)
        self.inventory.lambda_identity(BASE / 'provider-receipt.json', Path('/'), self.inventory.hardware_profile(self.configuration['hardwareProfile']))
        self.event('host_source_and_identity_passed')

    def early_serving_image(self):
        pin = self.versions['images']['vllm']
        self.run(['docker', 'pull', '--platform', 'linux/amd64', pin], name='serving-image-pull')
        item = json.loads(self.run(['docker', 'image', 'inspect', pin], capture=True, name='serving-image-inspect'))[0]
        if item.get('Architecture') != 'amd64' or not any(value.endswith('@' + pin.split('@')[1]) for value in item.get('RepoDigests', [])):
            raise ValueError('Serving image digest or architecture mismatch')
        rows = self.run(['docker', 'image', 'inspect', '--format', self.inventory.IMAGE_CUDA_PROBE, item['Id']], capture=True)
        image_cuda = self.inventory.image_cuda_identity(rows, item['Id'], pin)
        packages = json.loads(self.run(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=128m',
            '--env', 'PYTHONDONTWRITEBYTECODE=1', '--env', 'HF_HUB_OFFLINE=1', '--env', 'VLLM_NO_USAGE_STATS=1',
            '--entrypoint', 'python3', pin, '-B', '-c', self.inventory.SERVING_PROBE], capture=True, name='early-serving-packages', timeout=120))
        result = self.inventory.validate_serving_packages(packages, image_cuda, self.versions)
        write_new(ARTIFACTS / 'early-serving-image.json', {'passed': True, 'sourceCommit': self.configuration['sourceCommit'],
            'imageId': item['Id'], 'imageDigest': pin, 'repoDigests': item['RepoDigests'], 'packages': result,
            'modelCalls': 0, 'gpuInference': False})
        self.event('early_exact_serving_image_passed', imageId=item['Id'])

    def images_and_cpu(self):
        # Restore the exact previously qualified image identities, not current tag resolutions.
        original = PACKAGE / 'images.pinned.json'
        if sha(original) != self.configuration['operatorFiles']['images.pinned.json']:
            raise ValueError('Previously qualified image lock changed')
        locked = json.loads(original.read_text())
        if locked.get('profile') != 'acephale-infra-v1' or set(locked.get('images', {})) != set(self.versions['images']):
            raise ValueError('Complete qualified image lock required')
        for name, requested in self.versions['images'].items():
            row = locked['images'][name]
            if row.get('requested') != requested or not re.fullmatch(r'.+@sha256:[a-f0-9]{64}', row.get('pinned', '')):
                raise ValueError('Previously qualified image pin differs from frozen source')
            self.run(['docker', 'pull', '--platform', 'linux/amd64', row['pinned']], name=name + '-pinned-pull')
            observed = json.loads(self.run(['docker', 'image', 'inspect', row['pinned']], capture=True, name=name + '-pinned-inspect'))[0]
            if observed.get('Id') != row['imageId'] or observed.get('Architecture') != 'amd64':
                raise ValueError('Actual pulled image identity differs from the qualified lock')
        write_new(SOURCE / 'infra/acephale-infra-v1/images.resolved.json', locked)
        self.run(self.control + ['locked-compose', '--lock', 'infra/acephale-infra-v1/images.resolved.json',
            '--hardware-profile', self.configuration['hardwareProfile'], '--output', 'infra/acephale-infra-v1/compose.resolved.json'], name='compose-lock')
        self.run(self.compose + ['--profile', 'gpu', '--profile', 'runtime', 'config', '--quiet'])
        self.run(self.compose + ['run', '--rm', '--no-deps', 'tempo', '-config.file=/etc/tempo/tempo.json', '-config.verify=true'], name='tempo-config-verify')
        self.run(self.compose + ['up', '-d', '--build', 'postgres', 'prometheus', 'tempo', 'loki', 'alloy', 'grafana', 'acephale-runtime'], name='cpu-stack-start')
        self.wait_health('acephale-runtime', 4319, '/health', limit=120)
        self.wait_health('grafana', 3000, '/api/health', limit=120)
        self.event('cpu_stack_started')

    def models(self):
        self.run([str(BASE / 'downloader/bin/python'), str(SOURCE / 'infra/acephale-infra-v1/control.py'),
            'download-models', '--root', str(BASE / 'models')], name='pinned-model-download', timeout=900)
        self.event('pinned_models_downloaded')

    def serving(self):
        self.parallel([self.images_and_cpu, self.models])
        network = json.loads(self.run(['docker', 'network', 'inspect', COMPOSE_PROJECT + '_research'], capture=True))[0]
        if network.get('Internal') is not True:
            raise ValueError('Research bridge must remain isolated')
        self.run(self.compose + ['up', '-d', 'predictor'], name='predictor-start')
        self.wait_health('predictor', 8000, '/health', limit=360)
        # Profiling must see stable predictor residency, avoiding cross-process allocation noise.
        self.run(self.compose + ['up', '-d', 'actor'], name='actor-start')
        self.wait_health('actor', 8000, '/health', limit=420)
        self.wait_health('predictor', 8000, '/health', limit=30)
        query = "SELECT json_build_object('serverVersion',current_setting('server_version'),'vectorVersion',(SELECT extversion FROM pg_extension WHERE extname='vector'),'memoryTableExists',EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='acephale' AND c.relname='memory_checkpoint' AND c.relkind='r'));"
        database = json.loads(self.run(['docker', 'exec', COMPOSE_PROJECT + '-postgres-1', 'psql', '-U', 'acephale', '-d', 'acephale_research', '-At', '-v', 'ON_ERROR_STOP=1', '-c', query], capture=True, name='database-identity'))
        if database['serverVersion'].split()[0] != self.versions['requiredPostgresVersion'] or database['vectorVersion'] != self.versions['requiredVectorVersion'] or database['memoryTableExists'] is not True:
            raise ValueError('Database version or initialization mismatch')
        write_new(ARTIFACTS / 'database-identity.json', database)
        self.event('concurrent_models_and_database_passed')

    def relays(self):
        rows = []
        for service, listen, target in [('actor', 8000, 8000), ('predictor', 8001, 8000), ('alloy', 4318, 4318), ('prometheus', 9090, 9090), ('grafana', 3000, 3000)]:
            item = self.container(service)
            address = safe_container(item, service)
            published = item['NetworkSettings']['Ports'].get(str(target) + '/tcp')
            record = {'service': service, 'containerId': item['Id'], 'address': address, 'targetPort': target, 'listenAddress': '127.0.0.1', 'listenPort': listen}
            if published:
                if published != [{'HostIp': '127.0.0.1', 'HostPort': str(listen)}]:
                    raise ValueError('Unexpected native published listener')
                record.update(mode='docker-loopback', unit=None, pid=None)
            else:
                unit = 'acephale-' + self.configuration['leaseId'].split('-')[0] + '-' + service + '-relay'
                self.run(['sudo', '-n', 'systemd-run', '--unit=' + unit, '--property=User=ubuntu', '--property=Group=ubuntu',
                    '--property=NoNewPrivileges=true', '--property=PrivateTmp=true', '--property=ProtectSystem=strict',
                    '--property=ProtectHome=true', '--property=RuntimeMaxSec=' + str(int(self.configuration['hardDeadline'] - time.time())),
                    '--property=Restart=no', '--property=MemoryMax=128M', '--property=TasksMax=64', '--property=KillMode=control-group',
                    '/usr/bin/socat', f'TCP4-LISTEN:{listen},bind=127.0.0.1,reuseaddr,fork', f'TCP4:{address}:{target}'])
                pid = int(self.run(['systemctl', 'show', unit, '--property=MainPID', '--value'], capture=True))
                if pid <= 0:
                    raise ValueError('Relay failed to start')
                record.update(mode='systemd-socat-loopback', unit=unit, pid=pid)
            rows.append(record)
        for url in ['http://127.0.0.1:8000/health', 'http://127.0.0.1:8001/health',
                    'http://127.0.0.1:9090/-/ready', 'http://127.0.0.1:3000/api/health']:
            for attempt in range(10):
                try:
                    self.http(url)
                    break
                except OSError:
                    if attempt == 9:
                        raise
                    time.sleep(min(2, self.remaining()))
        write_new(ARTIFACTS / 'relay-receipt.json', {'schemaVersion': 1, 'leaseId': self.configuration['leaseId'],
            'observedAt': time.time(), 'deadline': self.configuration['hardDeadline'], 'socatSha256': sha('/usr/bin/socat'), 'relays': rows})
        self.event('loopback_relays_passed')

    def qualify(self):
        self.run(self.compose + ['exec', '-T', 'acephale-runtime', 'node', '--import', 'tsx', '/artifacts/serving-qualification.mjs',
            '/artifacts/qualification-01', str(self.deadline), self.configuration['sourceCommit']], timeout=180, name='protocol-and-telemetry-qualification')
        qualification = json.loads((ARTIFACTS / 'qualification-01/qualification.json').read_text())
        if qualification.get('passed') is not True or qualification.get('nativeBenchmarkScore') is not False:
            raise ValueError('No actual infrastructure qualification pass')
        self.event('protocol_and_telemetry_passed')

    def collect(self):
        self.run(['python3', str(SOURCE / 'infra/acephale-infra-v1/collect_inventory.py'), '--models-root', str(BASE / 'models'),
            '--images-lock', str(SOURCE / 'infra/acephale-infra-v1/images.resolved.json'), '--provider-receipt', str(BASE / 'provider-receipt.json'),
            '--orchestrator-inventory', str(BASE / 'orchestrator-inventory.json'), '--hardware-profile', self.configuration['hardwareProfile'],
            '--output', str(ARTIFACTS / 'deployment-inventory-01')], timeout=240, name='final-inventory')
        self.event('final_observed_inventory_passed')

    def export(self, passed):
        for service in ['actor', 'predictor', 'postgres', 'alloy', 'tempo', 'loki', 'acephale-runtime']:
            path = ARTIFACTS / (service + '-container.log')
            with path.open('x', encoding='utf-8') as stream:
                try:
                    subprocess.run(['docker', 'logs', '--tail', '2000', f'{COMPOSE_PROJECT}-{service}-1'], stdout=stream, stderr=stream, timeout=5, check=False)
                except (OSError, subprocess.TimeoutExpired):
                    stream.write('\nDiagnostic log collection unavailable; no check inferred.\n')
        for name in ['images.resolved.json', 'compose.resolved.json']:
            original = SOURCE / 'infra/acephale-infra-v1' / name
            if original.is_file():
                shutil.copyfile(original, ARTIFACTS / name)
        for role in ['actor', 'predictor']:
            original = BASE / 'models' / role / 'acephale-model.receipt.json'
            if original.is_file():
                shutil.copyfile(original, ARTIFACTS / (role + '-model.receipt.json'))
        for name in ['provider-receipt.json', 'orchestrator-inventory.json']:
            if (BASE / name).is_file():
                shutil.copyfile(BASE / name, ARTIFACTS / name)
        archive = BASE / 'readiness-evidence.tar.gz'
        inventory = [{'path': path.relative_to(ARTIFACTS).as_posix(), 'bytes': path.stat().st_size, 'sha256': sha(path)}
                     for path in sorted(ARTIFACTS.rglob('*')) if path.is_file() and not path.is_symlink()]
        write_new(ARTIFACTS / 'export-inventory.json', {'schemaVersion': 1, 'files': inventory, 'passed': passed,
            'sourceCommit': self.configuration['sourceCommit'], 'leaseId': self.configuration['leaseId'], 'nativeBenchmarkScore': False})
        with tarfile.open(archive, 'w:gz') as output:
            output.add(ARTIFACTS, arcname='artifacts', recursive=True)
        receipt = {'archive': str(archive), 'bytes': archive.stat().st_size, 'sha256': sha(archive), 'qualificationAndInventoryPassed': passed,
            'remoteArchiveOnly': True, 'localExportVerified': False, 'providerReadyAsserted': False, 'nativeBenchmarkScore': False}
        write_new(BASE / 'readiness-export.json', receipt)
        print(json.dumps(receipt), flush=True)
        return receipt

    def execute(self):
        passed = False
        try:
            self.prepare()
            self.early_serving_image()
            self.serving()
            self.relays()
            self.parallel([self.qualify, self.collect])
            self.remaining()
            passed = True
        except BaseException as error:
            self.event('bootstrap_failed', errorType=type(error).__name__, error=str(error))
            raise
        finally:
            failures = []
            self.aborted.set()
            with self.mutex:
                processes = list(self.processes)
            for process in processes:
                try:
                    drain_group(process)
                except (OSError, subprocess.SubprocessError) as error:
                    failures.append(type(error).__name__)
            if failures:
                self.event('bootstrap_cleanup_failed', errorTypes=failures)
            self.export(passed and not failures)
            if failures:
                raise RuntimeError('Bootstrap process cleanup failed; export retained')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--validate-only', action='store_true')
    args = parser.parse_args()
    configuration = load_config(args.config)
    if args.validate_only:
        print(json.dumps({'operatorConfigurationValid': True, 'cloudActions': 0}))
        return
    if sys.platform != 'linux' or os.getuid() == 0:
        raise ValueError('Run on the actual Linux host as the ordinary operator')
    subprocess.run(['sudo', '-n', 'install', '-d', '-o', 'ubuntu', '-g', 'ubuntu', '-m', '0750', str(BASE)], check=True)
    ARTIFACTS.mkdir(mode=0o750, exist_ok=False)
    write_new(ARTIFACTS / 'bootstrap-configuration.json', {k: v for k, v in configuration.items() if k not in {'providerReceipt', 'orchestratorInventory'}})
    shutil.copyfile(__file__, ARTIFACTS / 'operator-bootstrap.py')
    if (PACKAGE / 'prerequisites.log').is_file():
        shutil.copyfile(PACKAGE / 'prerequisites.log', ARTIFACTS / 'prerequisites.log')
    Bootstrap(configuration).execute()


if __name__ == '__main__':
    main()
