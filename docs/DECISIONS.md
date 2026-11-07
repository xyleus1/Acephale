# Acephale decisions

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
