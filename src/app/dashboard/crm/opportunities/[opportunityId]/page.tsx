import { notFound } from "next/navigation";
import {
  CrmActivityTimeline,
  CrmBadge,
  CrmBrainContextPanel,
  CrmEntityHeader,
  CrmNoteForm,
  CrmOpportunityStageForm,
  CrmPriorityBadge,
  CrmStageBadge,
  CrmTaskDirectory,
  CrmTaskForm,
} from "@/components/crm/crm-components";
import { getCrmBrainContext } from "@/lib/crm/brain-context";
import { getCrmOpportunity } from "@/lib/crm/data";
import { getCrmScope } from "@/lib/crm/session";
import { compactMoney, crmLabel } from "@/lib/crm/types";

export default async function CrmOpportunityDetailPage({ params }: { params: Promise<{ opportunityId: string }> }) {
  const scope = await getCrmScope();
  const { opportunityId } = await params;
  const opportunity = await getCrmOpportunity(scope, opportunityId);
  if (!opportunity) notFound();
  const brainContext = await getCrmBrainContext({
    officeId: scope.officeId,
    opportunityId: opportunity.id,
    companyId: opportunity.companyId,
    contactId: opportunity.contactId,
    inquiryId: opportunity.inquiryId,
  });

  return (
    <div className="crm-page">
      <CrmEntityHeader
        eyebrow={crmLabel(opportunity.type)}
        title={opportunity.name}
        subtitle={[opportunity.company.name, opportunity.contact?.fullName, opportunity.inquiry?.subject].filter(Boolean).join(" · ") || "Opportunity"}
        backHref="/dashboard/crm/opportunities"
        backLabel="Opportunities"
        badges={
          <>
            <CrmStageBadge stage={opportunity.stage} />
            <CrmPriorityBadge priority={opportunity.priority} />
            <CrmBadge tone="neutral">{compactMoney(opportunity.estimatedValue, opportunity.currency)}</CrmBadge>
            <CrmBadge tone="info">Internal only</CrmBadge>
          </>
        }
      />
      <div className="crm-detail-shell">
        <aside className="crm-detail-rail">
          <CrmBrainContextPanel context={brainContext} />
          <section className="crm-panel">
            <div className="crm-panel-header"><div><h2>Stage</h2></div></div>
            <CrmOpportunityStageForm opportunity={opportunity} />
          </section>
          <div className="crm-form-stack">
            <CrmTaskForm company={opportunity.company} contact={opportunity.contact} opportunity={opportunity} inquiryId={opportunity.inquiryId} />
            <CrmNoteForm company={opportunity.company} contact={opportunity.contact} opportunity={opportunity} inquiryId={opportunity.inquiryId} />
          </div>
        </aside>
        <main className="crm-detail-grid">
          <section className="crm-panel">
            <div className="crm-panel-header"><div><h2>Linked entities</h2></div></div>
            <div className="crm-list">
              <a href={`/dashboard/crm/companies/${opportunity.company.id}`} className="crm-linked-row">
                <strong>{opportunity.company.name}</strong>
                <span>Company</span>
              </a>
              {opportunity.contact && (
                <a href={`/dashboard/crm/people/${opportunity.contact.id}`} className="crm-linked-row">
                  <strong>{opportunity.contact.fullName}</strong>
                  <span>{opportunity.contact.email ?? "Contact"}</span>
                </a>
              )}
              {opportunity.inquiry && (
                <a href={`/dashboard/rfq/${opportunity.inquiry.id}`} className="crm-linked-row">
                  <strong>{opportunity.inquiry.subject}</strong>
                  <span>{opportunity.inquiry.job ? `Job ${opportunity.inquiry.job.reference}` : "Linked RFQ"}</span>
                </a>
              )}
            </div>
          </section>
          <section className="crm-panel">
            <div className="crm-panel-header"><div><h2>Next action</h2></div></div>
            <p className="crm-detail-copy">{opportunity.nextAction ?? "No next action recorded."}</p>
            <p className="crm-detail-copy muted">{opportunity.notes ?? "No notes yet."}</p>
          </section>
          <section className="crm-panel">
            <div className="crm-panel-header"><div><h2>Follow-ups</h2><span>{opportunity.tasks.length}</span></div></div>
            <CrmTaskDirectory tasks={opportunity.tasks} />
          </section>
          <section className="crm-panel crm-panel-wide">
            <div className="crm-panel-header"><div><h2>Timeline</h2><span>{opportunity.activities.length}</span></div></div>
            <CrmActivityTimeline activities={opportunity.activities} />
          </section>
        </main>
      </div>
    </div>
  );
}
