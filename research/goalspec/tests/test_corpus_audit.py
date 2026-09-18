import json
import random

from goalspec.corpus_audit import audit, near_pairs


def test_prefix_join_equals_exhaustive_jaccard():
    rng = random.Random(15)
    sets = [frozenset(str(i) for i in rng.sample(range(30), rng.randint(2, 25))) for _ in range(100)]
    for threshold in (0.3, 0.5, 0.8, 1):
        expected = {(a, b) for b in range(len(sets)) for a in range(b) if len(sets[a] & sets[b]) / len(sets[a] | sets[b]) >= threshold}
        assert {(a, b) for a, b, _ in near_pairs(sets, threshold)} == expected


def test_audit_flags_cross_split_request_variants_without_outcomes(tmp_path):
    path = tmp_path / "episodes.jsonl"
    request = "Please help me find the current status of my order and tell me when it will arrive order 123456"
    rows = [{"id": "a", "family_id": "retail:status", "split": "train", "messages": [{"role": "user", "content": request}], "tools": []},
            {"id": "b", "family_id": "retail:search", "split": "test", "messages": [{"role": "user", "content": request.replace("123456", "654321")}], "tools": []}]
    path.write_text("\n".join(json.dumps(row) for row in rows))
    report = audit(path, tmp_path / "audit")
    assert report["cross_split_near_pairs"] == 1
    assert report["records_requiring_split_review"] == 2
    assert not report["evaluation_eligible"] and not report["near_duplicate_method"]["outcomes_used"]
    assert report["exact_full_protocol"]["duplicate_groups"] == 0
    assert report["masked_visible_request"]["cross_split_groups"] == 1
