import { Icon } from "@/components/icon";
import type { DomesticPricingAssessment, DomesticRateOption, Money, RequiredRateField } from "@/lib/domestic-trucking-pricing";

function formatMoney(value: Money | null | undefined) {
  if (!value) return "-";
  return `${value.currency} ${Math.round(value.amount).toLocaleString()}`;
}

function fieldTone(field: RequiredRateField) {
  if (field.status === "missing") return "danger";
  if (field.status === "advisory" || field.status === "assumed") return "review";
  return "ready";
}

function RateOptionsTable({ options }: { options: DomesticRateOption[] }) {
  if (options.length === 0) {
    return (
      <div className="domestic-empty-state">
        <strong>No rate returned yet</strong>
        <span>Complete the blocking fields before the mock/manual adapters produce a draftable benchmark.</span>
      </div>
    );
  }

  return (
    <div className="table-shell domestic-rate-table-shell">
      <table className="data-table domestic-rate-table">
        <thead>
          <tr>
            <th>Provider</th>
            <th>Service</th>
            <th className="numeric">Buy</th>
            <th>Transit</th>
            <th>Validity</th>
            <th>Confidence</th>
          </tr>
        </thead>
        <tbody>
          {options.map((option) => (
            <tr key={option.id}>
              <td>
                <strong>{option.providerName}</strong>
                <span>{option.providerQuoteId}</span>
              </td>
              <td>
                <strong>{option.serviceLevel}</strong>
                <span>{option.mode} / {option.equipmentType}</span>
              </td>
              <td className="numeric"><strong>{formatMoney(option.buyPrice)}</strong></td>
              <td>{option.transitDays ? `${option.transitDays}d` : "-"}</td>
              <td>{option.validUntil}</td>
              <td>
                <span className="domestic-status-pill">{option.confidence}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DomesticTruckingRatePanel({
  assessment,
  compact = false,
}: {
  assessment: DomesticPricingAssessment;
  compact?: boolean;
}) {
  const request = assessment.rateRequest;
  const quoteDraft = assessment.quoteDraft;
  const visibleMissing = compact ? assessment.missingRequiredFields.slice(0, 6) : assessment.missingRequiredFields;
  const hiddenMissingCount = assessment.missingRequiredFields.length - visibleMissing.length;

  return (
    <div className="record-panel domestic-rate-panel">
      <div className="record-card-header domestic-rate-header">
        <div className="record-card-title">
          <Icon name="truck" size={13} /> Domestic trucking rates
        </div>
        <a href={`/dashboard/domestic-pricing?inquiry=${assessment.inquiryId}`} className="btn btn-secondary btn-sm">
          Check domestic trucking rates <Icon name="arrow-right" size={12} />
        </a>
      </div>

      <div className="card-body domestic-rate-body">
        <div className={`domestic-rate-state ${assessment.eligible ? "ready" : "blocked"}`}>
          <div>
            <strong>{assessment.eligibilityLabel}</strong>
            <span>{assessment.eligibilityReasons.join(" ")}</span>
          </div>
          <span>{assessment.rateOptions.length} options</span>
        </div>

        <div className="domestic-rate-badges">
          {assessment.approvalWarnings.map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
        </div>

        <div className="domestic-rate-request-grid">
          {[
            { label: "Route", value: [request.origin, request.destination].filter(Boolean).join(" -> ") || "Missing route" },
            { label: "Mode", value: request.mode ?? "Missing" },
            { label: "Equipment", value: request.equipmentType ?? "Missing" },
            { label: "Pickup", value: request.pickupWindow ?? "Missing" },
            { label: "Cargo", value: request.commodity ?? "Missing" },
            { label: "Weight", value: request.weightKg ? `${request.weightKg.toLocaleString()} kg` : "Missing" },
          ].map((item) => (
            <div key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>

        {assessment.missingRequiredFields.length > 0 ? (
          <div className="domestic-field-block">
            <div className="domestic-section-title">Blocking fields</div>
            <div className="record-chip-row">
              {visibleMissing.map((field) => (
                <span key={field.key} className={`record-chip ${fieldTone(field)}`}>{field.label}</span>
              ))}
              {hiddenMissingCount > 0 && <span className="record-chip">+{hiddenMissingCount} more</span>}
            </div>
          </div>
        ) : (
          <div className="domestic-field-block">
            <div className="domestic-section-title">Provider request</div>
            <div className="record-helper-text">All blocking V1 provider fields are explicit.</div>
          </div>
        )}

        {!compact && (
          <div className="domestic-field-block">
            <div className="domestic-section-title">Required-field audit</div>
            <div className="domestic-field-grid">
              {assessment.requiredFields.map((field) => (
                <div key={field.key} className={`domestic-field-row ${fieldTone(field)}`}>
                  <strong>{field.label}</strong>
                  <span>{field.detail}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="domestic-field-block">
          <div className="domestic-section-title">Provider readiness</div>
          <div className="domestic-provider-grid">
            {assessment.providerCredentialStatuses.map((provider) => (
              <div key={provider.providerCode} className={`domestic-provider-card ${provider.configured ? "ready" : "review"}`}>
                <strong>{provider.displayName}</strong>
                <span>{provider.credentialState}</span>
                <em>{provider.notes}</em>
              </div>
            ))}
          </div>
        </div>

        <div className="domestic-field-block">
          <div className="domestic-section-title">Rate options</div>
          <RateOptionsTable options={assessment.rateOptions} />
        </div>

        <div className={`domestic-quote-draft ${quoteDraft.status === "DRAFT_ONLY" ? "ready" : "blocked"}`}>
          <div className="domestic-section-title">Quote draft</div>
          {quoteDraft.status === "DRAFT_ONLY" ? (
            <>
              <div className="domestic-draft-economics">
                <div><span>Buy</span><strong>{formatMoney(quoteDraft.buyPrice)}</strong></div>
                <div><span>Sell</span><strong>{formatMoney(quoteDraft.sellPrice)}</strong></div>
                <div><span>Gross profit</span><strong>{formatMoney(quoteDraft.expectedGrossProfit)}</strong></div>
                <div><span>Margin</span><strong>{quoteDraft.expectedMarginPct ?? "-"}%</strong></div>
              </div>
              {!compact && quoteDraft.body && (
                <pre className="domestic-draft-body">{quoteDraft.body}</pre>
              )}
            </>
          ) : (
            <div className="domestic-empty-state">
              <strong>Draft blocked</strong>
              <span>{quoteDraft.blockers[0] ?? "Complete required fields first."}</span>
            </div>
          )}
        </div>

        {!compact && (
          <div className="domestic-field-block">
            <div className="domestic-section-title">Brain context</div>
            <div className="domestic-brain-grid">
              {assessment.brainContext.sections.map((section) => (
                <div key={section.key} className="domestic-brain-card">
                  <strong>{section.label}</strong>
                  <span>{section.summary}</span>
                  <em>{section.sourceSlugs.join(" / ")}</em>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
