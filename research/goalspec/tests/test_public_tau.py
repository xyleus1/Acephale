import copy
import json

import pytest

from goalspec.adapters.public_tau import PUBLIC_BENCHMARK, PublicCatalog, import_public_tau
from goalspec.adapters.tau import TAU_REVISION
from goalspec.schemas import ToolContract

SOURCE = "https://sierra-tau-bench-public.s3.us-west-2.amazonaws.com/submissions/test/trajectories/results.json"


@pytest.fixture
def release(tmp_path):
    raw = {
        "info": {
            "git_commit": "a" * 40, "num_trials": 1,
            "agent_info": {"implementation": "llm_agent", "llm": "release-actor"},
            "user_info": {"llm": "release-user", "instructions": "HIDDEN"},
            "environment_info": {"domain_name": "retail", "policy": "Public policy"},
        },
        "tasks": [{"id": "task1", "evaluation_criteria": {"secret": "HIDDEN"}}],
        "simulations": [{
            "id": "sim1", "task_id": "task1", "trial": 0, "seed": 300,
            "termination_reason": "user_stop", "reward_info": {"reward": 1.0},
            "messages": [
                {"role": "user", "content": "Find my order."},
                {"role": "user", "content": "HIDDEN", "tool_calls": [{"id": "u"}]},
                {"role": "tool", "requestor": "user", "id": "u", "content": "HIDDEN"},
                {"role": "assistant", "tool_calls": [
                    {"id": "a", "name": "lookup", "arguments": {"order": "1"}}]},
                {"role": "tool", "id": "a", "content": "found", "error": False},
            ],
        }],
    }
    catalog = PublicCatalog(
        source_revision=TAU_REVISION, domain="retail", tools=(
            ToolContract(name="lookup"), ToolContract(name="never_called")),
        agent_instruction="Public instruction", system_prompt_template="{domain_policy}",
        source_hashes={"tool.py": "b" * 64},
    )
    submission = {
        "trajectory_files": {"retail": "results.json"},
        "methodology": {"tau2_bench_version": "1.0.1", "verification": {
            "modified_prompts": False}},
    }
    labels = {"tasks": {"task1": {"group_id": "template1", "goal": None}}}
    paths = tuple(tmp_path / name for name in ("results.json", "catalog.json", "submission.json", "labels.json"))
    for path, value in zip(paths, (raw, catalog.model_dump(mode="json"), submission, labels), strict=True):
        path.write_text(json.dumps(value), encoding="utf-8")
    return paths, raw, submission


def test_release_keeps_true_revision_causal_projection_and_no_native_attestation(release):
    paths, _, _ = release
    traces, audit = import_public_tau(*paths, source_url=SOURCE)
    [trace] = traces
    assert trace.benchmark == PUBLIC_BENCHMARK != "tau3"
    assert trace.benchmark_revision == "a" * 40
    assert trace.provenance.capture_manifest_hash is None
    assert trace.provenance.trial_seed == 300
    assert {tool.name for tool in trace.initial_tools} == {"lookup", "never_called"}
    assert "HIDDEN" not in trace.model_dump_json()
    assert trace.outcome.success
    assert audit.native_evaluator_claim == "1.0.1"
    assert len(audit.results_sha256) == 64


def test_release_retains_infrastructure_failure_and_requires_complete_grid(release):
    paths, raw, _ = release
    raw["info"]["num_trials"] = 2
    error = copy.deepcopy(raw["simulations"][0])
    error.update(id="sim2", trial=1, termination_reason="infrastructure_error", messages=None,
                 reward_info=None)
    raw["simulations"].append(error)
    paths[0].write_text(json.dumps(raw), encoding="utf-8")
    traces, _ = import_public_tau(*paths, source_url=SOURCE)
    assert len(traces) == 2
    assert traces[-1].outcome.native_excluded_from_success
    assert traces[-1].outcome.status == "error"
    raw["simulations"].pop()
    paths[0].write_text(json.dumps(raw), encoding="utf-8")
    with pytest.raises(ValueError, match="incomplete"):
        import_public_tau(*paths, source_url=SOURCE)


@pytest.mark.parametrize("change", ["custom", "modified", "mismatched_url", "domain", "duplicate"])
def test_rejects_unsupported_or_inconsistent_release(release, change):
    paths, raw, submission = release
    source = SOURCE
    if change == "custom":
        submission["submission_type"] = "custom"
    elif change == "modified":
        submission["methodology"]["verification"]["modified_prompts"] = True
    elif change == "mismatched_url":
        source = SOURCE.replace("results.json", "other.json")
    elif change == "domain":
        raw["info"]["environment_info"]["domain_name"] = "airline"
    else:
        raw["simulations"].append(raw["simulations"][0])
    paths[0].write_text(json.dumps(raw), encoding="utf-8")
    paths[2].write_text(json.dumps(submission), encoding="utf-8")
    with pytest.raises(ValueError):
        import_public_tau(*paths, source_url=source)


def test_reconstructed_catalog_cannot_authorize_speculation(release):
    paths, _, _ = release
    catalog = json.loads(paths[1].read_text(encoding="utf-8"))
    catalog["tools"][0]["cacheable"] = True
    with pytest.raises(ValueError, match="cannot authorize"):
        PublicCatalog.model_validate(catalog)
