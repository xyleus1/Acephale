"""Frozen, domain-scoped goal retrieval backends for paired replay experiments."""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any, Literal

import numpy as np
from pydantic import Field, model_validator

from goalspec.binding import canonical
from goalspec.goals import UNKNOWN_GOAL, GoalCatalog
from goalspec.models import (
    EmbeddingIndex,
    LLMGoalPredictor,
    ModelConfig,
    calibrated_distribution,
    embed_texts,
    public_model_input,
)
from goalspec.schemas import GoalPosterior, GoalSignature, PrefixView, Record

Embedder = Callable[[Sequence[str], str], list[list[float]]]


class BackendConfig(Record):
    backend: Literal["lexical", "llm", "embedding", "cached_llm"] = "lexical"
    model: str | None = None
    update_policy: Literal["dynamic", "initial"] = "dynamic"
    cached_predictions: str | None = None
    cache_sha256: str | None = None
    calibration_temperature: float = Field(default=1.0, gt=0, allow_inf_nan=False)
    retrieval_engine: Literal["numpy", "faiss"] = "numpy"

    @model_validator(mode="after")
    def model_required(self) -> BackendConfig:
        if self.backend != "lexical" and (self.model is None or not self.model.strip()):
            raise ValueError("LLM and embedding backends require an explicit model ID")
        if self.backend == "lexical" and self.model is not None:
            raise ValueError("The lexical backend has no provider model")
        if self.backend == "cached_llm":
            if not self.cached_predictions or not self.cache_sha256 or self.update_policy != "initial":
                raise ValueError("Cached LLM requires a hashed prediction file and initial update policy")
        elif self.cached_predictions is not None or self.cache_sha256 is not None:
            raise ValueError("Cached prediction fields require the cached_llm backend")
        return self


def _digest(value: Any) -> str:
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


class GoalBackend:
    """Backend choice and calibration are experiment configuration, never test tuning.

    Identical visible contexts share cached model outputs across paired conditions.
    Artifacts include the exact training index and scored input hashes/posteriors,
    allowing provider stochasticity to be audited independently from replay.
    """

    def __init__(
        self,
        catalog: GoalCatalog,
        config: BackendConfig | None = None,
        *,
        embedder: Embedder | None = None,
        completion: Callable | None = None,
    ):
        # Record is frozen at field assignment; a deep copy also separates nested
        # mutable dictionaries from the caller's training artifact.
        self.catalog = catalog.model_copy(deep=True)
        self.config = (config or BackendConfig()).model_copy(deep=True)
        self._embedder = embedder or embed_texts
        self._completion = completion
        self._scoped_signatures: dict[tuple[str, str], tuple[GoalSignature, ...]] = {}
        self._indexes: dict[tuple[str, str], EmbeddingIndex] = {}
        self._index_goal_ids: dict[tuple[str, str], tuple[str, ...]] = {}
        self._index_text_hashes: dict[tuple[str, str], tuple[str, ...]] = {}
        self._cache: dict[tuple[str, str, str], GoalPosterior] = {}
        self._query_vectors: dict[tuple[str, str, str], list[float]] = {}
        self._recorded: dict[tuple[str, str, str], dict[str, float]] = {}
        if self.config.backend == "cached_llm":
            from goalspec.storage import file_hash

            path = Path(self.config.cached_predictions)
            if file_hash(path) != self.config.cache_sha256:
                raise ValueError("Cached goal predictions failed SHA-256 verification")
            capture = json.loads(path.read_text(encoding="utf-8"))
            if capture["catalog_sha256"] != _digest(self.catalog.model_dump(mode="json")) or capture["model"] != self.config.model:
                raise ValueError("Cached goal predictions belong to a different catalog or model")
            if capture["status"] != "complete" or capture["input_policy"] != "public_initial_context_only":
                raise ValueError("Cached predictions must be a complete initial-context capture")
            for row in capture["predictions"]:
                key = row["benchmark"], row["domain"], row["input_sha256"]
                if key in self._recorded:
                    raise ValueError("Duplicate cached public context")
                self._recorded[key] = row["probabilities"]
        by_id = {signature.goal_id: signature for signature in self.catalog.signatures}
        scoped_ids: dict[tuple[str, str], set[str]] = defaultdict(set)
        for example in self.catalog.examples:
            scoped_ids[(example.benchmark, example.domain)].add(example.goal_id)
        for scope, goal_ids in scoped_ids.items():
            self._scoped_signatures[scope] = tuple(by_id[goal_id] for goal_id in sorted(goal_ids))
        if self.config.backend == "embedding" and self.catalog.examples:
            self._build_embedding_indexes(by_id)

    def _build_embedding_indexes(self, by_id: dict[str, GoalSignature]) -> None:
        examples = self.catalog.examples
        texts = [f"{by_id[example.goal_id].text}\n{example.text}" for example in examples]
        vectors = self._embedder(texts, self.config.model)
        if len(vectors) != len(texts):
            raise ValueError("Embedding provider returned an incomplete training batch")
        grouped: dict[tuple[str, str], list[int]] = defaultdict(list)
        for index, example in enumerate(examples):
            grouped[(example.benchmark, example.domain)].append(index)
        for scope, indexes in grouped.items():
            self._indexes[scope] = EmbeddingIndex([vectors[index] for index in indexes], engine=self.config.retrieval_engine)
            self._index_goal_ids[scope] = tuple(examples[index].goal_id for index in indexes)
            self._index_text_hashes[scope] = tuple(_digest(texts[index]) for index in indexes)

    def predict(self, prefix: PrefixView) -> GoalPosterior:
        scope = (prefix.benchmark, prefix.domain)
        signatures = self._scoped_signatures.get(scope, ())
        if not signatures:
            return GoalPosterior(probabilities={UNKNOWN_GOAL: 1.0}, through_seq=prefix.through_seq, model_id=f"{self.config.backend}:unseen-scope")
        public = public_model_input(prefix)
        key = (*scope, _digest(public))
        if key in self._cache:
            return self._cache[key].model_copy(update={"through_seq": prefix.through_seq}, deep=True)
        if self.config.backend == "lexical":
            raw = self.catalog.predict(prefix)
            probabilities = calibrated_distribution(raw.probabilities, self.config.calibration_temperature)
            model_id = raw.model_id
        elif self.config.backend == "cached_llm":
            if key not in self._recorded:
                raise ValueError("No cached prediction for this exact public context")
            raw = self._recorded[key]
            if set(raw) - ({g.goal_id for g in signatures} | {UNKNOWN_GOAL}):
                raise ValueError("Cached classifier returned an out-of-scope goal ID")
            probabilities = calibrated_distribution(raw, self.config.calibration_temperature)
            model_id = f"cached_llm:{self.config.model}"
        elif self.config.backend == "llm":
            predictor = LLMGoalPredictor(signatures, ModelConfig(model=self.config.model), calibration_temperature=self.config.calibration_temperature, completion=self._completion)
            raw = predictor.predict(prefix)
            probabilities = raw.probabilities
            model_id = raw.model_id
        else:
            probabilities = self._predict_embedding(scope, public, key)
            model_id = f"embedding:{self.config.model}"
        posterior = GoalPosterior(probabilities=probabilities, through_seq=prefix.through_seq, model_id=f"{model_id}:T={self.config.calibration_temperature:g}")
        self._cache[key] = posterior.model_copy(deep=True)
        return posterior

    def _predict_embedding(self, scope: tuple[str, str], public: dict[str, Any], key: tuple[str, str, str]) -> dict[str, float]:
        query_vectors = self._embedder([canonical(public)], self.config.model)
        if len(query_vectors) != 1:
            raise ValueError("Embedding provider returned an incomplete query batch")
        index = self._indexes[scope]
        goal_ids = self._index_goal_ids[scope]
        scores = {goal_id: 0.0 for goal_id in goal_ids}
        query = np.array(query_vectors[0], dtype=np.float32, copy=True)
        for position, score in index.search(query.tolist(), k=len(goal_ids)):
            scores[goal_ids[position]] = max(scores[goal_ids[position]], max(0.0, min(1.0, score)))
        query /= np.linalg.norm(query)
        self._query_vectors[key] = query.tolist()
        best = max(scores.values())
        if best <= 0:
            return {UNKNOWN_GOAL: 1.0}
        unknown = max(self.catalog.unknown_floor, 1.0 - best)
        weights = {goal_id: score ** self.catalog.score_power for goal_id, score in scores.items()}
        total = sum(weights.values())
        probabilities = {goal_id: (1 - unknown) * weight / total for goal_id, weight in weights.items()}
        probabilities[UNKNOWN_GOAL] = unknown
        return calibrated_distribution(probabilities, self.config.calibration_temperature)

    def artifacts(self) -> dict[str, Any]:
        """Return an owned JSON-serializable snapshot, including optional API outputs."""
        indexes = []
        for scope, index in sorted(self._indexes.items()):
            indexes.append({
                "benchmark": scope[0], "domain": scope[1],
                "goal_ids": list(self._index_goal_ids[scope]),
                "text_sha256": list(self._index_text_hashes[scope]),
                "vectors": index.vectors.tolist(), "engine": index.engine,
            })
        queries = []
        for key, posterior in sorted(self._cache.items()):
            queries.append({
                "benchmark": key[0], "domain": key[1], "input_sha256": key[2],
                "posterior": posterior.model_dump(mode="json"),
                "vector": list(self._query_vectors[key]) if key in self._query_vectors else None,
            })
        return {
            "schema_version": 1,
            "config": self.config.model_dump(mode="json"),
            "catalog_sha256": _digest(self.catalog.model_dump(mode="json")),
            "embedding_indexes": indexes,
            "scored_inputs": queries,
        }
