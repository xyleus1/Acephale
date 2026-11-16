"""Only a server-owned monotonic readiness transition may cross publication reads."""
import contextlib
import copy
import io
import json
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import lambda_watchdog_deploy as deployment
import test_control as original

control = original.control


class ReadinessTransitionTests(unittest.TestCase):
    tearDown = original.ControlTests.tearDown

    def setUp(self):
        original.ControlTests.setUp(self)
        original.ControlTests.prepare(self)
        self.lease = control.launch(self.client, self.ledger, self.prepared['id'], self.watchdog,
                                    now=self.now, budget=self.budget)
        self.original_ledger = control.read_json(self.ledger)
        self.smoke = self.root / 'readiness.json'
        self.smoke_value = {'profile': control.PROFILE, 'leaseId': self.lease['id'],
            'instanceId': self.lease['instanceId'], 'passed': True, 'purpose': 'predictor_evaluation',
            'hardwareProfileHash': self.lease['quote']['hardwareProfileHash'],
            'checks': {key: True for key in ('pinnedModels', 'pinnedImages', 'driver',
                       'actorStopped', 'cudaInference', 'export', 'watchdogRecovery')}}
        control.write_new(self.smoke, self.smoke_value)
        self.puts, self.reads, self.marked = [], [], False

    def mark_ready(self):
        with contextlib.redirect_stdout(io.StringIO()):
            control.main(['mark-ready', '--ledger', str(self.ledger), '--lease-id', self.lease['id'],
                          '--smoke-receipt', str(self.smoke)])
        self.marked = True

    def publish(self, mutate=None, *, invalid_smoke=False, expired=False):
        if invalid_smoke:
            self.smoke_value['checks']['cudaInference'] = False
            control.atomic_json(self.smoke, self.smoke_value)
        initial = control.watchdog_state(self.ledger, self.lease['id'])
        initial['ownerHeartbeatAt'] = self.now
        def get_object(**kwargs):
            if not self.marked:
                self.mark_ready()
            return {'Body': io.BytesIO(json.dumps(initial).encode())}
        def read(*args):
            state = control.watchdog_state(*args)
            if self.reads and mutate:
                mutate(state)
            self.reads.append(state)
            return state
        client = SimpleNamespace(exceptions=SimpleNamespace(NoSuchKey=KeyError), get_object=get_object,
            put_object=lambda **kwargs: self.puts.append(json.loads(kwargs['Body'])))
        receipt = {'config': {}, 'controllers': [
            {'region': key, 'bucket': key, 'account': '1'} for key in ('east', 'west')]}
        now = self.lease['setupDeadline'] if expired else self.now + 1
        with patch.object(deployment, 'checked_receipt', return_value=receipt), \
                patch.object(deployment, 'session', return_value=SimpleNamespace(client=lambda *a, **k: client)), \
                patch.object(deployment.time, 'time', return_value=now):
            return deployment.publish('receipt', self.ledger, self.lease['id'], state_fn=read)

    def test_actual_mark_ready_between_both_authority_reads_preserves_publication(self):
        result = self.publish()
        self.assertIs(self.reads[0]['ready'], False)
        self.assertIs(self.reads[1]['ready'], True)
        actual = control.read_json(self.ledger)['leases'][-1]
        self.assertEqual(actual['smokeReceiptSha256'], control.sha256(self.smoke))
        self.assertEqual(len(self.puts), 2)
        for state in self.puts:
            self.assertIs(state['ready'], True)
            self.assertEqual(state['deadline'], self.lease['deadline'])
            self.assertEqual(state['setupDeadline'], self.lease['setupDeadline'])
            self.assertEqual(state['ownerHeartbeatTimeoutSeconds'], 120)
            self.assertEqual(control.digest(state), result['stateHash'])

    def test_failed_actual_smoke_does_not_mark_ready_or_publish(self):
        with self.assertRaisesRegex(ValueError, 'Actual readiness checks'):
            self.publish(invalid_smoke=True)
        self.assertIs(control.read_json(self.ledger)['leases'][-1]['ready'], False)
        self.assertEqual(self.puts, [])

    def test_expired_setup_still_rejects_actual_readiness_change(self):
        with self.assertRaisesRegex(ValueError, 'within setup window'):
            self.publish(expired=True)
        self.assertIs(control.read_json(self.ledger)['leases'][-1]['ready'], False)
        self.assertEqual(self.puts, [])

    def test_ready_promotion_does_not_hide_other_authority_changes(self):
        changes = {'leaseId': 'other', 'instanceId': 'other', 'expectedName': 'other',
            'planHash': 'other', 'deadline': self.lease['deadline'] + 1,
            'setupDeadline': self.lease['setupDeadline'] + 1, 'status': 'termination_requested',
            'ownerHeartbeatTimeoutSeconds': 121, 'purpose': 'other', 'reservedAt': 1}
        for key, value in changes.items():
            with self.subTest(key=key):
                # Each case uses both real ledger observations, with only the second
                # returned authority changed to model a conflicting observation.
                self.reads.clear()
                self.marked = False
                control.atomic_json(self.ledger, copy.deepcopy(self.original_ledger))
                with self.assertRaisesRegex(ValueError, 'authority changed'):
                    self.publish(lambda state: state.update({key: value}))
                self.assertEqual(self.puts, [])

    def test_readiness_rollback_is_never_accepted(self):
        with patch.object(control.time, 'time', return_value=self.now + 1):
            self.mark_ready()
        with self.assertRaisesRegex(ValueError, 'authority changed'):
            self.publish(lambda state: state.update(ready=False))
        self.assertEqual(self.puts, [])

    def test_nonboolean_readiness_does_not_count_as_monotonic_promotion(self):
        with self.assertRaisesRegex(ValueError, 'authority changed'):
            self.publish(lambda state: state.update(ready=1))
        self.assertEqual(self.puts, [])


if __name__ == '__main__':
    unittest.main()
