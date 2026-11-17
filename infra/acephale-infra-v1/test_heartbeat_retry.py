"""Heartbeat retries preserve identity, freshness and redacted diagnostics."""

import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
spec = importlib.util.spec_from_file_location(
    "heartbeat_deploy_test", HERE / "lambda_watchdog_deploy.py"
)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ClientError(Exception):
    def __init__(self, response, operation_name):
        self.response = response
        self.operation_name = operation_name
        super().__init__("SDK message deliberately not logged")


class EndpointConnectionError(Exception):
    def __init__(self, endpoint_url):
        super().__init__(endpoint_url)


class HeartbeatTests(unittest.TestCase):
    def state(self, **kw):
        return {
            "leaseId": "owned",
            "instanceId": "instance",
            "expectedName": "exact",
            "planHash": "hash",
            "setupDeadline": 10,
            "deadline": 1000,
            "status": "active",
            "ready": True,
            **kw,
        }

    def run_loop(self, publish, states=None, now=100):
        values = []
        sleeps = []
        state = Mock(side_effect=states) if states else Mock(return_value=self.state())

        def sleep(seconds):
            sleeps.append(seconds)

        result = m.heartbeat(
            "receipt",
            "ledger",
            "owned",
            publish_fn=publish,
            state_fn=state,
            clock=lambda: now,
            sleeper=sleep,
            emit=values.append,
        )
        return result, values, sleeps

    def test_transient_then_both_controller_success(self):
        error = ClientError(
            {
                "Error": {"Code": "SlowDown", "Message": "SECRET"},
                "ResponseMetadata": {"HTTPStatusCode": 503},
            },
            "PutObject",
        )
        pub = Mock(
            side_effect=[
                error,
                {"leaseId": "owned", "stateHash": "new", "ownerHeartbeatAt": 100},
            ]
        )
        result, logs, sleeps = self.run_loop(
            pub, [self.state(), self.state(), self.state(status="terminated")]
        )
        self.assertEqual(pub.call_count, 2)
        self.assertEqual(sleeps, [2])
        self.assertFalse(logs[0]["heartbeatPublished"])
        self.assertTrue(logs[0]["retrying"])
        self.assertEqual(result, logs[-1])
        self.assertNotIn("SECRET", str(logs))
        self.assertTrue(pub.call_args.kwargs["bounded_requests"])

    def test_attempt_limit_retains_every_failure(self):
        error = EndpointConnectionError(endpoint_url="SECRET")
        pub = Mock(side_effect=error)
        logs = []
        sleeps = []
        with self.assertRaises(EndpointConnectionError):
            m.heartbeat(
                "r",
                "l",
                "owned",
                publish_fn=pub,
                state_fn=lambda *_: self.state(),
                clock=lambda: 100,
                sleeper=sleeps.append,
                emit=logs.append,
            )
        self.assertEqual(pub.call_count, 3)
        self.assertEqual(sleeps, [2, 4])
        self.assertFalse(logs[-1]["retrying"])
        self.assertNotIn("SECRET", str(logs))

    def test_auth_failure_is_immediate_and_redacted(self):
        error = ClientError(
            {
                "Error": {"Code": "InvalidGrantException", "Message": "SECRET"},
                "ResponseMetadata": {"HTTPStatusCode": 400},
            },
            "CreateOAuth2Token",
        )
        pub = Mock(side_effect=error)
        logs = []
        with self.assertRaises(ClientError):
            m.heartbeat(
                "r",
                "l",
                "owned",
                publish_fn=pub,
                state_fn=lambda *_: self.state(),
                clock=lambda: 100,
                sleeper=Mock(),
                emit=logs.append,
            )
        self.assertEqual(pub.call_count, 1)
        self.assertTrue(logs[0]["authenticationRefreshRequired"])
        self.assertFalse(logs[0]["retrying"])
        self.assertEqual(logs[0]["operation"], "CreateOAuth2Token")
        self.assertNotIn("SECRET", str(logs))

    def test_login_refresh_required_is_classified(self):
        cls = type("LoginRefreshRequired", (Exception,), {})
        self.assertTrue(
            m.heartbeat_error(cls("SECRET"))["authenticationRefreshRequired"]
        )

    def test_authentication_failure_never_retries_even_with_server_status(self):
        for code in ("ExpiredToken", "AccessDenied"):
            with self.subTest(code=code):
                error = ClientError(
                    {
                        "Error": {"Code": code},
                        "ResponseMetadata": {"HTTPStatusCode": 503},
                    },
                    "PutObject",
                )
                info = m.heartbeat_error(error)
                self.assertTrue(info["authenticationRefreshRequired"])
                self.assertFalse(info["retryable"])
        cls = type("LoginTokenLoadError", (Exception,), {})
        info = m.heartbeat_error(cls("SECRET"))
        self.assertTrue(info["authenticationRefreshRequired"])
        self.assertFalse(info["retryable"])

    def test_non_sdk_failure_never_retries(self):
        pub = Mock(side_effect=ValueError("SECRET"))
        logs = []
        with self.assertRaises(ValueError):
            m.heartbeat(
                "r",
                "l",
                "owned",
                publish_fn=pub,
                state_fn=lambda *_: self.state(),
                clock=lambda: 100,
                sleeper=Mock(),
                emit=logs.append,
            )
        self.assertEqual(pub.call_count, 1)
        self.assertFalse(logs[0]["retrying"])
        self.assertNotIn("SECRET", str(logs))

    def test_changed_identity_blocks_retry(self):
        pub = Mock(side_effect=EndpointConnectionError(endpoint_url="SECRET"))
        with self.assertRaisesRegex(ValueError, "identity"):
            self.run_loop(pub, [self.state(), self.state(instanceId="other")])
        self.assertEqual(pub.call_count, 1)

    def test_expired_effective_deadline_never_publishes(self):
        for state in [self.state(deadline=99), self.state(ready=False)]:
            with self.subTest(state=state):
                pub = Mock()
                with self.assertRaisesRegex(ValueError, "deadline"):
                    self.run_loop(pub, [state])
                pub.assert_not_called()

    def test_ready_lease_uses_original_hard_deadline(self):
        pub = Mock(return_value={"leaseId": "owned"})
        self.run_loop(pub, [self.state(), self.state(status="terminated")])
        self.assertEqual(pub.call_count, 1)

    def test_retry_elapsed_bound(self):
        pub = Mock(side_effect=EndpointConnectionError(endpoint_url="SECRET"))
        logs = []
        times = iter([100, 100, 121, 121])
        with self.assertRaises(EndpointConnectionError):
            m.heartbeat(
                "r",
                "l",
                "owned",
                publish_fn=pub,
                state_fn=lambda *_: self.state(),
                clock=lambda: next(times),
                sleeper=Mock(),
                emit=logs.append,
            )
        self.assertEqual(pub.call_count, 1)
        self.assertFalse(logs[0]["retrying"])

    def test_unknown_error_fields_not_echoed(self):
        error = ClientError(
            {
                "Error": {"Code": "SECRET_CODE", "Message": "SECRET"},
                "ResponseMetadata": {"HTTPStatusCode": "SECRET"},
            },
            "SECRET_OPERATION",
        )
        self.assertNotIn("SECRET", str(m.heartbeat_error(error)))


if __name__ == "__main__":
    unittest.main()
