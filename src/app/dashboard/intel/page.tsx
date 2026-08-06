import { Suspense } from "react";
import { LoadCheckPanel } from "./components/load-check-panel";
import { IntelChatDesk } from "./components/intel-chat-desk";
import { OceanHardwareReportData } from "./components/ocean-hardware-report-data";
import { OceanHardwareReportSkeleton } from "./components/ocean-hardware-report";
import { requireSession } from "@/lib/auth";

type SearchParams = Promise<{
  question?: string | string[];
}>;

export default async function IntelPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireSession();
  const params = await searchParams;
  const questionValue = Array.isArray(params.question)
    ? params.question[0]
    : params.question;
  const initialQuestion = questionValue?.trim().slice(0, 4_000) ?? "";

  return (
    <IntelChatDesk
      key={initialQuestion}
      initialQuestion={initialQuestion}
      report={
        <Suspense fallback={<OceanHardwareReportSkeleton />}>
          <OceanHardwareReportData />
        </Suspense>
      }
      domesticTool={<LoadCheckPanel />}
    />
  );
}
