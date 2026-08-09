import type {
  ChinaCustomsDecisionGate,
  ChinaCustomsDecisionGuide,
  ChinaCustomsRuleChange,
  CustomsAssessmentState,
  CustomsAuthorityReference,
  CustomsDecisionStage,
  CustomsQuoteEffect,
  IntelSourceUse,
} from "@/lib/intel";
import styles from "./china-customs-decision-guide.module.css";

type ChinaCustomsDecisionGuideProps = {
  guide: ChinaCustomsDecisionGuide;
  sourceIndex: ReadonlyMap<string, number>;
};

const ASSESSMENT_LABELS: Record<CustomsAssessmentState, string> = {
  missing_input: "Missing shipment input",
  conditional_screen: "Conditional product screen",
  authority_review_required: "Authority review required",
  reference_ready: "Reference ready",
};

const STAGE_LABELS: Record<CustomsDecisionStage, string> = {
  before_quote: "Before quote",
  before_booking: "Before booking",
  before_loading: "Before loading",
  before_entry: "Before entry",
  after_release: "After release",
};

const EFFECT_LABELS: Record<CustomsQuoteEffect, string> = {
  blocks_landed_cost: "Blocks landed cost",
  blocks_clearance_commitment: "Blocks clearance promise",
  changes_duty: "Can change duty",
  changes_timing: "Can change timing",
  post_entry_control: "Post-entry control",
};

function sourceKey(source: IntelSourceUse): string {
  return `${source.sourceId}|${source.sourceUrl}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatReviewTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatBoundaryInstant(
  value: string,
  timeZone: "America/Los_Angeles"
): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(new Date(value));
}

function formatOfficialEasternBoundary(value: string): string {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):\d{2}(?:\.\d{3})?(-04:00|-05:00)$/
  );
  if (!match) return value;
  const [, year, month, day, hour, minute, offset] = match;
  const wallTime = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute)
    )
  );
  const label = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(wallTime);
  return `${label} ${offset === "-04:00" ? "EDT" : "EST"}`;
}

function formatRuleBoundary(
  change: Pick<
    ChinaCustomsRuleChange,
    "effectiveDate" | "effectiveAt" | "effectiveTo" | "effectiveToAt"
  >,
  boundary: "start" | "end"
): string {
  const exact =
    boundary === "start" ? change.effectiveAt : change.effectiveToAt;
  const date =
    boundary === "start" ? change.effectiveDate : change.effectiveTo;
  if (exact) return formatOfficialEasternBoundary(exact);
  return date ? formatDate(date) : "";
}

function formatDatePrecision(value: string): string {
  if (/^\d{4}$/.test(value)) return value;
  if (/^\d{4}-\d{2}$/.test(value)) {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(`${value}-01T00:00:00.000Z`));
  }
  return formatDate(value);
}

function authorityDate(authority: CustomsAuthorityReference): string {
  const dates: string[] = [];
  if (authority.effectiveFrom && authority.effectiveTo) {
    dates.push(
      `Effective ${formatDate(authority.effectiveFrom)} to ${formatDate(
        authority.effectiveTo
      )}`
    );
  } else if (authority.effectiveFrom) {
    dates.push(`Effective ${formatDate(authority.effectiveFrom)}`);
  }
  if (authority.publishedAt) {
    dates.push(`Published ${formatDatePrecision(authority.publishedAt)}`);
  }
  if (authority.documentRevisionDate) {
    dates.push(
      `Document revised ${formatDatePrecision(authority.documentRevisionDate)}`
    );
  }
  if (authority.pageModifiedDate) {
    dates.push(`Page modified ${formatDate(authority.pageModifiedDate)}`);
  }
  return dates.length > 0 ? dates.join(" | ") : "Current reference";
}

function AuthorityLinks({
  authorityIds,
  authorityById,
  sourceIndex,
  showCaveat = false,
}: {
  authorityIds: readonly string[];
  authorityById: ReadonlyMap<string, CustomsAuthorityReference>;
  sourceIndex: ReadonlyMap<string, number>;
  showCaveat?: boolean;
}) {
  return (
    <ul className={styles.authorityList} aria-label="Official authorities">
      {authorityIds.map((authorityId) => {
        const authority = authorityById.get(authorityId);
        if (!authority) return null;
        const index = sourceIndex.get(sourceKey(authority.source));
        return (
          <li key={authorityId}>
            {index ? (
              <a
                href={`#source-s${index}`}
                aria-label={`Open source S${index}, ${authority.label}`}
              >
                S{index}
              </a>
            ) : null}
            <div>
              <strong>{authority.label}</strong>
              <small>
                {authorityDate(authority)}
                {authority.status === "historical_reference"
                  ? " | Handbook or historical reference"
                  : authority.status === "upcoming"
                    ? " | Upcoming, not yet effective"
                  : ""}
              </small>
              {showCaveat ? (
                <details className={styles.authorityNote}>
                  <summary>Use limit</summary>
                  <p>{authority.caveat}</p>
                </details>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function GateCard({
  gate,
  authorityById,
  sourceIndex,
}: {
  gate: ChinaCustomsDecisionGate;
  authorityById: ReadonlyMap<string, CustomsAuthorityReference>;
  sourceIndex: ReadonlyMap<string, number>;
}) {
  return (
    <li className={styles.gateCard}>
      <details className={styles.gateDisclosure}>
        <summary className={styles.gateHeader}>
          <span className={styles.gateNumber}>
            {String(gate.sequence).padStart(2, "0")}
          </span>
          <span className={styles.gateIdentity}>
            <span className={styles.stage}>{STAGE_LABELS[gate.stage]}</span>
            <strong className={styles.gateTitle}>{gate.title}</strong>
          </span>
          <span
            className={styles.assessment}
            data-state={gate.assessmentState}
          >
            {ASSESSMENT_LABELS[gate.assessmentState]}
          </span>
        </summary>

        <p className={styles.decisionQuestion}>{gate.decisionQuestion}</p>

        <div className={styles.gateBody}>
          <div>
            <span className={styles.fieldLabel}>Required shipment evidence</span>
            <ul>
              {gate.requiredInputs.map((input) => (
                <li key={input}>{input}</li>
              ))}
            </ul>
          </div>
          <div>
            <span className={styles.fieldLabel}>If unresolved</span>
            <p>{gate.unresolvedEffect}</p>
            <div className={styles.effects}>
              {gate.quoteEffects.map((effect) => (
                <span key={effect}>{EFFECT_LABELS[effect]}</span>
              ))}
            </div>
          </div>
          <div>
            <span className={styles.fieldLabel}>Operator action</span>
            <p>{gate.operatorAction}</p>
          </div>
        </div>

        {gate.categoryTriggers.length > 0 ? (
          <details className={styles.triggerDetails}>
            <summary>
              Product-specific triggers
              <span>{gate.categoryTriggers.length}</span>
            </summary>
            <div className={styles.triggerGrid}>
              {gate.categoryTriggers.map((trigger) => (
                <article key={trigger.condition}>
                  <p>{trigger.condition}</p>
                  <span>Evidence to collect</span>
                  <ul>
                    {trigger.requiredEvidence.map((evidence) => (
                      <li key={evidence}>{evidence}</li>
                    ))}
                  </ul>
                  <AuthorityLinks
                    authorityIds={trigger.authorityIds}
                    authorityById={authorityById}
                    sourceIndex={sourceIndex}
                  />
                </article>
              ))}
            </div>
          </details>
        ) : null}

        <div className={styles.authorityBand}>
          <span className={styles.fieldLabel}>Official authority</span>
          <AuthorityLinks
            authorityIds={gate.authorityIds}
            authorityById={authorityById}
            sourceIndex={sourceIndex}
            showCaveat
          />
        </div>
      </details>
    </li>
  );
}

export function ChinaCustomsDecisionGuideSection({
  guide,
  sourceIndex,
}: ChinaCustomsDecisionGuideProps) {
  const authorityById = new Map(
    guide.authorities.map((authority) => [authority.id, authority])
  );
  const alertChanges = guide.ruleChanges
    .filter(
      (change) =>
        change.operatorAlertPriority != null &&
        (change.temporalState === "active" ||
          change.temporalState === "upcoming")
    )
    .sort(
      (left, right) =>
        (left.operatorAlertPriority ?? Number.MAX_SAFE_INTEGER) -
        (right.operatorAlertPriority ?? Number.MAX_SAFE_INTEGER)
    );
  const nextRuleBoundary = guide.ruleChanges
    .flatMap((change) => {
      if (change.temporalState === "upcoming") {
        return [
          {
            date: change.effectiveDate,
            exactAt: change.effectiveAt,
          },
        ];
      }
      if (
        change.temporalState === "active" &&
        change.effectiveTo
      ) {
        return [
          {
            date: change.effectiveTo,
            exactAt: change.effectiveToAt,
          },
        ];
      }
      return [];
    })
    .sort((left, right) => {
      const leftKey = left.exactAt ?? `${left.date}T12:00:00.000Z`;
      const rightKey = right.exactAt ?? `${right.date}T12:00:00.000Z`;
      return Date.parse(leftKey) - Date.parse(rightKey);
    })[0];

  return (
    <section
      className={styles.guide}
      id="customs-guide"
      aria-labelledby="customs-guide-title"
    >
      <header className={styles.guideHeader}>
        <div>
          <span className={styles.sectionNumber}>04</span>
          <p>Customs decision guide</p>
          <h3 id="customs-guide-title">
            What can be quoted, and what is still blocked
          </h3>
        </div>
        <div className={styles.reviewStamp}>
          <span>Revalidate by</span>
          <strong>
            {nextRuleBoundary
              ? nextRuleBoundary.exactAt
                ? formatBoundaryInstant(
                    nextRuleBoundary.exactAt,
                    "America/Los_Angeles"
                  )
                : formatDate(nextRuleBoundary.date)
              : "Before the next quote"}
          </strong>
          {nextRuleBoundary?.exactAt ? (
            <small>
              Official cutoff{" "}
              {formatOfficialEasternBoundary(nextRuleBoundary.exactAt)}
            </small>
          ) : null}
          <small>
            Rules assessed as of {formatDate(guide.rulesAsOf)}
          </small>
          <small>
            Review recorded {formatReviewTimestamp(guide.rulesReviewedAt)}
          </small>
          <small>Separate from the Census data date</small>
        </div>
      </header>

      <p className={styles.guideLead}>
        The corridor data can prioritize research. It cannot determine a
        shipment&apos;s classification, duty, admissibility, or clearance
        status. Review the shipment packet against these eight customs gates.
      </p>

      <div className={styles.readinessGrid} aria-label="Customs quote readiness">
        <article>
          <span>Freight-only quote</span>
          <strong>Needs shipment inputs</strong>
          <p>Route and handling evidence are still required.</p>
        </article>
        <article>
          <span>Landed-cost quote</span>
          <strong>Not assessable</strong>
          <p>Exact HTS, origin, value, entry date, and remedy scope are absent.</p>
        </article>
        <article>
          <span>Clearance promise</span>
          <strong>Not assessable</strong>
          <p>Importer, bond, filing, traceability, and agency evidence are absent.</p>
        </article>
      </div>

      <div className={styles.currentAlerts} aria-labelledby="customs-alerts-title">
        <div>
          <span>Rules as of {formatDate(guide.rulesAsOf)}</span>
          <h4 id="customs-alerts-title">
            {alertChanges.length} dated actions that can change the quote
          </h4>
        </div>
        <div className={styles.alertGrid}>
          {alertChanges.map((change) => (
            <article key={change.id}>
              <span className={styles.ruleRange}>
                <time dateTime={change.effectiveAt ?? change.effectiveDate}>
                  {formatRuleBoundary(change, "start")}
                </time>
                {change.effectiveTo ? (
                  <>
                    <span>
                      {change.effectiveToInclusive ? "through" : "before"}
                    </span>
                    <time
                      dateTime={change.effectiveToAt ?? change.effectiveTo}
                    >
                      {formatRuleBoundary(change, "end")}
                    </time>
                  </>
                ) : null}
              </span>
              <strong>{change.title}</strong>
              <small className={styles.temporalState}>
                {change.temporalState === "upcoming" ? "Upcoming" : "Active"}
              </small>
              <p>{change.operatorEffectAtReview}</p>
              <AuthorityLinks
                authorityIds={change.authorityIds}
                authorityById={authorityById}
                sourceIndex={sourceIndex}
              />
            </article>
          ))}
        </div>
      </div>

      <div className={styles.gateListHeader}>
        <div>
          <span>Eight ordered decision gates</span>
          <h4>Open the gate that blocks the shipment</h4>
        </div>
        <p>
          Each row shows the current assessment. Expand it for required
          evidence, quote effect, operator action, and official authority.
        </p>
      </div>
      <ol className={styles.gateList}>
        {guide.gates.map((gate) => (
          <GateCard
            key={gate.id}
            gate={gate}
            authorityById={authorityById}
            sourceIndex={sourceIndex}
          />
        ))}
      </ol>

      <div className={styles.supportingGrid}>
        <details className={styles.supportingDetails}>
          <summary>
            <span>
              <small>Source review order</small>
              What controls when sources disagree
            </span>
            <strong>{guide.authorityPriority.length} levels</strong>
          </summary>
          <ol className={styles.authorityPriority}>
            {guide.authorityPriority.map((priority) => (
              <li key={priority.rank}>
                <span>{String(priority.rank).padStart(2, "0")}</span>
                <strong>{priority.label}</strong>
                <p>{priority.use}</p>
              </li>
            ))}
          </ol>
        </details>

        <details className={styles.supportingDetails}>
          <summary>
            <span>
              <small>Operating packet</small>
              Handbook to shipment documents
            </span>
            <strong>{guide.documentStages.length} stages</strong>
          </summary>
          <div className={styles.stageList}>
            {guide.documentStages.map((stage) => (
              <article key={stage.stage}>
                <span>{STAGE_LABELS[stage.stage]}</span>
                <h5>{stage.label}</h5>
                <p>{stage.purpose}</p>
                <ul>
                  {stage.documents.map((document) => (
                    <li key={document}>{document}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </details>

        <details className={styles.supportingDetails}>
          <summary>
            <span>
              <small>Dated authority</small>
              What changed over time
            </span>
            <strong>{guide.ruleChanges.length} changes</strong>
          </summary>
          <ol className={styles.timeline}>
            {guide.ruleChanges.map((change) => (
              <li key={change.id}>
                <span className={styles.timelineDate}>
                  <time dateTime={change.effectiveAt ?? change.effectiveDate}>
                    {formatRuleBoundary(change, "start")}
                  </time>
                  {change.effectiveTo ? (
                    <>
                      <small>
                        {change.effectiveToInclusive ? "through" : "before"}
                      </small>
                      <time
                        dateTime={change.effectiveToAt ?? change.effectiveTo}
                      >
                        {formatRuleBoundary(change, "end")}
                      </time>
                    </>
                  ) : null}
                </span>
                <div>
                  <span data-status={change.temporalState}>
                    {change.temporalState === "historical"
                      ? "Historical context"
                      : change.temporalState === "upcoming"
                        ? "Upcoming"
                        : change.temporalState === "expired"
                          ? "Expired"
                          : change.status === "time_limited"
                            ? "Active, time limited"
                            : "Active"}
                  </span>
                  <h5>{change.title}</h5>
                  <p>{change.changedRule}</p>
                  <strong>{change.operatorEffectAtReview}</strong>
                  <AuthorityLinks
                    authorityIds={change.authorityIds}
                    authorityById={authorityById}
                    sourceIndex={sourceIndex}
                  />
                </div>
              </li>
            ))}
          </ol>
        </details>
      </div>

      <footer className={styles.guideFooter}>
        <strong>Research boundary</strong>
        <p>{guide.limitations[0]}</p>
        <p>
          Handbook revision dates, page modification dates, effective dates,
          and Derya review dates are stored separately. A recently modified
          agency page does not make an old handbook a current regulation.
        </p>
      </footer>
    </section>
  );
}
