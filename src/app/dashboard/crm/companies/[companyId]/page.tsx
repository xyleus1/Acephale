import { notFound } from "next/navigation";
import {
  CrmBadge,
  CrmBrainContextPanel,
  CrmCompanyDetailForms,
  CrmCompanyPanels,
  CrmEntityHeader,
  CrmPriorityBadge,
  CrmSourceBadge,
  CrmStageBadge,
  CrmStrengthBadge,
} from "@/components/crm/crm-components";
import { getCrmBrainContext } from "@/lib/crm/brain-context";
import { getCrmCompany } from "@/lib/crm/data";
import { getCrmScope } from "@/lib/crm/session";
import { crmLabel } from "@/lib/crm/types";

export default async function CrmCompanyDetailPage({ params }: { params: Promise<{ companyId: string }> }) {
  const scope = await getCrmScope();
  const { companyId } = await params;
  const company = await getCrmCompany(scope, companyId);
  if (!company) notFound();
  const brainContext = await getCrmBrainContext({ officeId: scope.officeId, companyId: company.id });

  return (
    <div className="crm-page">
      <CrmEntityHeader
        eyebrow={crmLabel(company.crmCategory)}
        title={company.name}
        subtitle={[company.domain, company.product, company.lane, company.direction].filter(Boolean).join(" · ") || "Relationship profile"}
        backHref="/dashboard/crm/companies"
        backLabel="Companies"
        badges={
          <>
            <CrmStageBadge stage={company.crmStage} />
            <CrmPriorityBadge priority={company.crmPriority} />
            <CrmStrengthBadge strength={company.relationshipStrength} />
            <CrmSourceBadge source={company.crmSource} />
            <CrmBadge tone="neutral">{company.owners.length ? `${company.owners.length} owner${company.owners.length === 1 ? "" : "s"}` : "No owner"}</CrmBadge>
          </>
        }
      />
      <div className="crm-detail-shell">
        <aside className="crm-detail-rail">
          <CrmBrainContextPanel context={brainContext} />
          <CrmCompanyDetailForms company={company} />
        </aside>
        <main>
          <CrmCompanyPanels company={company} />
        </main>
      </div>
    </div>
  );
}
