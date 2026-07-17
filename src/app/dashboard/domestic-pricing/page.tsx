import { Suspense } from "react";
import { DomesticTruckingRatePanel } from "@/components/domestic-trucking-rate-panel";
import { Icon } from "@/components/icon";
import { MarketBaseline } from "@/components/market-baseline";
import { requireSession } from "@/lib/auth";
import { assessDomesticTruckingPricing, type DomesticPricingAssessment, type DomesticPricingInquiry, type Money } from "@/lib/domestic-trucking-pricing";
import { prisma } from "@/lib/prisma";
import { openInquiryStatusFilter } from "@/lib/inquiry-status";
import { buildRouteViewport, type RouteMapPoint } from "@/lib/route-map-viewport";

type SearchParams = Promise<{ inquiry?: string }>;

function formatMoney(value: Money | null | undefined) {
  if (!value) return "-";
  return `${value.currency} ${Math.round(value.amount).toLocaleString()}`;
}

function formatPickup(value: string | null | undefined) {
  return value ?? "Missing";
}

function scopeLabel(assessment: DomesticPricingAssessment) {
  if (assessment.eligible) return "US domestic";
  if (assessment.rateRequest.mode && assessment.marketScope === "NON_US") return "Not US lane";
  if (assessment.rateRequest.mode && assessment.marketScope === "UNKNOWN") return "Needs US lane";
  return "Other mode";
}

function bestBuy(assessment: DomesticPricingAssessment) {
  return assessment.rateOptions.reduce<Money | null>((best, option) => {
    if (!best || option.buyPrice.amount < best.amount) return option.buyPrice;
    return best;
  }, null);
}

function routePoint(label: string, lat: number, lon: number): RouteMapPoint {
  return { label, country: "United States", countryCode: "US", lat, lon };
}

function DomesticRouteMap({ assessment }: { assessment: DomesticPricingAssessment }) {
  const origin = assessment.rateRequest.originLocation;
  const destination = assessment.rateRequest.destinationLocation;
  const canMap = origin.lat != null && origin.lon != null && destination.lat != null && destination.lon != null;

  if (!canMap) {
    return (
      <div className="record-panel domestic-route-card">
        <div className="record-card-header">
          <div className="record-card-title">
            <Icon name="activity" size={13} /> Lane map
          </div>
        </div>
        <div className="card-body">
          <div className="domestic-empty-state">
            <strong>Map waiting on US locations</strong>
            <span>Need pickup and delivery as US city/state/ZIP before a domestic truck route map is useful.</span>
          </div>
        </div>
      </div>
    );
  }

  const originLat = origin.lat as number;
  const originLon = origin.lon as number;
  const destinationLat = destination.lat as number;
  const destinationLon = destination.lon as number;
  const points = [
    routePoint(origin.label, originLat, originLon),
    routePoint(destination.label, destinationLat, destinationLon),
  ];
  const viewport = buildRouteViewport("domestic-us-lane", points, {
    minZoom: 3,
    maxZoom: 6,
    maxTiles: 16,
    aspectRatio: 2.35,
    paddingRatio: 0.42,
  });

  return (
    <div className="record-panel domestic-route-card">
      <div className="record-card-header">
        <div className="record-card-title">
          <Icon name="activity" size={13} /> Lane map
        </div>
        <span className="domestic-status-pill">{assessment.marketScope === "US_DOMESTIC" ? "US only" : "blocked"}</span>
      </div>
      <div className="card-body">
        <div className="domestic-route-map" aria-label={`US domestic lane map for ${origin.label} to ${destination.label}`}>
          <div className="domestic-route-map-tiles" aria-hidden="true">
            {viewport.tiles.map((tile) => (
              <img key={tile.key} src={tile.src} alt="" style={tile.style} />
            ))}
          </div>
          <svg className="domestic-route-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <path className="domestic-route-line-shadow" d={viewport.path} />
            <path className="domestic-route-line" d={viewport.path} />
          </svg>
          <div className="domestic-route-marker origin" style={viewport.points[0].markerStyle}>
            <span />
            <strong>{origin.label}</strong>
          </div>
          <div className="domestic-route-marker destination" style={viewport.points[viewport.points.length - 1].markerStyle}>
            <span />
            <strong>{destination.label}</strong>
          </div>
          <div className="domestic-route-map-chip">
            <Icon name="truck" size={14} strokeWidth={2} />
            <span>{assessment.rateRequest.mode ?? "Truck"}</span>
            <strong>{formatMoney(bestBuy(assessment))}</strong>
          </div>
          <div className="domestic-route-map-attribution">© OpenStreetMap contributors</div>
        </div>
      </div>
    </div>
  );
}

function DomesticLoadBoard({
  assessments,
  inquiries,
  selectedInquiryId,
}: {
  assessments: DomesticPricingAssessment[];
  inquiries: DomesticPricingInquiry[];
  selectedInquiryId: string | null;
}) {
  return (
    <div className="record-panel domestic-loadboard-panel">
      <div className="record-card-header">
        <div className="record-card-title">
          <Icon name="list" size={13} /> US domestic loadboard
        </div>
      </div>
      <div className="table-shell domestic-loadboard-shell">
        <table className="data-table domestic-loadboard-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Lane</th>
              <th>Equipment</th>
              <th>Pickup</th>
              <th className="numeric">Weight</th>
              <th className="numeric">Spot</th>
              <th>Blockers</th>
              <th>Open</th>
            </tr>
          </thead>
          <tbody>
            {assessments.map((assessment) => {
              const inquiry = inquiries.find((item) => item.id === assessment.inquiryId);
              const selected = selectedInquiryId === assessment.inquiryId;
              const blockers = assessment.blockers.length;
              return (
                <tr key={assessment.inquiryId} className={selected ? "selected" : ""}>
                  <td>
                    <span className={`domestic-board-status ${assessment.eligible ? "ready" : assessment.rateRequest.mode ? "blocked" : "other"}`}>
                      {scopeLabel(assessment)}
                    </span>
                  </td>
                  <td>
                    <strong>{assessment.rateRequest.origin ?? "Origin missing"}{" -> "}{assessment.rateRequest.destination ?? "Destination missing"}</strong>
                    <span>{inquiry?.company?.name ?? inquiry?.fromCompany ?? inquiry?.fromEmail ?? "Unknown customer"}</span>
                  </td>
                  <td>
                    <strong>{assessment.rateRequest.equipmentType ?? "Missing"}</strong>
                    <span>{assessment.rateRequest.mode ?? inquiry?.mode ?? "-"}</span>
                  </td>
                  <td>{formatPickup(assessment.rateRequest.pickupWindow)}</td>
                  <td className="numeric">{assessment.rateRequest.weightKg ? `${assessment.rateRequest.weightKg.toLocaleString()} kg` : "-"}</td>
                  <td className="numeric"><strong>{formatMoney(bestBuy(assessment))}</strong></td>
                  <td>{blockers > 0 ? `${blockers} blocker${blockers === 1 ? "" : "s"}` : "Ready"}</td>
                  <td>
                    <a href={`/dashboard/domestic-pricing?inquiry=${assessment.inquiryId}`} className="domestic-board-link">
                      View
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function DomesticPricingPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await requireSession();
  const { inquiry: selectedInquiryId } = await searchParams;
  const inquiries = await prisma.inquiry.findMany({
    where: {
      officeId: session.officeId,
      status: openInquiryStatusFilter(),
    },
    include: {
      company: { select: { name: true } },
    },
    orderBy: { receivedAt: "desc" },
    take: 25,
  });

  const assessments = inquiries.map((inquiry) => assessDomesticTruckingPricing(inquiry));
  const selectedAssessment =
    assessments.find((assessment) => assessment.inquiryId === selectedInquiryId)
    ?? assessments.find((assessment) => assessment.marketScope === "US_DOMESTIC")
    ?? assessments.find((assessment) => assessment.rateRequest.mode)
    ?? assessments[0]
    ?? null;
  const selectedInquiry = selectedAssessment
    ? inquiries.find((inquiry) => inquiry.id === selectedAssessment.inquiryId) ?? null
    : null;
  const usCandidateCount = assessments.filter((assessment) => assessment.marketScope === "US_DOMESTIC").length;
  const readyCount = assessments.filter((assessment) => assessment.eligible && assessment.blockers.length === 0).length;
  const blockedCount = assessments.filter((assessment) => assessment.rateRequest.mode && assessment.blockers.length > 0).length;
  const suppressedCount = assessments.filter((assessment) => assessment.rateRequest.mode && assessment.marketScope === "NON_US").length;

  return (
    <div className="domestic-pricing-page">
      <div className="page-hero compact domestic-pricing-hero">
        <div>
          <div className="eyebrow">US trucking wedge</div>
          <h1>Domestic Loadboard</h1>
          <p>America-only truck pricing. Non-US lanes are suppressed, incomplete US lanes show blockers, and rates stay mock/manual until real provider credentials are connected.</p>
        </div>
        <div className="domestic-pricing-summary">
          <div>
            <span>US lanes</span>
            <strong>{usCandidateCount}</strong>
          </div>
          <div>
            <span>Ready</span>
            <strong>{readyCount}</strong>
          </div>
          <div>
            <span>Blocked</span>
            <strong>{blockedCount}</strong>
          </div>
          <div>
            <span>Suppressed</span>
            <strong>{suppressedCount}</strong>
          </div>
        </div>
      </div>

      <Suspense fallback={null}>
        <MarketBaseline />
      </Suspense>

      <DomesticLoadBoard
        assessments={assessments}
        inquiries={inquiries}
        selectedInquiryId={selectedAssessment?.inquiryId ?? null}
      />

      <div className="domestic-pricing-layout">
        <aside className="domestic-pricing-queue">
          <div className="record-card-header">
            <div className="record-card-title">
              <Icon name="list" size={13} /> Recent RFQs
            </div>
          </div>
          <div className="domestic-pricing-queue-list">
            {assessments.length > 0 ? assessments.map((assessment) => {
              const inquiry = inquiries.find((item) => item.id === assessment.inquiryId);
              const selected = selectedAssessment?.inquiryId === assessment.inquiryId;
              return (
                <a
                  key={assessment.inquiryId}
                  href={`/dashboard/domestic-pricing?inquiry=${assessment.inquiryId}`}
                  className={`domestic-pricing-queue-item ${selected ? "selected" : ""} ${assessment.eligible ? "eligible" : "ineligible"}`}
                >
                  <span>{scopeLabel(assessment)}</span>
                  <strong>{inquiry?.subject ?? assessment.inquiryId}</strong>
                  <em>
                    {[
                      inquiry?.company?.name ?? inquiry?.fromCompany ?? inquiry?.fromEmail,
                      inquiry?.origin && inquiry?.destination ? `${inquiry.origin} -> ${inquiry.destination}` : null,
                      assessment.blockers.length > 0 ? `${assessment.blockers.length} blocker${assessment.blockers.length === 1 ? "" : "s"}` : "ready",
                    ].filter(Boolean).join(" / ")}
                  </em>
                </a>
              );
            }) : (
              <div className="domestic-empty-state domestic-pricing-empty">
                <strong>No RFQs found</strong>
                <span>Open RFQs will appear here after email ingestion or manual creation.</span>
              </div>
            )}
          </div>
        </aside>

        <main className="domestic-pricing-main">
          {selectedAssessment && selectedInquiry ? (
            <>
              <div className="domestic-selected-header">
                <div>
                  <span>Selected RFQ</span>
                  <strong>{selectedInquiry.subject}</strong>
                  <em>{selectedInquiry.fromEmail ?? selectedInquiry.fromCompany ?? "Unknown sender"}</em>
                </div>
                <a href={`/dashboard/rfq/${selectedInquiry.id}`} className="btn btn-secondary btn-sm">
                  Open RFQ <Icon name="arrow-right" size={12} />
                </a>
              </div>
              <DomesticRouteMap assessment={selectedAssessment} />
              <div className="record-panel domestic-real-data-panel">
                <div className="record-card-header">
                  <div className="record-card-title">
                    <Icon name="info" size={13} /> Blocking real data
                  </div>
                </div>
                <div className="card-body">
                  <div className="domestic-real-data-grid">
                    {[
                      { title: "US-only lane quality", detail: "Need pickup and delivery as US city/state/ZIP. Country-only USA and international lanes are not rateable." },
                      { title: "Provider contracts", detail: "Truckstop, DAT, or broker/loadboard API credentials are not configured. V1 does not read secrets or call providers." },
                      { title: "Shipment facts", detail: "Equipment, pickup window, commodity, weight, hazmat, temperature, and accessorials must be explicit before a provider request." },
                      { title: "Quote memory", detail: "Recorded quotes, carrier bids, and win/loss outcomes persist office-scoped (RFQ page → Truckload desk) and feed the lane memory. Live provider calls still need their own audit records." },
                    ].map((item) => (
                      <div key={item.title}>
                        <strong>{item.title}</strong>
                        <span>{item.detail}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <DomesticTruckingRatePanel assessment={selectedAssessment} />
            </>
          ) : (
            <div className="record-panel">
              <div className="card-body">
                <div className="domestic-empty-state">
                  <strong>No RFQ selected</strong>
                  <span>Create or ingest an RFQ to evaluate domestic trucking pricing.</span>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
