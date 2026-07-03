import { notFound } from "next/navigation";
import {
  CrmActivityTimeline,
  CrmBadge,
  CrmBrainContextPanel,
  CrmContactEditForm,
  CrmEntityHeader,
  CrmInboxApprovalToggle,
  CrmNoteForm,
  CrmNotice,
  CrmOpportunityForm,
  CrmPriorityBadge,
  CrmStageBadge,
  CrmStrengthBadge,
  CrmTaskForm,
  CrmTaskDirectory,
} from "@/components/crm/crm-components";
import { getCrmBrainContext } from "@/lib/crm/brain-context";
import { getCrmContact } from "@/lib/crm/data";
import { getCrmScope } from "@/lib/crm/session";
import { crmLabel } from "@/lib/crm/types";

export default async function CrmContactDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ contactId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const scope = await getCrmScope();
  const { contactId } = await params;
  const { notice, error } = await searchParams;
  const contact = await getCrmContact(scope, contactId);
  if (!contact) notFound();
  const returnTo = `/dashboard/crm/people/${contact.id}`;
  const brainContext = await getCrmBrainContext({ officeId: scope.officeId, contactId: contact.id, companyId: contact.companyId });

  return (
    <div className="crm-page">
      <CrmEntityHeader
        eyebrow={crmLabel(contact.relationshipType)}
        title={contact.fullName}
        subtitle={[contact.title, contact.email, contact.company.name].filter(Boolean).join(" · ") || "Person record"}
        backHref="/dashboard/crm/people"
        backLabel="People"
        badges={
          <>
            <CrmPriorityBadge priority={contact.leverageLevel} />
            <CrmStrengthBadge strength={contact.relationshipStrength} />
            <CrmBadge tone="neutral">{contact.isApprovedForInbox ? "Approved inbox contact" : "Internal CRM contact"}</CrmBadge>
          </>
        }
      />
      <CrmNotice notice={notice} error={error} />
      <div className="crm-detail-shell">
        <aside className="crm-detail-rail">
          <CrmBrainContextPanel context={brainContext} />
          <div className="crm-form-stack">
            <CrmContactEditForm contact={contact} returnTo={returnTo} />
            <CrmInboxApprovalToggle contact={contact} returnTo={returnTo} />
            <CrmOpportunityForm company={contact.company} contact={contact} returnTo={returnTo} />
            <CrmTaskForm company={contact.company} contact={contact} returnTo={returnTo} />
            <CrmNoteForm company={contact.company} contact={contact} returnTo={returnTo} />
          </div>
        </aside>
        <main className="crm-detail-grid">
          <section className="crm-panel">
            <div className="crm-panel-header"><div><h2>Company</h2></div></div>
            <a href={`/dashboard/crm/companies/${contact.company.id}`} className="crm-linked-row">
              <strong>{contact.company.name}</strong>
              <span>{contact.company.domain ?? "No domain"}</span>
              <CrmStageBadge stage={contact.company.crmStage} />
            </a>
          </section>
          <section className="crm-panel">
            <div className="crm-panel-header"><div><h2>Opportunities</h2><span>{contact.crmOpportunities.length}</span></div></div>
            <div className="crm-list">
              {contact.crmOpportunities.map((opportunity) => (
                <a key={opportunity.id} href={`/dashboard/crm/opportunities/${opportunity.id}`} className="crm-linked-row">
                  <strong>{opportunity.name}</strong>
                  <span>{opportunity.inquiry?.subject ?? opportunity.notes ?? "No linked RFQ"}</span>
                  <CrmStageBadge stage={opportunity.stage} />
                </a>
              ))}
            </div>
          </section>
          <section className="crm-panel">
            <div className="crm-panel-header"><div><h2>Follow-ups</h2><span>{contact.tasks.length}</span></div></div>
            <CrmTaskDirectory tasks={contact.tasks} />
          </section>
          <section className="crm-panel crm-panel-wide">
            <div className="crm-panel-header"><div><h2>Timeline</h2><span>{contact.activities.length}</span></div></div>
            <CrmActivityTimeline activities={contact.activities} />
          </section>
        </main>
      </div>
    </div>
  );
}
