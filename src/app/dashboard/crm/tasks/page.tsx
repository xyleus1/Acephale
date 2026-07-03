import {
  CrmFilterBar,
  CrmNotice,
  CrmPageHeader,
  CrmTaskDirectory,
  CrmTaskForm,
} from "@/components/crm/crm-components";
import { CrmTabs } from "@/components/crm/crm-tabs";
import { listCrmCompanyOptions, listCrmTasks } from "@/lib/crm/data";
import { getCrmScope } from "@/lib/crm/session";
import { CRM_PRIORITIES } from "@/lib/crm/types";

type SearchParams = Promise<{
  q?: string;
  stage?: string;
  priority?: string;
  notice?: string;
  error?: string;
}>;

export default async function CrmTasksPage({ searchParams }: { searchParams: SearchParams }) {
  const scope = await getCrmScope();
  const params = await searchParams;
  const [tasks, companyOptions] = await Promise.all([
    listCrmTasks(scope, params),
    listCrmCompanyOptions(scope),
  ]);

  return (
    <div className="crm-page">
      <CrmPageHeader
        title="Follow-ups"
        subtitle="Internal tasks and promises. This is the safe queue before any external action."
        actions={<CrmTaskForm companies={companyOptions} returnTo="/dashboard/crm/tasks" />}
      />
      <CrmTabs />
      <CrmNotice notice={params.notice} error={params.error} />
      <CrmFilterBar
        basePath="/dashboard/crm/tasks"
        q={params.q}
        selects={[
          { name: "stage", value: params.stage ?? "", allLabel: "Open", options: [["done", "Done"], ["all", "All"]] },
          { name: "priority", value: params.priority ?? "", allLabel: "All priority", options: CRM_PRIORITIES },
        ]}
      />
      <CrmTaskDirectory tasks={tasks} />
    </div>
  );
}
