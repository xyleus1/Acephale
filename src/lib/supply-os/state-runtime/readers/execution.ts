import "server-only";

import { prisma } from "@/lib/prisma";
import { hashSupplyStateValue } from "@/lib/supply-os/state-runtime/canonicalize";
import type { SupplyWorldEvidenceRef } from "@/lib/supply-os/state-runtime/types";
import {
  boundSupplyStateValue,
  emptySupplyStateReaderResult,
  makeSupplyStateDependency,
  safeIso,
  type SupplyStateReaderInput,
  type SupplyStateReaderResult,
} from "./types";
import { workspaceIdForStateScope } from "./workspace-snapshot";
import {
  effectiveDecisionProposalHash,
  executionControlListValue,
  executionEventListValue,
  workspaceIdentityValue,
  workspacePresentationValue,
} from "./selectors";

const MAX_DECISIONS = 12;
const MAX_APPROVALS = 20;
const MAX_TASKS = 15;
const MAX_EVENTS_PER_TASK = 3;

type ExecutionReaderDependencies = {
  findWorkspace: typeof prisma.supplyWorkspace.findFirst;
  findDecisions: typeof prisma.supplyDecision.findMany;
  findApprovals: typeof prisma.supplyApproval.findMany;
  findTasks: typeof prisma.supplyExecutionTask.findMany;
};

const defaultDependencies: ExecutionReaderDependencies = {
  findWorkspace: (args) => prisma.supplyWorkspace.findFirst(args),
  findDecisions: (args) => prisma.supplyDecision.findMany(args),
  findApprovals: (args) => prisma.supplyApproval.findMany(args),
  findTasks: (args) => prisma.supplyExecutionTask.findMany(args),
};

export async function readExecutionState(
  input: SupplyStateReaderInput,
  dependencies: ExecutionReaderDependencies = defaultDependencies,
): Promise<SupplyStateReaderResult> {
  const workspaceId = workspaceIdForStateScope(input.scope);
  if (!workspaceId) return emptySupplyStateReaderResult();
  const result = emptySupplyStateReaderResult();
  const workspace = await dependencies.findWorkspace({
    where: { id: workspaceId, officeId: input.scope.officeId, status: "ACTIVE" },
    select: {
      id: true,
      companyId: true,
      externalKey: true,
      name: true,
      status: true,
      version: true,
      archivedAt: true,
    },
  });
  if (!workspace) {
    result.dependencies.push(makeSupplyStateDependency({
      key: `workspace.identity:${workspaceId}`,
      source: "APP_DB",
      entityType: "SupplyWorkspace",
      entityRef: workspaceId,
      value: null,
      policy: "STRICT",
      reason: "The execution workspace is missing or inactive.",
    }));
    return result;
  }
  result.dependencies.push(
    makeSupplyStateDependency({
      key: `workspace.identity:${workspaceId}`,
      source: "APP_DB",
      entityType: "SupplyWorkspace",
      entityRef: workspaceId,
      value: workspaceIdentityValue(workspace),
      policy: "STRICT",
      reason: "The execution workspace ownership or lifecycle changed.",
    }),
    makeSupplyStateDependency({
      key: `workspace.presentation:${workspaceId}`,
      source: "APP_DB",
      entityType: "SupplyWorkspace",
      entityRef: workspaceId,
      value: workspacePresentationValue(workspace),
      policy: "ADVISORY",
      reason: "The execution workspace presentation changed.",
    }),
  );
  const [decisions, approvals, tasks] = await Promise.all([
    dependencies.findDecisions({
      where: { officeId: input.scope.officeId, workspaceId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_DECISIONS,
      select: {
        id: true,
        snapshotId: true,
        supersedesDecisionId: true,
        decisionType: true,
        subjectType: true,
        subjectRef: true,
        title: true,
        objective: true,
        status: true,
        riskLevel: true,
        proposal: true,
        proposalHash: true,
        rationale: true,
        constraints: true,
        finalizedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    dependencies.findApprovals({
      where: { officeId: input.scope.officeId, workspaceId },
      orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
      take: MAX_APPROVALS,
      select: {
        id: true,
        decisionId: true,
        executionTaskId: true,
        status: true,
        requiredRole: true,
        scopeHash: true,
        requestReason: true,
        requestedAt: true,
        decidedAt: true,
        expiresAt: true,
        updatedAt: true,
      },
    }),
    dependencies.findTasks({
      where: { officeId: input.scope.officeId, workspaceId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_TASKS,
      select: {
        id: true,
        snapshotId: true,
        decisionId: true,
        scenarioId: true,
        parentTaskId: true,
        taskKey: true,
        taskType: true,
        capabilityKey: true,
        status: true,
        requiresApproval: true,
        input: true,
        inputHash: true,
        resultHash: true,
        externalSystem: true,
        externalRef: true,
        scheduledFor: true,
        startedAt: true,
        completedAt: true,
        failedAt: true,
        cancelledAt: true,
        createdAt: true,
        updatedAt: true,
        events: {
          orderBy: [{ sequence: "desc" }],
          take: MAX_EVENTS_PER_TASK,
          select: {
            id: true,
            sequence: true,
            eventType: true,
            status: true,
            message: true,
            payloadHash: true,
            occurredAt: true,
          },
        },
      },
    }),
  ]);

  const decisionEvidence: SupplyWorldEvidenceRef[] = decisions.map((decision) => ({
    kind: "supply_decision" as const,
    id: decision.id,
    proposalHash: effectiveDecisionProposalHash(decision),
  }));
  const taskEvidence: SupplyWorldEvidenceRef[] = tasks.map((task) => ({
    kind: "execution_task" as const,
    id: task.id,
    inputHash: task.inputHash,
  }));
  const eventEvidence: SupplyWorldEvidenceRef[] = tasks.flatMap((task) => task.events.map((event) => ({
    kind: "execution_event" as const,
    id: event.id,
    payloadHash: event.payloadHash ?? hashSupplyStateValue({
      sequence: event.sequence,
      eventType: event.eventType,
      status: event.status,
      occurredAt: safeIso(event.occurredAt),
    }),
  })));
  result.evidenceRefs.push(...decisionEvidence, ...taskEvidence, ...eventEvidence);
  const eventHeadRows = tasks.flatMap((task) => task.events.map((event) => ({
    ...event,
    executionTaskId: task.id,
  })));
  result.dependencies.push(
    makeSupplyStateDependency({
      key: `execution.controls:${workspaceId}`,
      source: "APP_DB",
      entityType: "SupplyExecutionControlList",
      entityRef: workspaceId,
      value: executionControlListValue({ decisions, approvals, tasks }),
      policy: "ADVISORY",
      reason: "The bounded workspace decision, approval, or task control list changed.",
      evidenceRefs: [...decisionEvidence, ...taskEvidence],
    }),
    makeSupplyStateDependency({
      key: `execution.events:${workspaceId}`,
      source: "APP_DB",
      entityType: "SupplyExecutionEventList",
      entityRef: workspaceId,
      value: executionEventListValue(eventHeadRows),
      policy: "ADVISORY",
      reason: "The bounded workspace execution-event list changed.",
      evidenceRefs: eventEvidence,
    }),
  );
  for (const task of tasks) {
    for (const event of task.events) {
      const payloadHash = event.payloadHash ?? hashSupplyStateValue({
        sequence: event.sequence,
        eventType: event.eventType,
        status: event.status,
        occurredAt: safeIso(event.occurredAt),
      });
      result.dependencies.push(makeSupplyStateDependency({
        key: `execution.event:${event.id}`,
        source: "APP_DB",
        entityType: "SupplyExecutionEvent",
        entityRef: event.id,
        value: { payloadHash, eventType: event.eventType, status: event.status },
        version: payloadHash,
        policy: "ADVISORY",
        reason: "The execution event ledger entry changed or disappeared.",
        evidenceRefs: eventEvidence.filter((reference) => reference.id === event.id),
      }));
    }
  }
  result.currentState.execution = {
    decisions: decisions.map((decision) => ({
      id: decision.id,
      snapshotId: decision.snapshotId,
      supersedesDecisionId: decision.supersedesDecisionId,
      decisionType: decision.decisionType,
      subjectType: decision.subjectType,
      subjectRef: decision.subjectRef,
      title: decision.title,
      objective: decision.objective,
      status: decision.status,
      riskLevel: decision.riskLevel,
      proposal: boundSupplyStateValue(decision.proposal, { maxArray: 30, maxString: 2_000 }),
      proposalHash: decision.proposalHash,
      rationale: decision.rationale,
      constraints: boundSupplyStateValue(decision.constraints, { maxArray: 30, maxString: 1_000 }),
      finalizedAt: safeIso(decision.finalizedAt),
      createdAt: safeIso(decision.createdAt),
    })),
    approvals: approvals.map((approval) => ({
      ...approval,
      requestedAt: safeIso(approval.requestedAt),
      decidedAt: safeIso(approval.decidedAt),
      expiresAt: safeIso(approval.expiresAt),
    })),
    tasks: tasks.map((task) => ({
      id: task.id,
      snapshotId: task.snapshotId,
      decisionId: task.decisionId,
      scenarioId: task.scenarioId,
      parentTaskId: task.parentTaskId,
      taskKey: task.taskKey,
      taskType: task.taskType,
      capabilityKey: task.capabilityKey,
      status: task.status,
      requiresApproval: task.requiresApproval,
      input: boundSupplyStateValue(task.input, { maxArray: 30, maxString: 2_000 }),
      inputHash: task.inputHash,
      resultHash: task.resultHash,
      externalSystem: task.externalSystem,
      externalRef: task.externalRef,
      scheduledFor: safeIso(task.scheduledFor),
      startedAt: safeIso(task.startedAt),
      completedAt: safeIso(task.completedAt),
      failedAt: safeIso(task.failedAt),
      cancelledAt: safeIso(task.cancelledAt),
      createdAt: safeIso(task.createdAt),
      events: task.events.map((event) => ({
        ...event,
        message: event.message?.slice(0, 500) ?? null,
        occurredAt: safeIso(event.occurredAt),
      })).reverse(),
    })),
  };
  result.openLoops.push(
    ...approvals.filter((approval) => approval.status === "PENDING").map((approval) => ({
      kind: "pending_supply_approval",
      approvalId: approval.id,
      decisionId: approval.decisionId,
      executionTaskId: approval.executionTaskId,
      requiredRole: approval.requiredRole,
      expiresAt: safeIso(approval.expiresAt),
    })),
    ...tasks.filter((task) => ["PLANNED", "BLOCKED", "READY", "RUNNING"].includes(task.status)).map((task) => ({
      kind: "active_supply_execution_task",
      taskId: task.id,
      taskType: task.taskType,
      status: task.status,
      requiresApproval: task.requiresApproval,
    })),
  );
  result.sourceCounts = {
    supplyDecisions: decisions.length,
    supplyApprovals: approvals.length,
    supplyExecutionTasks: tasks.length,
    supplyExecutionEvents: tasks.reduce((count, task) => count + task.events.length, 0),
  };
  return result;
}
