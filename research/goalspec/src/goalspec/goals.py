"""Training-only endpoint ontology and a deterministic retrieval baseline.

This classifier is deliberately labelled lexical and uncalibrated. An embedding
or API classifier implements the same PrefixView-only protocol and must be
selected and calibrated on development data before a research claim is made.
"""

from __future__ import annotations

import hashlib
import math
import re
import unicodedata
from collections import Counter
from collections.abc import Iterable
from typing import Protocol

from pydantic import Field, model_validator

from goalspec.binding import canonical
from goalspec.replay import initial_prefix
from goalspec.schemas import GoalPosterior, GoalSignature, PrefixView, Record, Trajectory

UNKNOWN_GOAL = "__unknown__"
_STOPWORDS = frozenset("a an the to for of is are be been was were and or in on at by with it this that i my me please want would could you your can will have has do as from".split())


def _normalize_text(text: str, instance_values: tuple[str, ...]) -> str:
    value = unicodedata.normalize("NFKC", text).strip().lower()
    for instance in sorted(set(instance_values), key=lambda item: (-len(item), item)):
        if len(instance.strip()) >= 2:
            value = re.sub(r"(?<!\w)" + re.escape(instance.lower()) + r"(?!\w)", "{instance}", value)
    value = re.sub(r"[\w.+-]+@[\w.-]+\.[a-z]{2,}", "{email}", value)
    value = re.sub(r"\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b", "{id}", value)
    value = re.sub(r"\b([a-z_]*(?:id|name|email|address|phone))\s*[:=]\s*(?:\"[^\"]*\"|'[^']*'|[^\s,;]+)", r"\1={instance}", value)
    return " ".join(value.split())


def normalize_goal(goal: GoalSignature, instance_values: Iterable[str] = ()) -> GoalSignature:
    """Hash normalized semantic fields; imported goal IDs never define clusters.

    Adapters must provide endpoint predicates rather than reference action paths.
    Only explicit identity syntax or caller-declared instance values are removed.
    Numeric thresholds and durations are semantic constraints and remain intact.
    Reviewers must slot free-form instances before fitting; this is not an NER
    system, and it must not inspect a realized actor path to discover label slots.
    """
    instances = tuple(instance_values)
    payload = {
        "objective": _normalize_text(goal.objective, instances).upper(),
        "object_type": _normalize_text(goal.object_type, instances),
        "completion": tuple(sorted({_normalize_text(item, instances) for item in goal.completion})),
        "constraints": tuple(sorted({_normalize_text(item, instances) for item in goal.constraints})),
    }
    goal_id = "goal_" + hashlib.sha256(canonical(payload).encode("utf-8")).hexdigest()[:20]
    return GoalSignature(goal_id=goal_id, **payload)


def canonical_goal(trajectory: Trajectory) -> GoalSignature | None:
    """Offline only: canonicalize reviewed labels independently of realized paths.

    Actor arguments, results, task IDs, and template IDs must not influence goal
    identity. Otherwise two trials of one endpoint can acquire path-specific labels
    and accidentally give the oracle information about which actions occurred.
    """
    goal = trajectory.outcome.goal
    if goal is None:
        return None
    return normalize_goal(goal)


def is_mining_success(trajectory: Trajectory) -> bool:
    """Native success determines labels; incomplete or excluded episodes cannot train."""
    outcome = trajectory.outcome
    if outcome.success is not True or outcome.status == "incomplete" or outcome.native_excluded_from_success:
        return False
    requested = {event.call_id for event in trajectory.events if event.kind == "tool_request"}
    resolved = {event.call_id for event in trajectory.events if event.kind == "tool_result"}
    return requested == resolved


class GoalPredictor(Protocol):
    def predict(self, prefix: PrefixView) -> GoalPosterior: ...


class GoalExample(Record):
    benchmark: str
    domain: str
    goal_id: str
    text: str


class GoalCatalog(Record):
    signatures: tuple[GoalSignature, ...]
    examples: tuple[GoalExample, ...]
    model_id: str = "lexical-cosine-v1-uncalibrated"
    score_power: float = Field(default=4.0, gt=0, allow_inf_nan=False)
    unknown_floor: float = Field(default=0.05, ge=0, lt=1, allow_inf_nan=False)

    @model_validator(mode="after")
    def consistent(self) -> GoalCatalog:
        ids = {signature.goal_id for signature in self.signatures}
        if len(ids) != len(self.signatures) or UNKNOWN_GOAL in ids:
            raise ValueError("Catalog signatures need unique nonreserved IDs")
        if any(example.goal_id not in ids for example in self.examples):
            raise ValueError("Example references an unknown signature")
        return self

    def predict(self, prefix: PrefixView) -> GoalPosterior:
        examples = [example for example in self.examples if example.benchmark == prefix.benchmark and example.domain == prefix.domain]
        if not examples:
            return GoalPosterior(probabilities={UNKNOWN_GOAL: 1.0}, through_seq=prefix.through_seq, model_id=self.model_id)
        by_id = {signature.goal_id: signature for signature in self.signatures}
        goal_ids = sorted({example.goal_id for example in examples})
        texts = [f"{by_id[example.goal_id].text} {example.text}" for example in examples]
        # Every word on the predictor side was visible at this decision boundary.
        observation_text = " ".join(
            f"{event.tool} {canonical(event.result)[:2048]}"
            for event in prefix.events[-16:]
            if event.kind == "tool_result"
        )
        similarities = cosine_scores(f"{prefix.text} {observation_text}", texts)
        scores = {goal_id: 0.0 for goal_id in goal_ids}
        for example, score in zip(examples, similarities, strict=True):
            scores[example.goal_id] = max(scores[example.goal_id], score)
        best = max(scores.values())
        if best <= 0:
            return GoalPosterior(probabilities={UNKNOWN_GOAL: 1.0}, through_seq=prefix.through_seq, model_id=self.model_id)
        unknown = max(self.unknown_floor, 1.0 - best)
        weights = {goal_id: score ** self.score_power for goal_id, score in scores.items()}
        total = sum(weights.values())
        probabilities = {goal_id: (1.0 - unknown) * weight / total for goal_id, weight in weights.items()}
        probabilities[UNKNOWN_GOAL] = unknown
        return GoalPosterior(probabilities=probabilities, through_seq=prefix.through_seq, model_id=self.model_id)


def tokens(text: str) -> Counter[str]:
    parts = re.findall(r"[a-z]{2,}", unicodedata.normalize("NFKC", text).lower().replace("_", " "))
    # Small deterministic suffix normalization, not a semantic embedding.
    return Counter(part[:-1] if part.endswith("s") and len(part) > 4 else part for part in parts if part not in _STOPWORDS)


def cosine_scores(query: str, documents: list[str]) -> list[float]:
    """TF-IDF cosine with IDF fitted only to supplied training documents."""
    if not documents:
        return []
    counts = [tokens(document) for document in documents]
    frequencies = Counter(term for count in counts for term in count)
    idf = {term: math.log((1 + len(counts)) / (1 + frequency)) + 1 for term, frequency in frequencies.items()}

    def vector(count: Counter[str]) -> dict[str, float]:
        weighted = {term: (1 + math.log(frequency)) * idf[term] for term, frequency in count.items() if term in idf}
        norm = math.sqrt(sum(weight * weight for weight in weighted.values()))
        return {term: weight / norm for term, weight in weighted.items()} if norm else {}

    target = vector(tokens(query))
    return [min(1.0, sum(target.get(term, 0.0) * weight for term, weight in vector(count).items())) for count in counts]


def fit_goals(trajectories: Iterable[Trajectory]) -> GoalCatalog:
    """Only callers' successful training trajectories contribute to this artifact."""
    signatures: dict[str, GoalSignature] = {}
    examples: dict[tuple[str, str, str, str], GoalExample] = {}
    for trajectory in trajectories:
        if not is_mining_success(trajectory):
            continue
        goal = canonical_goal(trajectory)
        if goal is None:
            continue
        signatures[goal.goal_id] = goal
        # Share replay's boundary, including any greeting before the first user.
        text = initial_prefix(trajectory).text
        key = (trajectory.benchmark, trajectory.domain, goal.goal_id, text)
        examples[key] = GoalExample(benchmark=trajectory.benchmark, domain=trajectory.domain, goal_id=goal.goal_id, text=text)
    return GoalCatalog(signatures=tuple(signatures[key] for key in sorted(signatures)), examples=tuple(examples[key] for key in sorted(examples)))
