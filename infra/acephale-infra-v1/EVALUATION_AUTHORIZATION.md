# Evaluation of retained weights

Completed optimizer outputs can need export or reload diagnosis after their
training lease expires. An evaluation authorization uses an already reserved,
active provider lease. It does not create a fitting window or another financial
reservation, change a training receipt, or grant permission to run an optimizer.

1. On the actual provider host, run `evaluation-preflight --hardware-profile
   a100-40gb-v1 --provider-receipt RECEIPT --output NEW_PREFLIGHT`. The existing
   GPU checks must observe stopped actor/predictor containers and no GPU jobs.
   The machine-id hash must match the verified provider/SSH receipt.
2. The current sole operator runs `evaluation-lease --ledger SLICE --lease-id ID
   --preflight NEW_PREFLIGHT --output NEW_AUTHORIZATION --seconds SECONDS`.
   The observation must be at most 120 seconds old and match this exact instance.
   The requested interval must end at least 300 seconds before its existing
   provider deadline, with a maximum of eight hours. Existing holds remain.
3. Build the execution image from the exact new committed execution source.
   Its image receipt must match `executingSourceCommit`. Original optimizer
   specifications, weights and source identities remain unchanged.
4. The model container accepts this authorization for `diagnostic`, `export`
   and `evaluate`. `diagnostic` takes the retained `--training-run` and is capped
   at 600 seconds. Training, smoke optimization and batch profiling reject it.
   Strict export tolerances and artifact verification remain unchanged.
5. Evaluation readiness uses purpose `predictor_evaluation` with observed
   `pinnedModels`, `pinnedImages`, `driver`, `actorStopped`, `cudaInference`,
   `export` and `watchdogRecovery` checks plus the exact current instance ID.
   This proves setup readiness, not successful model qualification or a score.

The provider lease keeps purpose `research`. Its setup deadline, independent
watchdogs and termination obligations still apply. Export verification records
the current execution-authorization hash separately from historical training
identity. Native trials still require their own actual serving qualification.

The Python entry point is `training.validate_execution_lease(path,
action="diagnostic" | "export" | "evaluate")`. Legacy training receipts retain
their existing validator. Evaluation receipts cannot be passed to the unchanged
training-lease validator.
