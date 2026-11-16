"""Pure hash reuse and fresh heartbeat publication preserve authority checks."""
import copy
import io
import json
import math
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import rfc8785

import control
import lambda_watchdog_deploy as deployment


class DigestTests(unittest.TestCase):
    def test_identical_content_reuses_only_inside_one_operation(self):
        original = rfc8785.dumps
        value = {'nested': [{'value': 1.0, 'enabled': True}]}
        with patch.object(rfc8785, 'dumps', wraps=original) as encode:
            with control.budget_digest_scope():
                first = control._budget_digest(value)
                with control.budget_digest_scope():
                    self.assertEqual(control._budget_digest(copy.deepcopy(value)), first)
                self.assertEqual(encode.call_count, 1)
            self.assertIsNone(control._BUDGET_DIGEST_CACHE.get())
            with control.budget_digest_scope():
                self.assertEqual(control._budget_digest(value), first)
            self.assertEqual(encode.call_count, 2)

    def test_nested_mutation_changes_the_key_and_canonical_hash(self):
        value = {'nested': [{'amount': 1}]}
        with control.budget_digest_scope():
            first = control._budget_digest(value)
            value['nested'][0]['amount'] = 2
            self.assertNotEqual(control._budget_digest(value), first)
            value['nested'][0]['amount'] = 1
            self.assertEqual(control._budget_digest(value), first)

    def test_integer_float_and_boolean_have_distinct_cache_keys(self):
        keys = {control._canonical_memo_key({'value': value}) for value in (1, 1.0, True)}
        self.assertEqual(len(keys), 3)

    def test_non_string_keys_cannot_hit_a_string_key_entry(self):
        with control.budget_digest_scope():
            control._budget_digest({'1': 'allowed'})
            with self.assertRaises(rfc8785.CanonicalizationError):
                control._budget_digest({1: 'allowed'})

    def test_overridden_builtin_subclasses_never_share_builtin_entries(self):
        def fail(*args, **kwargs):
            raise AssertionError('A custom conversion hook executed')
        cases = [
            ({'a': 1}, type('CustomDict', (dict,), {'items': fail})(a=1)),
            ([1], type('CustomList', (list,), {'__iter__': fail})([1])),
            ('text', type('CustomStr', (str,), {'__str__': fail})('text')),
            (1, type('CustomInt', (int,), {'__int__': fail})(1)),
        ]
        with control.budget_digest_scope():
            for ordinary, custom in cases:
                control._budget_digest(ordinary)
                self.assertIsNone(control._canonical_memo_key(custom))
            self.assertNotEqual(control._canonical_memo_key({'1': 'a'}),
                                control._canonical_memo_key({1: 'a'}))

    def test_tuples_remain_distinct_and_custom_builtins_never_invoke_reduction(self):
        class CustomList(list):
            pass
        class CustomInt(int):
            pass
        class Dangerous:
            def __reduce__(self):
                raise AssertionError('Reduction hooks must never execute')
        original = rfc8785.dumps
        with patch.object(rfc8785, 'dumps', wraps=original) as encode:
            with control.budget_digest_scope():
                expected = control._budget_digest([1])
                self.assertNotEqual(control._canonical_memo_key([1]), control._canonical_memo_key((1,)))
                self.assertEqual(control._budget_digest((1,)), expected)
                for value in (CustomList([1]), [CustomInt(1)]):
                    self.assertIsNone(control._canonical_memo_key(value))
                    self.assertEqual(control._budget_digest(value), expected)
                self.assertIsNone(control._canonical_memo_key(Dangerous()))
            self.assertEqual(encode.call_count, 4)

    def test_surrogate_alias_cannot_reuse_a_valid_unicode_digest(self):
        for good, invalid in [('\U0001f600', '\ud83d\ude00'),
                              ({'\U0001f600': 1}, {'\ud83d\ude00': 1})]:
            with control.budget_digest_scope():
                control._budget_digest(good)
                self.assertNotEqual(control._canonical_memo_key(good), control._canonical_memo_key(invalid))
                with self.assertRaises(Exception) as expected:
                    rfc8785.dumps(invalid)
                with self.assertRaises(type(expected.exception)):
                    control._budget_digest(invalid)

    def test_nonfinite_and_large_integer_errors_remain_canonical_errors(self):
        with control.budget_digest_scope():
            control._budget_digest(1)
            for value in (math.inf, -math.inf, math.nan, 2**54):
                with self.assertRaises(rfc8785.CanonicalizationError):
                    control._budget_digest(value)

    def test_cache_is_bounded_and_cleared_on_exception(self):
        with self.assertRaisesRegex(RuntimeError, 'fixture'):
            with control.budget_digest_scope():
                for index in range(200):
                    control._budget_digest(index)
                cache = control._BUDGET_DIGEST_CACHE.get()
                self.assertEqual(len(cache['values']), 128)
                self.assertLessEqual(cache['bytes'], 16 * 1024 * 1024)
                raise RuntimeError('fixture')
        self.assertIsNone(control._BUDGET_DIGEST_CACHE.get())

    def test_scoped_validation_still_reads_changed_file_bytes(self):
        from tempfile import TemporaryDirectory
        with TemporaryDirectory() as directory:
            path = Path(directory) / 'authority.json'
            path.write_text('{"amount":1}')
            with control.budget_digest_scope():
                first = control._budget_digest(control.read_json(path))
                path.write_text('{"amount":2}')
                self.assertNotEqual(control._budget_digest(control.read_json(path)), first)


class PublicationTests(unittest.TestCase):
    def fixture(self, changed=False, expired=False):
        clock = [100.0]
        published = []
        prior = {'leaseId': 'old', 'expectedName': 'old-name', 'instanceId': 'old-id'}
        rows = [{'region': 'east', 'bucket': 'bucket-east', 'account': '1'},
                {'region': 'west', 'bucket': 'bucket-west', 'account': '1'}]
        def get_state():
            return {'leaseId': 'new', 'instanceId': None, 'expectedName': 'new-name',
                    'planHash': 'fixed', 'status': 'reserved', 'ready': False,
                    'setupDeadline': 500 if not expired else 200,
                    'deadline': 900, 'ownerHeartbeatAt': clock[0],
                    'ownerHeartbeatTimeoutSeconds': 120}
        observations = []
        def state(*args):
            value = get_state()
            if changed and observations:
                value['deadline'] += 1
            observations.append(value)
            return value
        def checked(*args):
            clock[0] += 75
            return {'leases': [{'id': 'old', 'status': 'terminated'}]}
        class Client:
            exceptions = SimpleNamespace(NoSuchKey=KeyError)
            def get_object(self, **kwargs):
                return {'Body': io.BytesIO(json.dumps(prior).encode())}
            def put_object(self, **kwargs):
                published.append((clock[0], json.loads(kwargs['Body'])))
        client = Client()
        return clock, published, observations, rows, state, checked, client

    def run_publish(self, *, changed=False, expired=False):
        clock, published, observed, rows, state, checked, client = self.fixture(changed, expired)
        patches = [patch.object(deployment, 'checked_receipt', return_value={'config': {}, 'controllers': rows}),
                   patch.object(deployment, 'session', return_value=SimpleNamespace(client=lambda *a, **k: client)),
                   patch.object(deployment, 'watchdog_state', side_effect=state),
                   patch.object(deployment, 'checked_bound_ledger', side_effect=checked),
                   patch.object(deployment, 'Provider', return_value=SimpleNamespace(request=lambda *a: {'data': []})),
                   patch.object(deployment, 'select_instance', return_value=None),
                   patch.object(deployment.time, 'time', side_effect=lambda: clock[0])]
        from contextlib import ExitStack
        with ExitStack() as stack:
            for item in patches:
                stack.enter_context(item)
            try:
                result = deployment.publish('receipt', 'ledger', 'new')
            except Exception:
                self.assertEqual(published, [])
                raise
        return result, published, observed

    def test_slow_prior_checks_finish_before_actual_fresh_timestamp(self):
        result, published, observed = self.run_publish()
        self.assertEqual(observed[0]['ownerHeartbeatAt'], 100)
        self.assertEqual(result['ownerHeartbeatAt'], 250)
        self.assertEqual(len(published), 2)
        self.assertTrue(all(at == value['ownerHeartbeatAt'] == 250 for at, value in published))
        self.assertTrue(all(value['ownerHeartbeatTimeoutSeconds'] == 120 for _, value in published))

    def test_current_lease_change_rejects_before_either_publication(self):
        with self.assertRaisesRegex(ValueError, 'authority changed'):
            self.run_publish(changed=True)

    def test_original_setup_deadline_is_not_extended_by_late_publication(self):
        with self.assertRaisesRegex(ValueError, 'deadline reached'):
            self.run_publish(expired=True)


if __name__ == '__main__':
    unittest.main()
