"""Bound hash retention without caching authority observations or loop state."""
import io
import json
import unittest
from contextlib import ExitStack
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

import control
import lambda_watchdog_deploy as deployment
import rfc8785


class EndpointConnectionError(Exception):
    pass


class HeartbeatDigestTests(unittest.TestCase):
    def test_large_authorities_reuse_fixed_size_keys(self):
        values = [{'policy': character * (5 * 1024 * 1024)} for character in ('a', 'b')]
        with patch.object(rfc8785, 'dumps', wraps=rfc8785.dumps) as canonical:
            with control.budget_digest_scope():
                for value in values * 3:
                    self.assertEqual(len(control._canonical_memo_key(value)), 32)
                    control._budget_digest(value)
                cache = control._BUDGET_DIGEST_CACHE.get()
                self.assertEqual(len(cache['values']), 2)
                self.assertEqual(cache['bytes'], 64)
            self.assertEqual(canonical.call_count, 2)
        self.assertIsNone(control._BUDGET_DIGEST_CACHE.get())

    def exercise(self, *, two_ticks=False, retry=False, mutate=False):
        scopes, observed_hashes, sleeps, published, events = [], [], [], [], []
        reads = 0
        get_calls = 0
        terminal_read = 8 if two_ticks else 6 if retry else 4
        with TemporaryDirectory() as directory:
            authority = Path(directory) / 'authority.json'
            authority.write_text('{"policy":1}', encoding='utf-8')

            def state(*_):
                nonlocal reads
                reads += 1
                if mutate and reads == 3:
                    authority.write_text('{"policy":2}', encoding='utf-8')
                scopes.append(control._BUDGET_DIGEST_CACHE.get())
                digest = control._budget_digest(control.read_json(authority))
                observed_hashes.append(digest)
                return {'leaseId': 'owned', 'instanceId': 'instance', 'expectedName': 'exact',
                        'planHash': digest, 'setupDeadline': 500, 'deadline': 1000,
                        'status': 'terminated' if reads == terminal_read else 'active',
                        'ready': True, 'ownerHeartbeatAt': 100, 'ownerHeartbeatTimeoutSeconds': 120}

            class Client:
                exceptions = SimpleNamespace(NoSuchKey=KeyError)

                def get_object(self, **_):
                    nonlocal get_calls
                    get_calls += 1
                    if retry and get_calls == 1:
                        raise EndpointConnectionError('not retained')
                    return {'Body': io.BytesIO(b'{"leaseId":"owned"}')}

                def put_object(self, **kwargs):
                    published.append(json.loads(kwargs['Body']))

            def sleep(seconds):
                if seconds == 20:
                    self.assertIsNone(control._BUDGET_DIGEST_CACHE.get())
                sleeps.append(seconds)

            receipt = {'config': {}, 'controllers': [
                {'region': 'east', 'bucket': 'east', 'account': '1'},
                {'region': 'west', 'bucket': 'west', 'account': '1'}]}
            with ExitStack() as stack:
                stack.enter_context(patch.dict('sys.modules', {
                    'botocore.config': SimpleNamespace(Config=lambda **kwargs: kwargs)}))
                stack.enter_context(patch.object(deployment, 'checked_receipt', return_value=receipt))
                stack.enter_context(patch.object(deployment, 'session',
                    return_value=SimpleNamespace(client=lambda *args, **kwargs: Client())))
                stack.enter_context(patch.object(deployment.time, 'time', return_value=100))
                canonical = stack.enter_context(patch.object(rfc8785, 'dumps', wraps=rfc8785.dumps))
                invocation = lambda: deployment.heartbeat('receipt', 'ledger', 'owned', state_fn=state,
                    publish_fn=lambda *args, **kwargs: deployment.publish(*args, state_fn=state, **kwargs),
                    clock=lambda: 100, sleeper=sleep, emit=events.append)
                if mutate:
                    with self.assertRaisesRegex(ValueError, 'authority changed'):
                        invocation()
                else:
                    invocation()
                encodings = canonical.call_count
        self.assertIsNone(control._BUDGET_DIGEST_CACHE.get())
        return scopes, reads, encodings, sleeps, published, observed_hashes, events

    def test_all_four_real_publication_reads_share_one_scope(self):
        scopes, reads, encodings, sleeps, published, _, _ = self.exercise()
        self.assertEqual((reads, encodings, sleeps, len(published)), (4, 1, [], 2))
        self.assertTrue(all(scope is scopes[0] for scope in scopes))
        self.assertIsNotNone(scopes[0])

    def test_next_tick_gets_an_empty_independent_scope(self):
        scopes, reads, encodings, sleeps, published, _, _ = self.exercise(two_ticks=True)
        self.assertEqual((reads, encodings, sleeps, len(published)), (8, 2, [20], 4))
        self.assertIsNot(scopes[0], scopes[4])
        self.assertTrue(all(scope is scopes[4] for scope in scopes[4:]))

    def test_transport_retry_gets_a_new_scope_and_keeps_real_reads(self):
        scopes, reads, encodings, sleeps, published, _, events = self.exercise(retry=True)
        self.assertEqual((reads, encodings, sleeps, len(published)), (6, 2, [2], 2))
        self.assertIsNot(scopes[0], scopes[2])
        self.assertTrue(all(scope is scopes[2] for scope in scopes[2:]))
        self.assertTrue(events[0]['retrying'])

    def test_changed_file_is_reread_and_rejected_before_either_put(self):
        _, reads, encodings, _, published, hashes, _ = self.exercise(mutate=True)
        self.assertEqual((reads, encodings, published), (3, 2, []))
        self.assertNotEqual(hashes[1], hashes[2])


if __name__ == '__main__':
    unittest.main()
