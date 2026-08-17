import type { Metadata } from "next";
import { ProcurementWorkflow } from "./procurement-workflow";

export const metadata: Metadata = {
  title: { absolute: "Derya" },
};

export default async function WorkflowDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string }>;
}) {
  const { orderId } = await searchParams;
  return <ProcurementWorkflow initialOrderId={orderId ?? null} />;
}
