import {
  CrmCommandCenter,
  CrmCreateCompanyForm,
  CrmNotice,
  CrmPageHeader,
} from "@/components/crm/crm-components";
import { CrmTabs } from "@/components/crm/crm-tabs";
import { getCrmCommandCenter } from "@/lib/crm/data";
import { getCrmScope } from "@/lib/crm/session";

type SearchParams = Promise<{ notice?: string; error?: string }>;

export default async function CrmHomePage({ searchParams }: { searchParams: SearchParams }) {
  const scope = await getCrmScope();
  const params = await searchParams;
  const data = await getCrmCommandCenter(scope);

  return (
    <div className="crm-page">
      <CrmPageHeader
        title="CRM Command Center"
        subtitle="Founder/operator view of relationships, RFQs, follow-ups, and source-linked brain context."
        actions={<CrmCreateCompanyForm returnTo="/dashboard/crm" />}
      />
      <CrmTabs />
      <CrmNotice notice={params.notice} error={params.error} />
      <CrmCommandCenter data={data} />
    </div>
  );
}
