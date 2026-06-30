import { DomesticTruckingRatePanel } from "@/components/domestic-trucking-rate-panel";
import { Icon } from "@/components/icon";
import { requireSession } from "@/lib/auth";
import { assessDomesticTruckingPricing } from "@/lib/domestic-trucking-pricing";
import { prisma } from "@/lib/prisma";

type SearchParams = Promise<{ inquiry?: string }>;

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
      status: { in: ["INGESTED", "PARSED", "PRICED", "NEEDS_INFO"] },
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
    ?? assessments.find((assessment) => assessment.eligible)
    ?? assessments[0]
    ?? null;
  const selectedInquiry = selectedAssessment
    ? inquiries.find((inquiry) => inquiry.id === selectedAssessment.inquiryId) ?? null
    : null;
  const eligibleCount = assessments.filter((assessment) => assessment.eligible).length;
  const readyCount = assessments.filter((assessment) => assessment.eligible && assessment.blockers.length === 0).length;
  const blockedCount = assessments.filter((assessment) => assessment.eligible && assessment.blockers.length > 0).length;

  return (
    <div className="domestic-pricing-page">
      <div className="page-hero compact domestic-pricing-hero">
        <div>
          <div className="eyebrow">Pricing wedge</div>
          <h1>Domestic Rates</h1>
          <p>Instant domestic trucking pricing, constrained to draft-only mock/manual rates until provider credentials and approval flows are real.</p>
        </div>
        <div className="domestic-pricing-summary">
          <div>
            <span>Eligible</span>
            <strong>{eligibleCount}</strong>
          </div>
          <div>
            <span>Ready</span>
            <strong>{readyCount}</strong>
          </div>
          <div>
            <span>Blocked</span>
            <strong>{blockedCount}</strong>
          </div>
        </div>
      </div>

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
                  <span>{assessment.eligible ? "Domestic" : "Other mode"}</span>
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
