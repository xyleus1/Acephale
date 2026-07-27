import { Suspense } from "react";
import { LoadCheckPanel } from "./components/load-check-panel";
import { IntelChatDesk } from "./components/intel-chat-desk";
import { OceanHardwareReportData } from "./components/ocean-hardware-report-data";
import { OceanHardwareReportSkeleton } from "./components/ocean-hardware-report";
import { requireSession } from "@/lib/auth";

export default async function IntelPage() {
  await requireSession();

  return (
    <IntelChatDesk
      report={
        <Suspense fallback={<OceanHardwareReportSkeleton />}>
          <OceanHardwareReportData />
        </Suspense>
      }
      domesticTool={<LoadCheckPanel />}
    />
  );
}
