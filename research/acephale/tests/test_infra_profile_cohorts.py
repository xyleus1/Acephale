"""Profile routing must reproduce original traces, including failed slots."""
import copy
import hashlib
import json

import pytest
from test_infra_import_fresh import seal, split_cohorts, write

from acephale.contracts_v1 import hash_v1
from acephale.infra_data import canonical, publish_bundle, read_jsonl, verify_bundle
from acephale.infra_import_fresh import import_fresh, import_fresh_cohorts
from acephale.infra_native_profile import PrefixFactory

pytest_plugins = ["test_infra_import_fresh"]


@pytest.fixture
def profile_sources(cohort, tmp_path, monkeypatch):
    # These importer fixtures isolate source routing. Actual task reconstruction
    # is covered separately against the pinned native environment.
    monkeypatch.setattr("acephale.infra_native_profile.validate_task_bundle", lambda *_: {})
    cohorts = split_cohorts(cohort, tmp_path)
    bundle = tmp_path / "aggregate"
    import_fresh_cohorts(cohorts, bundle)
    return cohorts, bundle


def republish(bundle, target, change):
    manifest = verify_bundle(bundle)
    files = {name: read_jsonl(bundle / name) if name.endswith(".jsonl")
             else json.loads((bundle / name).read_text(encoding="utf-8")) for name in manifest["files"]}
    change(files)
    receipt = files["cohort-receipt.json"]
    receipt["contentHash"] = hash_v1({key: value for key, value in receipt.items() if key != "contentHash"})
    files["lineage.json"]["cohort_receipt_hash"] = hash_v1(receipt)
    files["lineage.json"]["cohort_receipt_sha256"] = hashlib.sha256((canonical(receipt) + "\n").encode()).hexdigest()
    publish_bundle(target, files)
    return target


def test_single_original_cohort_remains_supported(cohort, tmp_path, monkeypatch):
    monkeypatch.setattr("acephale.infra_native_profile.validate_task_bundle", lambda *_: {})
    bundle = tmp_path / "single"
    import_fresh(cohort, bundle)
    factory = PrefixFactory(cohort, bundle, tmp_path)
    for row in read_jsonl(bundle / "public.jsonl"):
        run, owner, source = factory.source_for(row)
        assert run["runId"] == row["episode_id"]
        assert owner == hash_v1(source["receipt"])
        assert source["directory"] == cohort


def test_aggregate_routes_each_prefix_to_original_cohort(profile_sources, tmp_path):
    cohorts, bundle = profile_sources
    # Directory order need not match the sealed aggregate order.
    factory = PrefixFactory(list(reversed(cohorts)), bundle, tmp_path)
    rows = read_jsonl(bundle / "public.jsonl")
    assert {row["episode_id"] for row in rows} == {"run-0", "run-1", "run-2", "run-3"}
    for row in rows:
        run, owner, source = factory.source_for(row)
        assert run["runId"] == row["episode_id"]
        assert source["directory"] == cohorts[1 if row["split"] == "development" else 0]
        assert owner == factory.lineage["fresh_sources"][row["episode_id"]]["cohort_id"]


@pytest.mark.parametrize("case", ["missing", "duplicate", "unrelated", "raw-change", "resealed-change"])
def test_invalid_original_sources_are_rejected(profile_sources, tmp_path, cohort, case):
    cohorts, bundle = profile_sources
    if case == "missing":
        cohorts = cohorts[:1]
    elif case == "duplicate":
        cohorts = [cohorts[0], cohorts[0]]
    elif case == "unrelated":
        cohorts = [cohorts[0], cohort]
    else:
        write(cohorts[0] / "extra.json", {"changed": True})
        raw = cohorts[0] / "run-0.json"
        data = json.loads(raw.read_text(encoding="utf-8"))
        data["simulation"]["messages"][0]["content"] = "Changed public request"
        write(raw, data)
        if case == "resealed-change":
            seal(cohorts[0])
    with pytest.raises(ValueError):
        PrefixFactory(cohorts, bundle, tmp_path)


@pytest.mark.parametrize("case", ["ownership", "source", "public-order", "public-content"])
def test_rehashed_aggregate_tampering_is_rejected(profile_sources, tmp_path, case):
    cohorts, bundle = profile_sources

    def change(files):
        if case == "ownership":
            receipt = files["cohort-receipt.json"]
            receipt["episodeCohorts"]["run-0"] = receipt["cohorts"][1]["cohortId"]
            receipt["contentHash"] = hash_v1({key: value for key, value in receipt.items() if key != "contentHash"})
        elif case == "source":
            files["lineage.json"]["fresh_sources"]["run-0"]["raw_sha256"] = "0" * 64
        elif case == "public-order":
            files["public.jsonl"].reverse()
        else:
            files["public.jsonl"][0]["input"]["policy"] = "Other policy"

    changed = republish(bundle, tmp_path / "changed", change)
    with pytest.raises(ValueError):
        PrefixFactory(cohorts, changed, tmp_path)


def test_altered_or_heldout_public_rows_cannot_be_routed(profile_sources, tmp_path):
    cohorts, bundle = profile_sources
    factory = PrefixFactory(cohorts, bundle, tmp_path)
    row = read_jsonl(bundle / "public.jsonl")[0]
    for key, value in [("split", "test"), ("episode_id", "run-3"), ("family_id", "other")]:
        changed = copy.deepcopy(row)
        changed[key] = value
        with pytest.raises(ValueError, match="unchanged declared public row"):
            factory.source_for(changed)
