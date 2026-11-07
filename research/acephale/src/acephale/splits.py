"""Deterministic grouped assignment performed before learning any artifacts."""

from __future__ import annotations

import hashlib
from collections import defaultdict
from typing import Literal

from pydantic import Field

from acephale.schemas import Record, Trajectory
from acephale.storage import content_hash

Partition = Literal["train", "development", "test"]


def group_key(trajectory: Trajectory) -> str:
    return content_hash([trajectory.benchmark, trajectory.domain, trajectory.group_id])


class SplitManifest(Record):
    schema_version: Literal[1] = 1
    seed: int
    corpus_hash: str
    assignments: dict[str, Partition]
    groups: dict[str, str]
    fractions: tuple[float, float, float] = (0.6, 0.2, 0.2)
    method: Literal["grouped", "official"] = "grouped"
    expected_trials: int = Field(default=4, ge=1)

    def select(self, trajectories: list[Trajectory], partition: Partition) -> list[Trajectory]:
        self.verify(trajectories)
        return [t for t in trajectories if self.assignments[t.trajectory_id] == partition]

    def verify(self, trajectories: list[Trajectory]) -> None:
        if self.corpus_hash != corpus_digest(trajectories):
            raise ValueError("Corpus bytes/content do not match the split manifest")
        ids = {t.trajectory_id for t in trajectories}
        if len(ids) != len(trajectories) or ids != set(self.assignments) or ids != set(self.groups):
            raise ValueError("Split manifest must account for every unique trajectory exactly once")
        by_group: dict[str, set[str]] = defaultdict(set)
        by_task: dict[tuple[str, str, str], set[str]] = defaultdict(set)
        trial_grid: dict[tuple[str, str, str], list[int]] = defaultdict(list)
        for t in trajectories:
            if self.groups[t.trajectory_id] != group_key(t):
                raise ValueError("Group identity changed")
            partition = self.assignments[t.trajectory_id]
            by_group[group_key(t)].add(partition)
            by_task[(t.benchmark, t.domain, t.task_id)].add(partition)
            trial_grid[(t.benchmark, t.domain, t.task_id)].append(t.trial)
        if any(len(parts) != 1 for parts in [*by_group.values(), *by_task.values()]):
            raise ValueError("Related tasks or repeated trials cross split boundaries")
        if any(sorted(trials) != list(range(self.expected_trials)) for trials in trial_grid.values()):
            raise ValueError("Every task requires the complete declared unique trial grid")


def corpus_digest(trajectories: list[Trajectory]) -> str:
    return content_hash([t.model_dump(mode="json") for t in sorted(trajectories, key=lambda t: t.trajectory_id)])


def make_splits(trajectories: list[Trajectory], seed: int = 42, expected_trials: int = 4) -> SplitManifest:
    strata: dict[tuple[str, str], set[str]] = defaultdict(set)
    for t in trajectories:
        strata[(t.benchmark, t.domain)].add(group_key(t))
    partitions: dict[str, Partition] = {}
    for groups in strata.values():
        if len(groups) < 5:
            raise ValueError("Need at least five independent groups per benchmark/domain")
        ordered = sorted(groups, key=lambda group: hashlib.sha256(f"{seed}:{group}".encode()).digest())
        train_end = max(1, int(len(ordered) * 0.6))
        dev_end = min(len(ordered) - 1, train_end + max(1, int(len(ordered) * 0.2)))
        for index, group in enumerate(ordered):
            partitions[group] = "train" if index < train_end else "development" if index < dev_end else "test"
    manifest = SplitManifest(
        seed=seed, corpus_hash=corpus_digest(trajectories), expected_trials=expected_trials,
        assignments={t.trajectory_id: partitions[group_key(t)] for t in trajectories},
        groups={t.trajectory_id: group_key(t) for t in trajectories},
    )
    manifest.verify(trajectories)
    return manifest
