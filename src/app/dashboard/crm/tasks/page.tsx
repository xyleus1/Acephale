import {
  CrmFilterBar,
  CrmPageHeader,
  CrmTabs,
  CrmTaskDirectory,
} from "@/components/crm/crm-components";
import { listCrmTasks } from "@/lib/crm/data";
import { getCrmScope } from "@/lib/crm/session";

type SearchParams = Promise<{
  q?: string;
  stage?: string;
  priority?: string;
}>;

export default async function CrmTasksPage({ searchParams }: { searchParams: SearchParams }) {
  const scope = await getCrmScope();
  const params = await searchParams;
  const tasks = await listCrmTasks(scope, params);

  return (
    <div className="crm-page">
      <CrmPageHeader
        title="Follow-ups"
        subtitle="Internal tasks and promises. This is the safe queue before any external action."
      />
      <CrmTabs />
      <CrmFilterBar basePath="/dashboard/crm/tasks" q={params.q} stage={params.stage ?? ""} priority={params.priority ?? ""} />
      <CrmTaskDirectory tasks={tasks} />
    </div>
  );
}
