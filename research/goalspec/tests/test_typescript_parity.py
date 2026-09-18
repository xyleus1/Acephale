import json
import shutil
import subprocess
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from goalspec.binding import Expression, resolve
from goalspec.contracts_v1 import hash_v1
from goalspec.fixtures import demo_corpus
from goalspec.goals import canonical_goal, is_mining_success
from goalspec.patterns import fit_patterns, frequent_contexts
from goalspec.replay import decision_points
from goalspec.schemas import Event, PrefixView

ROOT = Path(__file__).resolve().parents[3]


def node(payload):
    if not shutil.which("node") or not (ROOT / "node_modules/tsx").exists():
        pytest.skip("Node dependencies required for cross-language parity")
    return json.loads(subprocess.check_output(["node", "--import", "tsx", "scripts/goalspec-parity.ts"], input=json.dumps(payload), text=True, cwd=ROOT))


def test_prefixspan_differential():
    histories = [["a", "x", "b", "a"], ["a", "b", "a"], ["x", "b"]]
    groups = ["f1", "f2", "f3"]
    expected = frequent_contexts(tuple(map(tuple, histories)), tuple(groups), 3, 2)
    assert node({"operation": "contexts", "histories": histories, "groups": groups, "maxContext": 3, "minSupport": 2}) == json.loads(json.dumps(expected))


def test_complete_miner_counts_and_bindings_differential():
    corpus = demo_corpus(groups=3, trials=1)
    episodes = [{"id": t.trajectory_id, "family": t.group_id, "benchmark": t.benchmark, "domain": t.domain,
                 "canonicalGoalId": canonical_goal(t).goal_id, "verifiedSuccess": is_mining_success(t),
                 "checkpoints": [{"prefix": {"events": [e.model_dump() for e in p.prefix.events], "throughSeq": p.prefix.through_seq,
                                              "signatures": p.prefix.signatures, "tools": [tool.model_dump() for tool in p.prefix.tools]},
                                  "targets": [{"tool": target.tool, "arguments": target.arguments} for target in p.targets]} for p in decision_points(t)]} for t in corpus]
    actual = node({"operation": "mine", "episodes": episodes})
    expected = [p.model_dump(mode="json") for p in fit_patterns(corpus).patterns]
    # Pydantic expands expression defaults; normalize the port through the same
    # historical record schema before comparing every count and binding.
    from goalspec.patterns import Pattern
    assert [Pattern.model_validate(p).model_dump(mode="json") for p in actual] == expected


def test_symbolic_binding_differential():
    events = [Event(seq=0, kind="tool_request", tool="lookup", call_id="a", arguments={}), Event(seq=1, kind="tool_result", tool="lookup", call_id="a", result={"id": "visible"}, status="success")]
    prefix = PrefixView(trajectory_id="t", benchmark="fixture", domain="retail", task_id="task", trial=0, through_seq=1, policy="p", tools=(), events=tuple(events))
    expression = Expression(kind="reference", reference={"source": "result", "tool": "lookup", "occurrence": 1, "path": ["id"]})
    assert node({"operation": "binding", "expression": expression.model_dump(), "events": [e.model_dump() for e in events], "throughSeq": 1}) == resolve(expression, prefix)


@pytest.mark.parametrize("value", [None, {"z": [True, False, None, 42], "a": "ü"}, {"\ue000": 1, "𐀀": 2}, {"float": 1.25}, [1.0, -0.0, 1e-7, 1e-6, 1.2345678901234567]])
def test_canonical_hash_fixture(value):
    assert node({"operation": "hash", "value": value}) == hash_v1(value)


@pytest.mark.parametrize("value", [
    {"schemaVersion": 1, "hypotheses": [], "unknown": 1, "revisionHash": "r"},
    {"schemaVersion": 1, "hypotheses": [], "unknown": -1, "revisionHash": "r"},
    {"schemaVersion": 1, "hypotheses": [], "unknown": 1, "revisionHash": "r", "future": True},
])
def test_shared_schema_acceptance(value):
    schema = json.loads((ROOT / "src/lib/goalspec/contracts/v1.schema.json").read_text())
    schema = {**schema, "anyOf": [{"$ref": "#/$defs/GoalSet"}]}
    expected = Draft202012Validator(schema).is_valid(value)
    assert node({"operation": "validate", "contract": "GoalSet", "value": value}) == expected
