import type { CustomerProcurementListItem } from "./customer-procurement";

export type SupplyOsPanelAlert = {
  count: number;
  label: string;
  latestAt: string;
};

export type SupplyOsChatActivity = {
  lastAgentMessageAt: string | null;
  openQuestions: number;
  pendingActions: number;
};

const SOURCING_APPROVAL_STATUSES = new Set([
  "awaiting_shortlist_approval",
  "awaiting_order_approval",
]);

function timestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value).valueOf();
  return Number.isFinite(parsed) ? parsed : null;
}

function isNewer(value: string | null | undefined, seenAt: string | null) {
  const at = timestamp(value);
  if (at === null) return false;
  const seen = timestamp(seenAt);
  return seen === null || at > seen;
}

export function chatPanelAlert(
  activity: SupplyOsChatActivity | null,
  seenAt: string | null,
): SupplyOsPanelAlert | null {
  if (!activity || !isNewer(activity.lastAgentMessageAt, seenAt)) return null;
  const latestAt = activity.lastAgentMessageAt as string;
  if (activity.openQuestions > 0) {
    return {
      count: activity.openQuestions,
      label: `${activity.openQuestions} question${activity.openQuestions === 1 ? "" : "s"} waiting on you`,
      latestAt,
    };
  }
  if (activity.pendingActions > 0) {
    return {
      count: activity.pendingActions,
      label: `${activity.pendingActions} suggested action${activity.pendingActions === 1 ? "" : "s"} to review`,
      latestAt,
    };
  }
  return { count: 1, label: "New chat reply", latestAt };
}

export function sourcingPanelAlert(
  requests: CustomerProcurementListItem[],
  seenAt: string | null,
): SupplyOsPanelAlert | null {
  const updated = requests.filter((request) => isNewer(request.updatedAt, seenAt));
  if (!updated.length) return null;
  const latestAt = updated
    .map((request) => request.updatedAt)
    .sort()
    .at(-1) as string;
  const blocked = updated.filter((request) => request.status === "needs_attention");
  if (blocked.length) {
    return {
      count: blocked.length,
      label: blocked.length === 1
        ? "1 sourcing request needs attention"
        : `${blocked.length} sourcing requests need attention`,
      latestAt,
    };
  }
  const approvals = updated.filter((request) => SOURCING_APPROVAL_STATUSES.has(request.status));
  if (approvals.length) {
    return {
      count: approvals.length,
      label: `${approvals.length} sourcing request${approvals.length === 1 ? "" : "s"} ready for your approval`,
      latestAt,
    };
  }
  const replies = updated.filter((request) => request.responseCount > 0);
  if (replies.length) {
    return {
      count: replies.length,
      label: `${replies.length} sourcing request${replies.length === 1 ? "" : "s"} with supplier replies`,
      latestAt,
    };
  }
  return {
    count: updated.length,
    label: `${updated.length} sourcing update${updated.length === 1 ? "" : "s"}`,
    latestAt,
  };
}
