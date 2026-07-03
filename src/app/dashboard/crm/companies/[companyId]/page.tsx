import { notFound } from "next/navigation";
import {
  CrmBadge,
  CrmBrainContextPanel,
  CrmCompanyDetailForms,
  CrmCompanyPanels,
  CrmEntityHeader,
  CrmNotice,
  CrmPriorityBadge,
  CrmSourceBadge,
  CrmStageBadge,
  CrmStrengthBadge,
} from "@/components/crm/crm-components";
import { getCrmBrainContext } from "@/lib/crm/brain-context";
import { getCrmCompany, listCrmOfficeUsers } from "@/lib/crm/data";
import { getCrmScope } from "@/lib/crm/session";
import { crmLabel } from "@/lib/crm/types";

export default async function CrmCompanyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const scope = await getCrmScope();
  const { companyId } = await params;
  const { notice, error } = await searchParams;
  const company = await getCrmCompany(scope, companyId);
  if (!company) notFound();
  const [brainContext, users] = await Promise.all([
    getCrmBrainContext({ officeId: scope.officeId, companyId: company.id }),
    listCrmOfficeUsers(scope),
  ]);

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
      <CrmNotice notice={notice} error={error} />
      <div className="crm-detail-shell">
        <aside className="crm-detail-rail">
          <CrmBrainContextPanel context={brainContext} />
          <CrmCompanyDetailForms company={company} users={users} returnTo={`/dashboard/crm/companies/${company.id}`} />
        </aside>
        <main>
          <CrmCompanyPanels company={company} />
        </main>
      </div>
    </div>
  );
}
