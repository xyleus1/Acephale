"""Pure finite-window planning. This module never admits or executes a lease.

Durations are caller-supplied declared caps, not estimates inferred from scores.
The deterministic resource schedule is conservative, not an optimal job-shop solver.
Tail margins are admission guards, not work duplicated after every stage.
"""
from dataclasses import asdict, dataclass
from graphlib import TopologicalSorter
import hashlib
import json
import math

NO_RETRY = 'retain_declared_failures_no_replacement'
KINDS = frozenset(('setup', 'qualification', 'work', 'export', 'drain'))


@dataclass(frozen=True)
class Stage:
    name: str
    kind: str
    seconds: float
    dependencies: tuple[str, ...] = ()
    resources: tuple[str, ...] = ()
    tail_margin: float = 0
    units: tuple[str, ...] = ()
    requires_qualification: bool = True
    phase_deadline: float | None = None


@dataclass(frozen=True)
class Controller:
    name: str
    started_at: float
    lifetime_seconds: float
    cleanup_until_seconds: float
    job_timeout_seconds: float
    lease_margin_seconds: float
    required_cleanup_seconds: float


@dataclass(frozen=True)
class Plan:
    reserved_at: float
    now: float
    hard_deadline: float
    lease_ceiling_seconds: float
    controllers: tuple[Controller, ...]
    stages: tuple[Stage, ...]
    declared_units: tuple[str, ...]
    failure_policy: str = NO_RETRY
    duration_basis: str = 'declared_caps'


@dataclass(frozen=True)
class Interval:
    stage: str
    starts_at: float
    ends_at: float
    required_until: float
    deadline: float
    resources: tuple[str, ...]


@dataclass(frozen=True)
class Assessment:
    feasible: bool
    reasons: tuple[str, ...]
    precedence_critical_path_seconds: float
    resource_schedule_seconds: float
    required_window_seconds: float
    available_window_seconds: float
    controller_deadline: float
    intervals: tuple[Interval, ...]
    declared_units: tuple[str, ...]
    failure_policy: str
    input_sha256: str
    scope: str = 'Conditional timing feasibility only; no authority or completion claim.'


def require(value, message):
    if not value:
        raise ValueError(message)


def finite(value, *, positive=False):
    require(type(value) in (int, float), 'Finite numeric input required')
    try:
        is_finite = math.isfinite(value)
    except OverflowError:
        is_finite = False
    require(is_finite, 'Finite numeric input required')
    require(value > 0 if positive else value >= 0, 'Positive cap or nonnegative time required')


def add_time(start, seconds):
    result = start + seconds
    finite(result)
    require(seconds == 0 or result > start, 'Duration must advance the finite time base')
    return result


def identifiers(values):
    require(type(values) is tuple and all(type(x) is str and x for x in values), 'Tuple of nonempty identities required')
    require(len(values) == len(set(values)), 'Duplicate identity')


def assess(plan: Plan) -> Assessment:
    require(type(plan) is Plan, 'Explicit immutable plan required')
    for value in (plan.reserved_at, plan.now, plan.hard_deadline):
        finite(value)
    finite(plan.lease_ceiling_seconds, positive=True)
    require(plan.reserved_at <= plan.now, 'Reservation cannot start after observation')
    require(plan.failure_policy == NO_RETRY, 'Failed units cannot be retried or replaced by this planner')
    require(plan.duration_basis == 'declared_caps', 'Explicit declared caps required')
    identifiers(plan.declared_units)
    require(bool(plan.declared_units), 'Declared scientific units required')
    require(type(plan.controllers) is tuple and len(plan.controllers) >= 2, 'At least two controller windows required')
    require(all(type(c) is Controller for c in plan.controllers), 'Typed controllers required')
    identifiers(tuple(c.name for c in plan.controllers))
    for controller in plan.controllers:
        finite(controller.started_at)
        require(controller.started_at <= plan.now, 'Actual controller start cannot be in the future')
        for field in ('lifetime_seconds', 'cleanup_until_seconds', 'job_timeout_seconds',
                      'lease_margin_seconds', 'required_cleanup_seconds'):
            finite(getattr(controller, field), positive=True)
        require(controller.lifetime_seconds > controller.lease_margin_seconds,
                'Controller must leave a positive work window')
        require(add_time(controller.lifetime_seconds, controller.required_cleanup_seconds) <= controller.cleanup_until_seconds
                < controller.job_timeout_seconds, 'Independent cleanup must fit before job timeout')
    require(type(plan.stages) is tuple and plan.stages and all(type(s) is Stage for s in plan.stages),
            'Typed finite work stages required')
    identifiers(tuple(s.name for s in plan.stages))
    stages = {s.name: s for s in plan.stages}
    for stage in plan.stages:
        require(type(stage.kind) is str and stage.kind in KINDS, 'Unknown stage kind')
        finite(stage.seconds, positive=True)
        finite(stage.tail_margin)
        identifiers(stage.dependencies)
        identifiers(stage.resources)
        identifiers(stage.units)
        require(bool(stage.resources), 'Explicit exclusive resources required')
        require(set(stage.dependencies) <= stages.keys(), 'Missing dependency')
        require(type(stage.requires_qualification) is bool, 'Explicit qualification policy required')
        require((stage.kind == 'work') == bool(stage.units), 'Only work stages carry declared units')
        if stage.phase_deadline is not None:
            finite(stage.phase_deadline, positive=True)
            require(stage.phase_deadline <= plan.hard_deadline, 'Phase cannot extend the original hard deadline')
    actual_units = tuple(unit for stage in plan.stages for unit in stage.units)
    identifiers(actual_units)
    require(set(actual_units) == set(plan.declared_units), 'Declared units must appear exactly once, unchanged')
    graph = {name: tuple(sorted(stages[name].dependencies)) for name in sorted(stages)}
    order = tuple(TopologicalSorter(graph).static_order())
    ancestors = {}
    for name in order:
        ancestors[name] = set(graph[name])
        for parent in graph[name]:
            ancestors[name].update(ancestors[parent])
    names_by_kind = {kind: {s.name for s in plan.stages if s.kind == kind} for kind in KINDS}
    require(names_by_kind['setup'] and names_by_kind['export'] and names_by_kind['drain'],
            'Setup, export and drain caps are mandatory')
    for name, stage in stages.items():
        if stage.kind != 'setup':
            require(bool(ancestors[name] & names_by_kind['setup']), 'Every stage must follow declared setup')
        if stage.kind != 'drain':
            require(any(name in ancestors[drain] for drain in names_by_kind['drain']),
                    'Every stage must close through a declared drain')
        if stage.kind == 'work':
            require(any(name in ancestors[export] for export in names_by_kind['export']),
                    'Each scientific unit must precede artifact export')
            if stage.requires_qualification:
                require(bool(ancestors[name] & names_by_kind['qualification']),
                        'Work requires fresh qualification on its dependency path')

    controller_deadline = min(add_time(c.started_at, c.lifetime_seconds) - c.lease_margin_seconds for c in plan.controllers)
    ceiling = add_time(plan.reserved_at, plan.lease_ceiling_seconds)
    effective_deadline = min(plan.hard_deadline, ceiling, controller_deadline)
    reasons = []
    if plan.hard_deadline > ceiling:
        reasons.append('hard_deadline_exceeds_lease_ceiling')
    if plan.hard_deadline > controller_deadline:
        reasons.append('hard_deadline_exceeds_actual_controller_coverage')
    unconstrained_ends, ends, resource_ends, intervals = {}, {}, {}, []
    for name in order:
        stage = stages[name]
        unconstrained_ends[name] = add_time(max((unconstrained_ends[p] for p in graph[name]), default=0), stage.seconds)
        start = max([plan.now, *(ends[p] for p in graph[name]),
                     *(resource_ends.get(resource, plan.now) for resource in stage.resources)])
        end = add_time(start, stage.seconds)
        required_until = add_time(end, stage.tail_margin)
        deadline = min(effective_deadline, stage.phase_deadline if stage.phase_deadline is not None else effective_deadline)
        if required_until >= deadline:
            reasons.append('full_window_does_not_fit:' + name)
        ends[name] = end
        for resource in stage.resources:
            resource_ends[resource] = end
        intervals.append(Interval(name, start, end, required_until, deadline, stage.resources))
    digest = hashlib.sha256(json.dumps(asdict(plan), sort_keys=True, separators=(',', ':'),
                                       allow_nan=False).encode()).hexdigest()
    return Assessment(not reasons, tuple(reasons), max(unconstrained_ends.values()),
        max(ends.values()) - plan.now, max(row.required_until for row in intervals) - plan.now,
        effective_deadline - plan.now, controller_deadline, tuple(intervals), plan.declared_units,
        plan.failure_policy, digest)
