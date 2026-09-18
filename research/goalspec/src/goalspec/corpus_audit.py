"""Deterministic visible-request overlap audit without outcome-derived grouping."""
from __future__ import annotations

import hashlib
import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path

from goalspec.binding import canonical
from goalspec.corpus import records


def visible_request(episode: dict) -> str:
    return next((message["content"] for message in episode["messages"] if message["role"] == "user" and isinstance(message.get("content"), str)), "")


def request_tokens(text: str) -> list[str]:
    text = text.lower()
    text = re.sub(r"\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b", " emailvalue ", text)
    text = re.sub(r"\b(?=\w*[0-9_])\w+\b", " entityvalue ", text)
    return re.findall(r"[a-z]+", text)


def shingles(tokens: list[str]) -> frozenset[str]:
    return frozenset(" ".join(tokens[index:index + 3]) for index in range(len(tokens) - 2))


def near_pairs(sets: list[frozenset[str]], threshold: float = 0.8):
    """Exact Jaccard joins using a globally ordered prefix filter, no LSH misses."""
    if not 0 < threshold <= 1:
        raise ValueError("Jaccard threshold must be in (0,1]")
    frequencies = Counter(token for tokens in sets for token in tokens)
    postings = defaultdict(list)
    for index, tokens in enumerate(sets):
        if not tokens:
            continue
        ordered = sorted(tokens, key=lambda token: (frequencies[token], token))
        prefix = ordered[:len(tokens) - math.ceil(threshold * len(tokens)) + 1]
        candidates = {previous for token in prefix for previous in postings[token]}
        for previous in sorted(candidates):
            other = sets[previous]
            if min(len(other), len(tokens)) < threshold * max(len(other), len(tokens)):
                continue
            intersection = len(tokens.intersection(other))
            similarity = intersection / (len(tokens) + len(other) - intersection)
            if similarity >= threshold:
                yield previous, index, similarity
        for token in prefix:
            postings[token].append(index)


def audit(path: Path, destination: Path, threshold: float = 0.8, minimum_tokens: int = 12):
    destination.mkdir(parents=True, exist_ok=False)
    rows = list(records(path))
    ids = [row["id"] for row in rows]
    if len(ids) != len(set(ids)):
        raise ValueError("Repeated episode identity")
    requests = [visible_request(row) for row in rows]
    tokenized = [request_tokens(text) for text in requests]
    signatures = [shingles(tokens) if len(tokens) >= minimum_tokens else frozenset() for tokens in tokenized]
    exact_groups, masked_groups, full_groups, families = defaultdict(list), defaultdict(list), defaultdict(list), defaultdict(set)
    domain_rows = defaultdict(list)
    for index, row in enumerate(rows):
        exact_groups[" ".join(requests[index].lower().split())].append(index)
        masked_groups[" ".join(tokenized[index])].append(index)
        full_groups[hashlib.sha256(canonical({"messages": row["messages"], "tools": row["tools"], "policy": row.get("policy", ""), "source_output": row.get("source_output")}).encode()).hexdigest()].append(index)
        families[row["family_id"]].add(row["split"])
        domain_rows[row["family_id"].split(":")[0]].append(index)
    parent = list(range(len(rows)))

    def root(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def link(a, b):
        parent[root(b)] = root(a)

    count, cross_split, cross_family, differing_schemas, samples = 0, 0, 0, 0, []
    with (destination / "near-duplicate-pairs.jsonl").open("x", encoding="utf-8") as output:
        for domain, indexes in sorted(domain_rows.items()):
            for left, right, similarity in near_pairs([signatures[index] for index in indexes], threshold):
                a, b = indexes[left], indexes[right]
                cross = rows[a]["split"] != rows[b]["split"]
                pair = {"a": ids[a], "b": ids[b], "a_family": rows[a]["family_id"], "b_family": rows[b]["family_id"],
                        "a_split": rows[a]["split"], "b_split": rows[b]["split"], "domain": domain,
                        "visible_request_jaccard": similarity, "cross_split": cross,
                        "tool_schema_equal": canonical(rows[a]["tools"]) == canonical(rows[b]["tools"])}
                output.write(canonical(pair) + "\n")
                count += 1
                cross_split += int(cross)
                cross_family += int(rows[a]["family_id"] != rows[b]["family_id"])
                differing_schemas += int(not pair["tool_schema_equal"])
                link(a, b)
                if cross and len(samples) < 25:
                    samples.append({**pair, "a_request": requests[a], "b_request": requests[b]})
    components = defaultdict(list)
    for index in range(len(rows)):
        components[root(index)].append(index)
    cross_components = [members for members in components.values() if len({rows[i]["split"] for i in members}) > 1]
    with (destination / "review-components.jsonl").open("x", encoding="utf-8") as output:
        for members in sorted(cross_components, key=lambda values: ids[min(values)]):
            output.write(canonical({"episode_ids": [ids[i] for i in members], "families": sorted({rows[i]["family_id"] for i in members}),
                                    "splits": sorted({rows[i]["split"] for i in members}), "action": "review_family_assignment_before_corpus_evaluation"}) + "\n")

    def group_stats(groups):
        groups = [members for members in groups.values() if len(members) > 1]
        return {"duplicate_groups": len(groups), "records_in_groups": sum(map(len, groups)),
                "cross_split_groups": sum(len({rows[i]["split"] for i in members}) > 1 for members in groups)}

    report = {"audit_version": "visible-request-overlap-v1", "input_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
              "records": len(rows), "records_by_split": dict(Counter(row["split"] for row in rows)), "families": len(families),
              "family_split_violations": {family: sorted(splits) for family, splits in families.items() if len(splits) > 1},
              "exact_full_protocol": group_stats(full_groups), "exact_visible_request": group_stats(exact_groups), "masked_visible_request": group_stats(masked_groups),
              "near_duplicate_method": {"tokenization": "lowercase ASCII words; email and tokens containing digits/underscores replaced", "shingle_words": 3,
                                        "jaccard_threshold": threshold, "minimum_request_tokens": minimum_tokens, "candidate_filter": "exact globally ordered prefix join within domain", "outcomes_used": False},
              "short_requests_excluded_from_near_match": sum(not value for value in signatures), "near_duplicate_pairs": count,
              "cross_split_near_pairs": cross_split, "cross_family_near_pairs": cross_family, "pairs_with_different_tools": differing_schemas,
              "cross_split_components": len(cross_components), "records_requiring_split_review": sum(map(len, cross_components)),
              "evaluation_eligible": not cross_split and not any(len(splits) > 1 for splits in families.values()),
              "limitations": ["Lexical overlap flags require human review; semantic duplicates with different wording can be missed.", "Provisional family labels are not automatically rewritten.", "Source-reported records remain ineligible for native executable patterns."],
              "cross_split_examples": samples}
    (destination / "audit.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report
