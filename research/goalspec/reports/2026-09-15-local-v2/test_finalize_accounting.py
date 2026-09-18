"""Small accounting tests use only synthetic temporary files; no real ledger."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("finalizer", Path(__file__).with_name("finalize_accounting.py"))
finalizer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(finalizer)


class AccountingTests(unittest.TestCase):
    def test_parent_reservation_contains_child_maxima_without_double_counting(self):
        values = {"parent": {"maximum": 1250},
                  "known": {"parentId": "parent", "maximum": 100, "actual": 40},
                  "unknown": {"parentId": "parent", "maximum": 200},
                  "standalone": {"maximum": 20, "actual": 7}}
        result = finalizer.totals(values)
        self.assertEqual(result["knownUsageMicrodollars"], 47)
        self.assertEqual(result["spentOrReservedMicrodollars"], 1257)
        self.assertEqual(result["retainedRootMaximumMicrodollars"], 1250)
        self.assertEqual(result["unresolvedRequests"], 1)

    def test_settled_parent_is_not_added_to_known_child_usage(self):
        values = {"parent": {"maximum": 1250, "actual": 47},
                  "one": {"parentId": "parent", "maximum": 100, "actual": 40},
                  "two": {"parentId": "parent", "maximum": 200, "actual": 7}}
        self.assertEqual(finalizer.totals(values)["knownUsageMicrodollars"], 47)
        self.assertEqual(finalizer.totals(values)["spentOrReservedMicrodollars"], 47)

    def test_snapshot_and_delta_reconstruction_and_truncation(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "journal.jsonl"
            records = [{"body": {"entries": [["old", {"maximum": 1}]]}},
                       {"body": {"entries": [["parent", {"maximum": 5}]]}},
                       {"body": {"version": 2, "changes": [["child", {"parentId": "parent", "maximum": 2, "actual": 1}]]}}]
            path.write_text("".join(json.dumps(row) + "\n" for row in records))
            self.assertEqual(set(finalizer.load_journal(path)), {"parent", "child"})
            path.write_text(json.dumps(records[0]))
            with self.assertRaisesRegex(RuntimeError, "incomplete"):
                finalizer.load_journal(path)

    def test_active_dispatcher_blocks_closure_without_process_action(self):
        with patch.object(finalizer.sys, "platform", "win32"), patch.object(finalizer.subprocess, "run") as run:
            run.return_value = SimpleNamespace(stdout='[{"pid":123,"image":"node.exe"}]')
            with self.assertRaisesRegex(RuntimeError, "active_research"):
                finalizer.process_snapshot()
            self.assertEqual(run.call_count, 1)
            run.return_value = SimpleNamespace(stdout="[]")
            self.assertEqual(finalizer.process_snapshot()["activeMatchingProcesses"], [])


if __name__ == "__main__":
    unittest.main()
