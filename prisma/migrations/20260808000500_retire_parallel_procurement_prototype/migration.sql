/*
  Warning:

  - This migration permanently deletes the retired prototype's persisted data.
  - All tables are dropped in one statement so their internal foreign-key
    dependencies are removed together.
  - No CASCADE is used. An unexpected dependency from an active table will stop
    the migration instead of silently removing that dependency.
*/
BEGIN;

DROP TABLE
  "SupplyApproval",
  "SupplyBomLine",
  "SupplyBomVersion",
  "SupplyCapabilityRun",
  "SupplyDecisionEvidence",
  "SupplyExecutionEvent",
  "SupplyEvidence",
  "SupplyImportRun",
  "SupplyInventoryPosition",
  "SupplyItemAlias",
  "SupplyPlanningResult",
  "SupplyScenarioComparison",
  "SupplyScenarioEvidence",
  "SupplySupplierTerm",
  "SupplyDemand",
  "SupplyEquivalenceRule",
  "SupplyExecutionTask",
  "SupplyFccProfile",
  "SupplyLocation",
  "SupplyMediaAsset",
  "SupplyScenario",
  "SupplyDecision",
  "SupplyItem",
  "SupplySnapshot",
  "SupplyWorkspaceMember",
  "SupplyWorkspace";

DROP FUNCTION supply_assert_workspace_scope();
DROP FUNCTION supply_assert_snapshot_scope();
DROP FUNCTION supply_prevent_published_snapshot_mutation();
DROP FUNCTION supply_prevent_published_child_mutation();
DROP FUNCTION supply_assert_office_reference();
DROP FUNCTION supply_assert_same_snapshot_reference();
DROP FUNCTION supply_assert_reference_scope();
DROP FUNCTION supply_assert_user_office_scope();
DROP FUNCTION supply_require_draft_decision();
DROP FUNCTION supply_validate_scenario_comparison();
DROP FUNCTION supply_validate_approval_scope();
DROP FUNCTION supply_guard_capability_run_state();
DROP FUNCTION supply_guard_decision_state();
DROP FUNCTION supply_guard_approval_state();
DROP FUNCTION supply_validate_execution_task_links();
DROP FUNCTION supply_guard_execution_task_state();
DROP FUNCTION supply_validate_execution_event_run();
DROP FUNCTION supply_prevent_append_only_mutation();

COMMIT;
