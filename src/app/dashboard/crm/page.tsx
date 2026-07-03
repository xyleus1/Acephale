import {
  CrmCommandCenter,
  CrmCreateCompanyForm,
  CrmPageHeader,
  CrmTabs,
} from "@/components/crm/crm-components";
import { getCrmCommandCenter } from "@/lib/crm/data";
import { getCrmScope } from "@/lib/crm/session";

export default async function CrmHomePage() {
  const scope = await getCrmScope();
  const data = await getCrmCommandCenter(scope);

  return (
    <div className="crm-page">
      <CrmPageHeader
        title="CRM Command Center"
        subtitle="Founder/operator view of relationships, RFQs, follow-ups, and source-linked brain context."
        actions={<CrmCreateCompanyForm />}
      />
      <CrmTabs />
      <CrmCommandCenter data={data} />
    </div>
  );
}
