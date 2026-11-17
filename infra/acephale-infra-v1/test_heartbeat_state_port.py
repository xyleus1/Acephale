"""Explicit state-reader injection preserves both publication authority checks."""
import copy
from functools import partial
import io
import json
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import lambda_watchdog_deploy as deployment


class StatePortTests(unittest.TestCase):
    def setUp(self):
        # These tests replace S3 transport, including its optional SDK config.
        # The standard research environment does not install the cloud SDK.
        self.sdk_config = Mock(side_effect=lambda **options: SimpleNamespace(**options))
        self.enterContext(patch.dict(sys.modules, {
            'botocore': ModuleType('botocore'),
            'botocore.config': SimpleNamespace(Config=self.sdk_config),
        }))
        self.state = {'leaseId': 'owned', 'instanceId': 'instance', 'expectedName': 'owned-name',
            'planHash': 'fixed', 'status': 'active', 'ready': False, 'setupDeadline': 500,
            'deadline': 900, 'ownerHeartbeatAt': 100, 'ownerHeartbeatTimeoutSeconds': 120}
        self.reads, self.puts = [], []
        self.rows = [{'region': region, 'bucket': 'owned-' + region, 'account': '1'}
                     for region in ('east', 'west')]
        self.client = SimpleNamespace(exceptions=SimpleNamespace(NoSuchKey=KeyError),
            get_object=lambda **kwargs: {'Body': io.BytesIO(json.dumps(self.state).encode())},
            put_object=lambda **kwargs: self.puts.append(json.loads(kwargs['Body'])))

    def read(self, ledger, lease_id):
        self.reads.append((ledger, lease_id))
        value = copy.deepcopy(self.state)
        value['ownerHeartbeatAt'] += len(self.reads)
        return value

    def invoke(self, read=None, **options):
        with patch.object(deployment, 'checked_receipt', return_value={'config': {}, 'controllers': self.rows}), \
                patch.object(deployment, 'session', return_value=SimpleNamespace(client=lambda *a, **k: self.client)), \
                patch.object(deployment.time, 'time', return_value=103):
            return deployment.publish('receipt', 'ledger', 'owned', state_fn=read, **options)

    def test_explicit_reader_reaches_both_real_internal_observations(self):
        with patch.object(deployment, 'watchdog_state', side_effect=AssertionError('Wrong reader')):
            result = self.invoke(self.read, bounded_requests=True)
        self.assertEqual(self.reads, [('ledger', 'owned'), ('ledger', 'owned')])
        self.assertEqual(result['ownerHeartbeatAt'], 102)
        self.assertEqual(len(self.puts), 2)
        self.assertTrue(all(row['ownerHeartbeatAt'] == 102 and row['ownerHeartbeatTimeoutSeconds'] == 120
                            for row in self.puts))

    def test_default_reader_remains_original_authority_function(self):
        with patch.object(deployment, 'watchdog_state', side_effect=self.read):
            result = self.invoke()
        self.assertEqual(result['ownerHeartbeatAt'], 102)
        self.assertEqual(len(self.reads), 2)

    def test_partial_port_preserves_bounded_request_flag_and_result(self):
        publisher = partial(deployment.publish, state_fn=self.read)
        with patch.object(deployment, 'checked_receipt', return_value={'config': {}, 'controllers': self.rows}), \
                patch.object(deployment, 'session', return_value=SimpleNamespace(client=lambda *a, **k: self.client)), \
                patch.object(deployment.time, 'time', return_value=103):
            result = publisher('receipt', 'ledger', 'owned', bounded_requests=True)
        self.assertEqual(result['stateHash'], deployment.digest(self.puts[0]))
        self.assertEqual(self.puts[0], self.puts[1])
        self.sdk_config.assert_called_once_with(
            connect_timeout=3, read_timeout=3, retries={'total_max_attempts': 1})

    def test_changed_identity_injected_on_second_read_blocks_all_puts(self):
        def changed(*args):
            value = self.read(*args)
            if len(self.reads) == 2:
                value['instanceId'] = 'other'
            return value
        with self.assertRaisesRegex(ValueError, 'authority changed'):
            self.invoke(changed)
        self.assertEqual(self.puts, [])

    def test_reader_exception_is_not_swallowed_or_published(self):
        error = ValueError('authority failure')
        def failed(*args):
            raise error
        with self.assertRaises(ValueError) as result:
            self.invoke(failed)
        self.assertIs(result.exception, error)
        self.assertEqual(self.puts, [])

    def test_injected_reader_cannot_bypass_original_deadline(self):
        self.state['setupDeadline'] = 103
        with self.assertRaisesRegex(ValueError, 'deadline reached'):
            self.invoke(self.read)
        self.assertEqual(self.puts, [])


if __name__ == '__main__':
    unittest.main()
