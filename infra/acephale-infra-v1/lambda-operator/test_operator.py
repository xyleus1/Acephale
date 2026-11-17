import importlib.util
import json
import signal
import sys
import tarfile
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


bootstrap = load('bootstrap')
exports = load('verify_export')


class OperatorTests(unittest.TestCase):
    def test_exited_leader_still_gets_group_kill(self):
        class Exited:
            pid = 12345
            def wait(self, timeout):
                return 0
        calls = []
        with patch.object(bootstrap.signal, 'SIGKILL', 9, create=True), \
                patch.object(bootstrap, 'signal_group', side_effect=lambda process, number: calls.append(number)):
            bootstrap.drain_group(Exited())
        self.assertEqual(calls, [signal.SIGTERM, 9])

    def test_cleanup_failure_still_exports_failed_evidence(self):
        job = bootstrap.Bootstrap({'setupDeadline': time.time() + 300})
        job.processes.add(object())
        job.prepare = lambda: (_ for _ in ()).throw(ValueError('setup failed'))
        events, exports = [], []
        job.event = lambda phase, **fields: events.append(phase)
        job.export = exports.append
        with patch.object(bootstrap, 'drain_group', side_effect=TimeoutError('drain failed')), \
                self.assertRaisesRegex(RuntimeError, 'cleanup failed'):
            job.execute()
        self.assertEqual(exports, [False])
        self.assertEqual(events, ['bootstrap_failed', 'bootstrap_cleanup_failed'])

    def test_source_revision_must_be_explicit_and_complete(self):
        with tempfile.TemporaryDirectory() as directory:
            path, value = self.configuration(Path(directory))
            value['sourceCommit'] = 'main'
            path.write_text(json.dumps(value))
            with self.assertRaises(ValueError):
                bootstrap.load_config(path, now=100)

    def test_pinned_image_mismatch_stops_before_starting_any_service(self):
        job = bootstrap.Bootstrap({'setupDeadline': time.time() + 300,
                                   'operatorFiles': {name: bootstrap.sha(HERE / name) for name in bootstrap.OPERATOR_FILES}})
        locked = json.loads((HERE / 'images.pinned.json').read_text())
        job.versions = {'images': {name: row['requested'] for name, row in locked['images'].items()}}
        calls = []
        def run(argv, **_kwargs):
            calls.append(argv)
            if argv[:3] == ['docker', 'image', 'inspect']:
                return json.dumps([{'Id': 'sha256:' + '0' * 64, 'Architecture': 'amd64'}])
            return ''
        job.run = run
        with self.assertRaisesRegex(ValueError, 'Actual pulled image identity'):
            job.images_and_cpu()
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0][:4], ['docker', 'pull', '--platform', 'linux/amd64'])
        self.assertIn('@sha256:', calls[0][-1])

    def test_new_relay_socket_race_is_bounded_and_recovers(self):
        job = bootstrap.Bootstrap({'setupDeadline': time.time() + 300, 'hardDeadline': time.time() + 600,
                                   'leaseId': '12345678-abcd-abcd-abcd-123456789012'})
        ports = {'actor': 8000, 'predictor': 8001, 'alloy': 4318, 'prometheus': 9090, 'grafana': 3000}
        def container(service):
            target = 8000 if service == 'predictor' else ports[service]
            return {'Id': 'b' * 64, 'State': {'Running': True}, 'Config': {'Labels': {
                'com.docker.compose.project': 'acephale-infra-v1', 'com.docker.compose.service': service}},
                'NetworkSettings': {'Networks': {'acephale-infra-v1_research': {'IPAddress': '172.18.0.8'}},
                                    'Ports': {str(target) + '/tcp': [{'HostIp': '127.0.0.1', 'HostPort': str(ports[service])}]}}}
        calls = {}
        def http(url):
            calls[url] = calls.get(url, 0) + 1
            if calls[url] == 1:
                raise ConnectionRefusedError('socket not bound yet')
            return {}
        job.container, job.http, job.event = container, http, lambda *_args, **_kwargs: None
        with tempfile.TemporaryDirectory() as directory, patch.object(bootstrap, 'ARTIFACTS', Path(directory)), \
                patch.object(bootstrap, 'sha', return_value='c' * 64), patch.object(bootstrap.time, 'sleep') as sleep:
            job.relays()
            receipt = json.loads((Path(directory) / 'relay-receipt.json').read_text())
            self.assertEqual(len(receipt['relays']), 5)
            self.assertEqual(set(calls.values()), {2})
            self.assertEqual(sleep.call_count, 4)
    def configuration(self, root):
        for name in ['provider.json', 'orchestrator.json']:
            (root / name).write_text('{}')
        value = {'schemaVersion': 2, 'sourceCommit': 'a' * 40, 'leaseId': '12345678-abcd-abcd-abcd-123456789012',
                 'hardwareProfile': 'a100-40gb-v1', 'setupDeadline': 1800, 'hardDeadline': 3600,
                 'providerReceipt': 'provider.json', 'orchestratorInventory': 'orchestrator.json',
                 'operatorFiles': {name: bootstrap.sha(HERE / name) for name in bootstrap.OPERATOR_FILES}}
        path = root / 'configuration.json'
        path.write_text(json.dumps(value))
        return path, value

    def test_bounded_configuration_accepts_existing_receipts(self):
        with tempfile.TemporaryDirectory() as directory:
            path, _ = self.configuration(Path(directory))
            self.assertEqual(bootstrap.load_config(path, now=100)['hardwareProfile'], 'a100-40gb-v1')

    def test_expired_or_extended_setup_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path, value = self.configuration(Path(directory))
            for deadline in [100, 200, 1901, float('nan')]:
                value['setupDeadline'] = deadline
                path.write_text(json.dumps(value))
                with self.assertRaises(ValueError):
                    bootstrap.load_config(path, now=100)

    def test_provider_deadline_cannot_exceed_eight_hour_session(self):
        with tempfile.TemporaryDirectory() as directory:
            path, value = self.configuration(Path(directory))
            value['hardDeadline'] = 28900
            path.write_text(json.dumps(value))
            self.assertEqual(bootstrap.load_config(path, now=100)['hardDeadline'], 28900)
            value['hardDeadline'] = 28900.001
            path.write_text(json.dumps(value))
            with self.assertRaises(ValueError):
                bootstrap.load_config(path, now=100)

    def test_operator_hash_mismatch_is_rejected_before_cloud_commands(self):
        with tempfile.TemporaryDirectory() as directory:
            path, value = self.configuration(Path(directory))
            value['operatorFiles']['bootstrap.py'] = 'f' * 64
            path.write_text(json.dumps(value))
            with self.assertRaisesRegex(ValueError, 'package hashes'):
                bootstrap.load_config(path, now=100)

    def test_receipt_path_escape_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path, value = self.configuration(Path(directory))
            value['providerReceipt'] = '../provider.json'
            path.write_text(json.dumps(value))
            with self.assertRaises(ValueError):
                bootstrap.load_config(path, now=100)

    def container(self):
        return {'Id': 'b' * 64, 'State': {'Running': True}, 'Config': {'Labels': {
            'com.docker.compose.project': 'acephale-infra-v1', 'com.docker.compose.service': 'actor'}},
            'NetworkSettings': {'Networks': {'acephale-infra-v1_research': {'IPAddress': '172.18.0.8'}}}}

    def test_private_container_is_bound_to_exact_project(self):
        item = self.container()
        self.assertEqual(bootstrap.safe_container(item, 'actor'), '172.18.0.8')
        item['Config']['Labels']['com.docker.compose.project'] = 'unrelated'
        with self.assertRaises(ValueError):
            bootstrap.safe_container(item, 'actor')

    def test_egress_and_public_targets_rejected(self):
        for mutate in [lambda item: item['NetworkSettings']['Networks'].update(egress={}),
                       lambda item: item['NetworkSettings']['Networks']['acephale-infra-v1_research'].update(IPAddress='8.8.8.8')]:
            item = self.container()
            mutate(item)
            with self.assertRaises(ValueError):
                bootstrap.safe_container(item, 'actor')

    def archive(self, root):
        source = root / 'source'
        source.mkdir()
        (source / 'proof.json').write_text('{"fixture":true}')
        inventory = {'sourceCommit': 'a' * 40, 'leaseId': 'fixture', 'passed': False, 'files': [
            {'path': 'proof.json', 'bytes': (source / 'proof.json').stat().st_size, 'sha256': exports.sha(source / 'proof.json')}]}
        (source / 'export-inventory.json').write_text(json.dumps(inventory))
        archive = root / 'archive.tar.gz'
        with tarfile.open(archive, 'w:gz') as stream:
            stream.add(source, arcname='artifacts')
        receipt = root / 'receipt.json'
        receipt.write_text(json.dumps({'sha256': exports.sha(archive), 'bytes': archive.stat().st_size, 'qualificationAndInventoryPassed': False}))
        return archive, receipt

    def test_export_verifies_all_members_without_asserting_readiness(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive, receipt = self.archive(root)
            result = exports.verify(archive, receipt, root / 'verified', 'fixture', 'a' * 40)
            self.assertTrue(result['localExportVerified'])
            self.assertFalse(result['qualificationAndInventoryPassed'])
            self.assertFalse(result['providerReadyAsserted'])

    def test_export_rejects_tampered_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive, receipt = self.archive(root)
            with archive.open('ab') as stream:
                stream.write(b'tamper')
            with self.assertRaises(ValueError):
                exports.verify(archive, receipt, root / 'verified', 'fixture', 'a' * 40)

    def test_archive_path_escape_rejected_even_with_matching_transport_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive, receipt = self.archive(root)
            with tarfile.open(archive, 'w:gz') as stream:
                item = tarfile.TarInfo('../escape')
                stream.addfile(item)
            receipt.write_text(json.dumps({'sha256': exports.sha(archive), 'bytes': archive.stat().st_size, 'qualificationAndInventoryPassed': False}))
            with self.assertRaises(ValueError):
                exports.verify(archive, receipt, root / 'verified', 'fixture', 'a' * 40)

    def test_other_lease_or_source_archive_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive, receipt = self.archive(root)
            with self.assertRaises(ValueError):
                exports.verify(archive, receipt, root / 'wrong-lease', 'other', 'a' * 40)
            with self.assertRaises(ValueError):
                exports.verify(archive, receipt, root / 'wrong-source', 'fixture', 'b' * 40)

    def test_contradictory_qualification_flags_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive, receipt = self.archive(root)
            value = json.loads(receipt.read_text())
            value['qualificationAndInventoryPassed'] = True
            receipt.write_text(json.dumps(value))
            with self.assertRaises(ValueError):
                exports.verify(archive, receipt, root / 'verified', 'fixture', 'a' * 40)


@unittest.skipUnless(sys.platform == 'linux', 'Actual Linux process-group cleanup contract')
class LinuxProcessTests(unittest.TestCase):
    def command(self, root, wait):
        child = ("import os,pathlib,signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); "
                 f"pathlib.Path({str(root / 'child.pid')!r}).write_text(str(os.getpid())); time.sleep(60)")
        parent = ("import pathlib,subprocess,sys,time; "
                  f"subprocess.Popen([sys.executable,'-c',{child!r}]); p=pathlib.Path({str(root / 'child.pid')!r})\n"
                  "while not p.exists(): time.sleep(.01)\n"
                  "print('fixture log retained',flush=True)\n" + ("time.sleep(60)\n" if wait else ""))
        return [sys.executable, '-c', parent]

    def assert_stopped(self, root):
        pid = int((root / 'child.pid').read_text())
        end = time.monotonic() + 5
        while time.monotonic() < end:
            path = Path(f'/proc/{pid}/stat')
            if not path.exists() or path.read_text().split(') ', 1)[1].startswith(('Z ', 'X ')):
                return
            time.sleep(.025)
        self.fail('Descendant survived owned process-group cleanup')

    def test_normal_leader_exit_and_timeout_both_stop_ignoring_descendant(self):
        for timed_out in (False, True):
            with self.subTest(timed_out=timed_out), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                job = bootstrap.Bootstrap({'setupDeadline': time.time() + 300})
                with patch.object(bootstrap, 'ARTIFACTS', root):
                    if timed_out:
                        with self.assertRaises(TimeoutError):
                            job.run(self.command(root, True), timeout=.5, cwd=root)
                    else:
                        self.assertEqual(job.run(self.command(root, False), timeout=5, cwd=root), 0)
                self.assertFalse(job.processes)
                self.assert_stopped(root)
                self.assertIn('fixture log retained', next(root.glob('*.log')).read_text())

    def test_parallel_failure_drains_other_group_and_preserves_partial_capture(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            job = bootstrap.Bootstrap({'setupDeadline': time.time() + 300})

            def fail():
                end = time.monotonic() + 5
                while not (root / 'child.pid').exists():
                    if time.monotonic() >= end:
                        raise TimeoutError('Child did not start')
                    time.sleep(.025)
                # Wait until the parent has flushed its diagnostic.
                time.sleep(.1)
                raise ValueError('Independent qualification failed')

            with patch.object(bootstrap, 'ARTIFACTS', root), self.assertRaisesRegex(ValueError, 'Independent qualification'):
                job.parallel([lambda: job.run(self.command(root, True), timeout=30, capture=True, cwd=root), fail])
            self.assertFalse(job.processes)
            self.assert_stopped(root)
            self.assertIn('fixture log retained', next(root.glob('*.log')).read_text())


if __name__ == '__main__':
    unittest.main()
