# Acephale decisions

## 2026-11-10: preserve provider identity across both runtime guards

Lambda execution uses its actual API association, pinned SSH host key and local
machine-id hash. Python and Node must verify the same receipt and compute the
same heartbeat provenance; a permissive instance-ID regex alone is insufficient.
AWS's existing identity path remains separately validated. An observed host key
is operator-pinned trust, not provider attestation.

## 2026-11-10: train the small predictor, retain the fixed actor

Implement an explicitly scoped LoRA experiment on the pinned Qwen3.5-0.8B
auxiliary predictor. This extends the earlier fixed-weight decision without
changing Qwen3.5-9B actor weights, prompt, tool catalog or native limits. Goal
conditioning guides speculative read selection; the scheduler remains the
authorization and execution boundary. No actor fine-tuning, model soup or RL
is part of this experiment.

Use production-compiled prompts, completion-only supervised loss, the separate
locked PyTorch/Transformers/PEFT/TRL environment and immutable adapter/merged
artifacts. Replace uncalibrated numeric score generation in the trained path
with a versioned binary-hit protocol using both raw token log probabilities.
Keep the existing predictor protocol as an explicit baseline.

Reserve disjoint weight-fitting, calibration/reliability, development and test
families. Memory for trained predictors excludes every non-fitting family.
Existing APIGen labels need source checks and the declared 20-example human
review before goal supervision. Preserve the research-only license and do not
represent source-reported trajectories as independent native replay.

Use the explicitly qualified A100 40 GB profile if current Lambda capacity,
price and serving/training checks pass. Stop actor serving during training.
Cap two seeds together at two GPU hours, retain the $500 original journal,
$35 infrastructure ceiling, protected contingency and unresolved reservations.
Provider credits do not create a new allowance. Bind provider leases to that
same original ledger, independent cleanup controllers and verified exports.

No benchmark gain follows from these implementation choices. Select the
checkpoint with development evidence, freeze it, and measure matched replay
and paired native trials before asserting accuracy or latency improvement.

## 2026-11-07: standalone fixed-actor infrastructure study

Acephale contains only the research runtime, tools, data preparation, evaluation,
deployment and observability needed for goal-conditioned speculative reads. The
actor is pinned Qwen3.5-9B and the default predictor is pinned Qwen3.5-0.8B. Actor
weights and available tools remain fixed across primary arms. Capacity changes
or weight training require separately declared experiments.

Compare base actor, neutral-memory prefetch and goal-conditioned memory prefetch
on the same tasks/seeds. Use one ranking request per checkpoint, source-grounded
arguments, independent next-batch hit marginals and exact-invocation promotion.
Only audited reads may execute speculatively. Goals are predictor context, not
permission to alter actor tools or authorize side effects.

Use the standard serving/SDK, direct PostgreSQL/pgvector SQL and OpenTelemetry
stack. Python retains native environments and private evaluation. Freeze family
splits, memory, calibration and deployment profiles before scoring. Keep native
reward, logical calls, physical calls, wall latency and costs separate. Do not
equate matched-panel binary log loss with full-action entropy.

Preserve the original external $500 journal and unresolved reservations through
the repository split. The filesystem location is private operator configuration.
Historical reports and hash-bound artifacts remain unchanged in the original
checkout and history; they are not implicitly eligible training or evaluation
data for Acephale. New claims require new compatible artifacts and measured trials.

## 2026-11-07: verification and CI identity

Local/CI unit tests use Python 3.12.14; the independently observed live deployment
still requires its pinned Python 3.12.16. This is an explicit test-environment
choice, not a silent serving-model or production-runtime substitution.

Pin the CI runner to Ubuntu 24.04, setup actions to verified commits and the
pgvector service to its verified image digest. GitHub's
[runner inventory](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md)
announces an Ubuntu-latest transition this month, so the moving alias would weaken
reproducibility. CI installs locked dependencies, applies direct research SQL and
runs real disposable-database integration. Record remote results only after
execution. The [completed main-branch run](https://github.com/xyleus1/Acephale/actions/runs/42357269977)
at `d510c1bbc139e09fe9e40ed1145daead87fbfb18` now establishes CI integration for
the research PostgreSQL/pgvector code. It does not establish production publication
or native task accuracy.

Keep initial failures, targeted repairs and full-suite runs distinguishable in
verification records. Never transform a fixed single test into an invented fresh
all-passing full-suite result, and never count overlapping reruns twice.
