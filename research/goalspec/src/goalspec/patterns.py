"""Prefix-projected structural subsequence mining with endpoint mixtures.

The PASTE pattern abstraction is implemented with bounded PrefixSpan projection,
symbolic argument flow, and empirical validation. Bounds, smoothing, and the
restricted argument language are explicit rather than presented as the authors'
unreleased implementation. Independent task-group support is retained.
"""

from __future__ import annotations

import hashlib
from collections import defaultdict
from collections.abc import Iterable
from functools import lru_cache
from typing import Literal

from pydantic import Field, PrivateAttr

from goalspec.binding import ArgumentBinding, FitReferenceCache, canonical, infer_binding
from goalspec.goals import UNKNOWN_GOAL, canonical_goal, is_mining_success
from goalspec.schemas import Candidate, GoalPosterior, Prediction, PrefixView, Record, Trajectory

NO_AVAILABLE_TOOL = "__no_available_tool__"


class Pattern(Record):
    pattern_id: str
    benchmark: str
    domain: str
    goal_id: str | None
    context: tuple[str, ...]
    tool: str
    support: int = Field(ge=1)
    context_support: int = Field(ge=1)
    observations: int = Field(ge=1)
    context_observations: int = Field(ge=1)
    probability: float = Field(gt=0, le=1, allow_inf_nan=False)
    binding: ArgumentBinding | None = None


class PatternPool(Record):
    schema_version: Literal[1] = 1
    miner_id: str = "bounded-prefixspan-v2-fixed-context"
    conditioning_context: Literal["shared_unconditioned"] = "shared_unconditioned"
    max_context: int = Field(default=3, ge=0, le=6)
    max_history: int = Field(default=12, ge=1, le=32)
    min_support: int = Field(default=2, ge=1)
    smoothing: float = Field(default=0.5, gt=0, allow_inf_nan=False)
    patterns: tuple[Pattern, ...]
    training_trajectory_ids: tuple[str, ...]
    _indexed_patterns: tuple[Pattern, ...] | None = PrivateAttr(default=None)
    _row_index: dict[tuple[str, str, str | None, tuple[str, ...]], tuple[Pattern, ...]] = PrivateAttr(default_factory=dict)
    _context_index: dict[tuple[str, str], dict[tuple[str, ...], tuple[int, int]]] = PrivateAttr(default_factory=dict)

    def _ensure_indexes(self) -> None:
        # model_copy(update=...) may replace patterns while inheriting private
        # caches. Identity checking makes both shallow and deep copies safe.
        if self._indexed_patterns is self.patterns:
            return
        rows: dict[tuple[str, str, str | None, tuple[str, ...]], list[Pattern]] = defaultdict(list)
        contexts: dict[tuple[str, str], dict[tuple[str, ...], tuple[int, int]]] = defaultdict(dict)
        for pattern in self.patterns:
            rows[(pattern.benchmark, pattern.domain, pattern.goal_id, pattern.context)].append(pattern)
            if pattern.goal_id is None:
                key = (pattern.benchmark, pattern.domain)
                rank = pattern.context_support, pattern.context_observations
                contexts[key][pattern.context] = max(contexts[key].get(pattern.context, rank), rank)
        # Replace containers instead of clearing inherited shared dictionaries.
        self._row_index = {key: tuple(values) for key, values in rows.items()}
        self._context_index = dict(contexts)
        self._indexed_patterns = self.patterns

    def selected_context(self, prefix: PrefixView) -> tuple[str, ...] | None:
        """Select C once without access to G, shared by every paired condition.

        Comparing independently selected goal-specific contexts changes two
        conditioning variables. Fixing C makes the endpoint ablation interpretable
        and permits direct auditing from the structural prefix alone.
        """
        self._ensure_indexes()
        available = self._context_index.get((prefix.benchmark, prefix.domain), {})
        contexts = [context for context in subsequences(prefix.signatures[-self.max_history:], self.max_context) if context in available]
        if not contexts:
            return None
        return max(contexts, key=lambda context: (len(context), *available[context], context))

    def _matching(self, prefix: PrefixView, goal_id: str | None, context: tuple[str, ...] | None) -> tuple[Pattern, ...]:
        if context is None:
            return ()
        self._ensure_indexes()
        return self._row_index.get((prefix.benchmark, prefix.domain, goal_id, context), ())

    def _conditional(self, prefix: PrefixView, goal_id: str | None, context: tuple[str, ...] | None) -> tuple[dict[str, float], tuple[Candidate, ...]]:
        tools = {tool.name: tool for tool in prefix.tools}
        if not tools:
            return {NO_AVAILABLE_TOOL: 1.0}, ()
        rows = self._matching(prefix, goal_id, context)
        if not rows and goal_id is not None:
            # Sparse goal support backs off at the exact same structural C.
            rows = self._matching(prefix, None, context)
        observed = {pattern.tool: pattern for pattern in rows}
        weights = {name: (observed[name].observations if name in observed else 0) + self.smoothing for name in tools}
        total = sum(weights.values())
        distribution = {name: weight / total for name, weight in sorted(weights.items())}
        candidates: list[Candidate] = []
        for name, probability in distribution.items():
            pattern = observed.get(name)
            if pattern is None or pattern.binding is None:
                continue
            arguments = pattern.binding.bind(prefix, tools[name])
            if arguments is not None:
                candidates.append(Candidate(tool=name, arguments=arguments, probability=probability * pattern.binding.precision, pattern_id=pattern.pattern_id))
        return distribution, tuple(candidates)

    def predict(self, prefix: PrefixView, posterior: GoalPosterior | None = None) -> Prediction:
        context = self.selected_context(prefix)
        if posterior is None:
            distribution, candidates = self._conditional(prefix, None, context)
            return Prediction(tool_distribution=distribution, candidates=tuple(sorted(candidates, key=lambda candidate: (-candidate.probability, candidate.tool, canonical(candidate.arguments)))))
        if posterior.through_seq > prefix.through_seq:
            raise ValueError("Goal posterior contains information beyond this prefix")
        combined: dict[str, float] = defaultdict(float)
        arguments_by_key: dict[tuple[str, str], Candidate] = {}
        candidate_weights: dict[tuple[str, str], float] = defaultdict(float)
        for goal_id, goal_probability in posterior.probabilities.items():
            if goal_probability == 0:
                continue
            distribution, candidates = self._conditional(prefix, None if goal_id == UNKNOWN_GOAL else goal_id, context)
            for tool, probability in distribution.items():
                combined[tool] += goal_probability * probability
            for candidate in candidates:
                key = (candidate.tool, canonical(candidate.arguments))
                candidate_weights[key] += goal_probability * candidate.probability
                arguments_by_key[key] = candidate
        # Floating point mixtures can exceed one by a few ulps at degenerate inputs.
        candidates = tuple(
            arguments_by_key[key].model_copy(update={"probability": min(1.0, probability)})
            for key, probability in sorted(candidate_weights.items(), key=lambda item: (-item[1], item[0]))
        )
        return Prediction(tool_distribution=dict(sorted(combined.items())), candidates=candidates, goal_posterior=posterior)


@lru_cache(maxsize=8192)
def subsequences(history: tuple[str, ...], max_context: int) -> tuple[tuple[str, ...], ...]:
    """All order-preserving subsequences via prefix projection, including gaps."""
    return tuple(context for context, _ in frequent_contexts((history,), ("one",), max_context, 1))


def frequent_contexts(
    histories: tuple[tuple[str, ...], ...],
    groups: tuple[str, ...],
    max_context: int,
    min_support: int,
) -> tuple[tuple[tuple[str, ...], tuple[int, ...]], ...]:
    """PrefixSpan over singleton structural events with group-level support.

    A projected row is (source sequence, first possible suffix position). Keeping
    the earliest occurrence of each extension retains every order-preserving
    continuation while counting a sequence only once per candidate context.
    """
    if len(histories) != len(groups):
        raise ValueError("Each sequence must have a support group")
    result: list[tuple[tuple[str, ...], tuple[int, ...]]] = []

    def project(context: tuple[str, ...], rows: tuple[tuple[int, int], ...]) -> None:
        indexes = tuple(index for index, _ in rows)
        if len({groups[index] for index in indexes}) < min_support:
            return
        result.append((context, indexes))
        if len(context) >= max_context:
            return
        extensions: dict[str, list[tuple[int, int]]] = defaultdict(list)
        for index, start in rows:
            seen: set[str] = set()
            for position in range(start, len(histories[index])):
                symbol = histories[index][position]
                if symbol not in seen:
                    extensions[symbol].append((index, position + 1))
                    seen.add(symbol)
        for symbol in sorted(extensions):
            project((*context, symbol), tuple(extensions[symbol]))

    project((), tuple((index, 0) for index in range(len(histories))))
    return tuple(result)


def fit_patterns(
    trajectories: Iterable[Trajectory],
    max_context: int = 3,
    min_support: int = 2,
    *,
    max_history: int = 12,
    smoothing: float = 0.5,
) -> PatternPool:
    """Mine successful training traces backward by endpoint, preserving causal prefixes.

    Context support counts distinct task groups, so repeated actor trials cannot
    satisfy the recurrence threshold alone. Probabilities count action samples;
    argument candidates require repeated exact bindings in independent groups.
    """
    from goalspec.replay import decision_points

    # Validate resource bounds even when training has no successful trajectories.
    settings = PatternPool(max_context=max_context, max_history=max_history, min_support=min_support, smoothing=smoothing, patterns=(), training_trajectory_ids=())
    samples: dict[tuple[str, str, str | None, tuple[str, ...], str], list] = defaultdict(list)
    records: dict[tuple[str, str, str | None], list] = defaultdict(list)
    context_groups: dict[tuple, set[str]] = defaultdict(set)
    target_groups: dict[tuple, set[str]] = defaultdict(set)
    context_counts: dict[tuple, int] = defaultdict(int)
    vocabularies: dict[tuple[str, str], set[str]] = defaultdict(set)
    training_ids: list[str] = []
    seen_ids: set[str] = set()
    for trajectory in trajectories:
        if trajectory.trajectory_id in seen_ids:
            raise ValueError("Duplicate training trajectory ID")
        seen_ids.add(trajectory.trajectory_id)
        if not is_mining_success(trajectory):
            continue
        training_ids.append(trajectory.trajectory_id)
        goal = canonical_goal(trajectory)
        goal_ids = (None, goal.goal_id) if goal is not None else (None,)
        # Reverse iteration indexes paths from their endpoint. Each PrefixView is
        # still the unmodified, causal view before its original action batch.
        for prefix, targets in reversed(list(decision_points(trajectory))):
            for target in targets:
                if target.tool is None or target.arguments is None:
                    continue
                vocabularies[(trajectory.benchmark, trajectory.domain)].add(target.tool)
            for goal_id in goal_ids:
                records[(trajectory.benchmark, trajectory.domain, goal_id)].append((prefix, targets, trajectory.group_id))
    # All eligible training argument roots/subtrees are known before binding.
    # Reuse filtered reference maps across overlapping structural contexts while
    # keeping the complete learner input and every empirical count unchanged.
    reference_cache = FitReferenceCache(
        target.arguments
        for (_, _, goal_id), occurrences in records.items() if goal_id is None
        for _, targets, _ in occurrences
        for target in targets if target.tool is not None and target.arguments is not None
    )
    for scope, occurrences in records.items():
        histories = tuple(prefix.signatures[-max_history:] for prefix, _, _ in occurrences)
        groups = tuple(group for _, _, group in occurrences)
        for context, indexes in frequent_contexts(histories, groups, max_context, min_support):
            context_key = (*scope, context)
            for index in indexes:
                prefix, targets, group = occurrences[index]
                for target in targets:
                    if target.tool is None or target.arguments is None:
                        continue
                    key = (*context_key, target.tool)
                    samples[key].append((prefix, target.arguments, group))
                    context_groups[context_key].add(group)
                    target_groups[key].add(group)
                    context_counts[context_key] += 1
    patterns: list[Pattern] = []
    for key in sorted(samples, key=canonical):
        benchmark, domain, goal_id, context, tool_name = key
        context_key = key[:-1]
        context_support = len(context_groups[context_key])
        if context_support < min_support:
            continue
        support = len(target_groups[key])
        examples = [(prefix, arguments) for prefix, arguments, _ in samples[key]]
        binding = None
        if support >= max(2, min_support):
            contracts = [next((tool for tool in prefix.tools if tool.name == tool_name), None) for prefix, _ in examples]
            if contracts and all(contract is not None and contract.parameters == contracts[0].parameters for contract in contracts):
                binding = infer_binding(examples, contracts[0], min_examples=min_support, reference_lookup=reference_cache)
                if binding is not None:
                    matching_groups = {group for prefix, arguments, group in samples[key] if canonical(binding.bind(prefix, contracts[0])) == canonical(arguments)}
                    if len(matching_groups) < max(2, min_support):
                        binding = None
        observations = len(examples)
        count = context_counts[context_key]
        vocabulary_size = len(vocabularies[(benchmark, domain)])
        pattern_id = "pattern_" + hashlib.sha256(canonical(key).encode("utf-8")).hexdigest()[:20]
        patterns.append(Pattern(pattern_id=pattern_id, benchmark=benchmark, domain=domain, goal_id=goal_id, context=context, tool=tool_name, support=support, context_support=context_support, observations=observations, context_observations=count, probability=(observations + smoothing) / (count + smoothing * vocabulary_size), binding=binding))
    return settings.model_copy(update={"patterns": tuple(patterns), "training_trajectory_ids": tuple(sorted(training_ids))})
