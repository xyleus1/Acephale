from dataclasses import replace
from graphlib import CycleError
import unittest

from finite_work_plan import Controller, Plan, Stage, assess


def fixture(*, shared=False, now=0, hard=900):
    stages = (
        Stage('setup', 'setup', 100, resources=('host',)),
        Stage('qualify', 'qualification', 100, ('setup',), ('host',)),
        Stage('seed-a', 'work', 200, ('qualify',), ('gpu-a',), 50, ('seed-a/task-1',)),
        Stage('seed-b', 'work', 200, ('qualify',), ('gpu-a' if shared else 'gpu-b',), 50, ('seed-b/task-1',)),
        Stage('export', 'export', 50, ('seed-a', 'seed-b'), ('disk',)),
        Stage('drain', 'drain', 50, ('export',), ('host',)),
    )
    controllers = tuple(Controller(name, 0, 1000, 1120, 1200, 100, 120) for name in ('first', 'second'))
    return Plan(0, now, hard, 1500, controllers, stages, ('seed-a/task-1', 'seed-b/task-1'))


class FeasibilityTests(unittest.TestCase):
    def test_parallel_critical_path_and_resource_overlap(self):
        result = assess(fixture())
        self.assertTrue(result.feasible)
        self.assertEqual(result.precedence_critical_path_seconds, 500)
        self.assertEqual(result.resource_schedule_seconds, 500)
        work = [row for row in result.intervals if row.stage.startswith('seed-')]
        self.assertEqual(work[0].starts_at, work[1].starts_at)

    def test_shared_resource_serializes_and_can_reject(self):
        plan = fixture(shared=True, hard=650)
        result = assess(plan)
        self.assertEqual(result.precedence_critical_path_seconds, 500)
        self.assertEqual(result.resource_schedule_seconds, 700)
        self.assertFalse(result.feasible)
        for first, second in zip(result.intervals, result.intervals[1:]):
            if set(first.resources) & set(second.resources):
                self.assertGreaterEqual(second.starts_at, first.ends_at)

    def test_missing_setup_or_drain_is_rejected(self):
        plan = fixture()
        for missing in ('setup', 'drain'):
            remaining = tuple(replace(s, dependencies=tuple(p for p in s.dependencies if p != missing))
                              for s in plan.stages if s.name != missing)
            with self.subTest(missing=missing), self.assertRaises(ValueError):
                assess(replace(plan, stages=remaining))

    def test_missing_export_or_qualification_is_rejected(self):
        plan = fixture()
        for missing in ('export', 'qualify'):
            remaining = tuple(replace(s, dependencies=('setup',) if missing in s.dependencies else s.dependencies)
                              for s in plan.stages if s.name != missing)
            with self.subTest(missing=missing), self.assertRaises(ValueError):
                assess(replace(plan, stages=remaining))

    def test_controller_age_reduces_available_work(self):
        young = assess(fixture(now=0))
        old = assess(fixture(now=450))
        self.assertTrue(young.feasible)
        self.assertFalse(old.feasible)
        self.assertEqual(old.available_window_seconds, 450)
        self.assertEqual(old.controller_deadline, young.controller_deadline)

    def test_equality_cutoff_rejected(self):
        self.assertFalse(assess(fixture(hard=500)).feasible)
        self.assertTrue(assess(fixture(hard=501)).feasible)

    def test_strict_tail_margin_and_earlier_phase_deadline(self):
        plan = fixture()
        stages = tuple(replace(s, phase_deadline=450) if s.name == 'seed-a' else s for s in plan.stages)
        self.assertIn('full_window_does_not_fit:seed-a', assess(replace(plan, stages=stages)).reasons)
        stages = tuple(replace(s, phase_deadline=451) if s.name == 'seed-a' else s for s in plan.stages)
        self.assertTrue(assess(replace(plan, stages=stages)).feasible)

    def test_cleanup_window_cannot_outlive_job(self):
        plan = fixture()
        for changed in (replace(plan.controllers[0], required_cleanup_seconds=121),
                        replace(plan.controllers[0], job_timeout_seconds=1120)):
            with self.assertRaises(ValueError):
                assess(replace(plan, controllers=(changed, plan.controllers[1])))

    def test_identity_exactness_and_no_retry_policy(self):
        plan = fixture()
        result = assess(plan)
        self.assertEqual(result.declared_units, plan.declared_units)
        self.assertEqual(result.failure_policy, 'retain_declared_failures_no_replacement')
        for changed in (replace(plan, declared_units=('seed-a/task-1', 'seed-b/task-2')),
                        replace(plan, failure_policy='retry_failed'),
                        replace(plan, duration_basis='inferred_from_accuracy')):
            with self.assertRaises(ValueError):
                assess(changed)

    def test_duplicate_units_and_cycles_rejected(self):
        plan = fixture()
        stages = tuple(replace(s, units=('seed-a/task-1',)) if s.name == 'seed-b' else s for s in plan.stages)
        with self.assertRaises(ValueError):
            assess(replace(plan, stages=stages))
        stages = tuple(replace(s, dependencies=('drain',)) if s.name == 'setup' else s for s in plan.stages)
        with self.assertRaises(CycleError):
            assess(replace(plan, stages=stages))

    def test_inputs_immutable_and_deterministic(self):
        plan = fixture()
        first = assess(plan)
        self.assertEqual(first, assess(plan))
        self.assertEqual(plan, fixture())
        self.assertEqual(len(first.input_sha256), 64)

    def test_derived_time_overflow_and_lost_precision_rejected(self):
        plan = fixture()
        for changed in (replace(plan, reserved_at=1e308, now=1e308, lease_ceiling_seconds=1e308),
                        replace(plan, now=1e308), replace(plan, now=10**1000)):
            with self.subTest(now=str(changed.now)[:30]), self.assertRaises(ValueError):
                assess(changed)

    def test_earliest_controller_and_original_lease_ceiling_are_binding(self):
        plan = fixture()
        controllers = (replace(plan.controllers[0], started_at=100), plan.controllers[1])
        result = assess(replace(plan, now=100, controllers=controllers))
        self.assertEqual(result.controller_deadline, 900)
        self.assertIn('hard_deadline_exceeds_actual_controller_coverage', assess(replace(plan, hard_deadline=950)).reasons)
        self.assertIn('hard_deadline_exceeds_lease_ceiling', assess(replace(plan, lease_ceiling_seconds=800)).reasons)

    def test_declared_two_seed_maxima_do_not_fit(self):
        # Synthetic serial caps with the same phase shape; no observed run or score.
        plan = fixture(shared=True)
        stages = (
            Stage('setup', 'setup', 7200, resources=('host',)),
            Stage('strict-export', 'work', 3300, ('setup',), ('gpu',), 900, ('strict',), False),
            Stage('qualify-a', 'qualification', 3600, ('strict-export',), ('gpu',), 660),
            Stage('replay-a', 'work', 7800, ('qualify-a',), ('gpu',), 180, ('seed-a',)),
            Stage('qualify-b', 'qualification', 3600, ('replay-a',), ('gpu',), 660),
            Stage('replay-b', 'work', 7800, ('qualify-b',), ('gpu',), 180, ('seed-b',)),
            Stage('export', 'export', 120, ('replay-b',), ('disk',)),
            Stage('drain', 'drain', 120, ('export',), ('host',)),
        )
        controllers = tuple(Controller(c.name, 0, 19800, 20700, 21000, 300, 900) for c in plan.controllers)
        result = assess(Plan(0, 0, 19500, 28800, controllers, stages, ('strict', 'seed-a', 'seed-b')))
        self.assertFalse(result.feasible)
        self.assertEqual(result.precedence_critical_path_seconds, 33540)
        self.assertGreater(result.required_window_seconds, result.available_window_seconds)


if __name__ == '__main__':
    unittest.main(verbosity=2)
