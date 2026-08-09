import { Icon } from "@/components/icon";
import {
  JobConversationPanel,
  type FeedItem,
} from "@/components/job-conversation-panel";
import { LoadRouteMap } from "@/components/load-route-map";
import type {
  LoadFact,
  LoadWorkspaceModel,
} from "@/lib/load-workspace";
import styles from "./load-workspace.module.css";

const FACT_GROUPS: Array<{
  key: LoadFact["group"];
  label: string;
}> = [
  { key: "movement", label: "Movement" },
  { key: "cargo", label: "Cargo" },
  { key: "timing", label: "Timing" },
  { key: "trade", label: "Trade and customs" },
];

const FACT_STATE_LABEL: Record<LoadFact["state"], string> = {
  recorded: "Recorded",
  source_stated: "Source stated",
  confirmed: "Confirmed",
  conflict: "Conflict",
  missing: "Missing",
};

function formatPriority(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function LoadWorkspace({
  jobId,
  reference,
  companyName,
  origin,
  destination,
  mode,
  etdLabel,
  etaLabel,
  model,
  feed,
}: {
  jobId: string;
  reference: string;
  companyName: string;
  origin?: string | null;
  destination?: string | null;
  mode?: string | null;
  etdLabel?: string | null;
  etaLabel?: string | null;
  model: LoadWorkspaceModel;
  feed: FeedItem[];
}) {
  const intelQuestion = encodeURIComponent(
    `Research current market, customs, port, and regulatory risks for ${reference}: ${origin || "origin unknown"} to ${destination || "destination unknown"}. Keep operational facts separate from market intelligence and cite sources.`
  );
  const conflictCount = model.issues.filter(
    (issue) => issue.kind === "conflict"
  ).length;

  return (
    <section className={styles.workspace} data-load-workspace>
      <header className={styles.commandHeader}>
        <div className={styles.commandCopy}>
          <span className={styles.eyebrow}>Load control</span>
          <h2>
            {model.primaryAction
              ? model.primaryAction.title
              : "Review the load before the next commitment"}
          </h2>
          <p>
            One place for shipment truth, unresolved risks, correspondence,
            and the next operator move.
          </p>
        </div>
        <div className={styles.headerActions}>
          <a
            className={styles.primaryLink}
            href={`/dashboard/intel/load?jobId=${encodeURIComponent(jobId)}`}
          >
            <Icon name="sparkles" size={14} />
            Review this load in Intel
          </a>
          <a
            className={styles.secondaryLink}
            href={`/dashboard/intel?question=${intelQuestion}`}
          >
            Research lane risks
          </a>
        </div>
      </header>

      <div className={styles.signalStrip}>
        <div>
          <span>Operational truth</span>
          <strong>
            {model.readiness.known}/{model.readiness.total} facts recorded
          </strong>
          <small>
            {model.readiness.missing > 0
              ? `${model.readiness.missing} unresolved`
              : conflictCount > 0
                ? `${conflictCount} unresolved conflict${conflictCount === 1 ? "" : "s"}`
                : "No required gaps detected"}
          </small>
        </div>
        <div>
          <span>Action queue</span>
          <strong>{model.actions.length} open</strong>
          <small>
            {model.issues.filter((issue) =>
              issue.level === "critical" || issue.level === "high"
            ).length}{" "}
            high attention
          </small>
        </div>
        <div>
          <span>Correspondence</span>
          <strong>{model.evidence.messageCount} messages</strong>
          <small>
            {model.evidence.threadCount} deduped thread
            {model.evidence.threadCount === 1 ? "" : "s"}
          </small>
        </div>
        <div>
          <span>Document control</span>
          <strong>
            {model.evidence.approvedDocumentCount}/
            {model.evidence.documentCount} approved
          </strong>
          <small>{model.evidence.pendingDocumentCount} pending</small>
        </div>
      </div>

      <div className={styles.mainGrid}>
        <div className={styles.intelligenceColumn}>
          <section className={styles.decisionSection}>
            <div className={styles.sectionHeading}>
              <div>
                <span>Decision brief</span>
                <h3>Issues and next actions</h3>
              </div>
              <a href={`/dashboard/intelligence?jobId=${encodeURIComponent(jobId)}#impact-reviews`}>
                {model.evidence.marketReviewCount} linked market review
                {model.evidence.marketReviewCount === 1 ? "" : "s"}
              </a>
            </div>

            <div className={styles.decisionGrid}>
              <div className={styles.issueList}>
                <span className={styles.listLabel}>Needs attention</span>
                {model.issues.length === 0 ? (
                  <p className={styles.emptyLine}>
                    No explicit conflict or linked market alert is recorded.
                  </p>
                ) : (
                  model.issues.slice(0, 6).map((issue) => (
                    <article
                      key={issue.id}
                      className={styles.issue}
                      data-level={issue.level}
                    >
                      <span className={styles.issueMarker} aria-hidden />
                      <div>
                        <div className={styles.issueTopline}>
                          <strong>{issue.title}</strong>
                          <span>{formatPriority(issue.level)}</span>
                        </div>
                        <p>{issue.detail}</p>
                        {issue.evidence ? (
                          <small>Evidence: {issue.evidence}</small>
                        ) : null}
                      </div>
                    </article>
                  ))
                )}
              </div>

              <div className={styles.actionList}>
                <span className={styles.listLabel}>Do next</span>
                {model.actions.length === 0 ? (
                  <p className={styles.emptyLine}>
                    No open task is recorded. Review the dossier before
                    committing externally.
                  </p>
                ) : (
                  <ol>
                    {model.actions.slice(0, 6).map((action) => (
                      <li key={action.id} data-priority={action.priority}>
                        <span className={styles.actionIndex} aria-hidden />
                        <div>
                          <strong>{action.title}</strong>
                          {action.detail ? <p>{action.detail}</p> : null}
                          <small>
                            {formatPriority(action.priority)}
                            {action.dueAt ? ` · Due ${action.dueAt}` : ""}
                            {action.source === "market"
                              ? " · Market review"
                              : action.source === "task"
                                ? " · Load task"
                                : " · Derived from missing data"}
                          </small>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </section>

          <section className={styles.mapSection}>
            <LoadRouteMap
              origin={origin}
              destination={destination}
              mode={mode}
              etdLabel={etdLabel}
              etaLabel={etaLabel}
              compact
            />
          </section>

          <section className={styles.dossierSection}>
            <div className={styles.sectionHeading}>
              <div>
                <span>Shipment dossier</span>
                <h3>Facts with their evidence state</h3>
              </div>
              <a href={`/dashboard/inbox?job=${encodeURIComponent(jobId)}`}>
                Open source conversations
              </a>
            </div>
            <div className={styles.factGroups}>
              {FACT_GROUPS.map((group) => (
                <div key={group.key} className={styles.factGroup}>
                  <h4>{group.label}</h4>
                  <dl>
                    {model.facts
                      .filter((fact) => fact.group === group.key)
                      .map((fact) => (
                        <div key={fact.key} data-state={fact.state}>
                          <dt>{fact.label}</dt>
                          <dd>
                            <strong>{fact.value || "Not provided"}</strong>
                            <span>{FACT_STATE_LABEL[fact.state]}</span>
                            {fact.evidence ? (
                              <small>{fact.evidence}</small>
                            ) : null}
                          </dd>
                        </div>
                      ))}
                  </dl>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className={styles.conversationColumn} data-load-workspace-agent>
          <div className={styles.conversationContext}>
            <span>Load conversation</span>
            <strong>{companyName}</strong>
            <small>
              Ask about this load, paste a new reply, or run a desk tool. Agent
              actions remain scoped to {reference}.
            </small>
          </div>
          <JobConversationPanel
            scopeJobId={jobId}
            scopeJobReference={reference}
            feed={feed}
            suggestions={[
              "What blocks this load right now?",
              "Summarize the latest conversation.",
              "Which documents should I request next?",
            ]}
          />
        </aside>
      </div>
    </section>
  );
}
