import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { supplyOptimizationWorkspace } from "@/lib/supply-os-optimization-engine";
import { SupplyOsWorkstreamShell } from "../../supply-os-workstream-shell";

export const metadata: Metadata = {
  title: "Supply OS workstream",
  description: "Open a customer supply-chain workstream.",
};

export default async function SupplyOsWorkstreamPage({
  params,
  searchParams,
}: {
  params: Promise<{ workstream: string }>;
  searchParams: Promise<{ case?: string }>;
}) {
  const session = await requireSession();
  const { workstream: workstreamId } = await params;
  const { case: caseId } = await searchParams;
  const workstream = supplyOptimizationWorkspace(workstreamId);
  if (!workstream) notFound();

  return (
    <SupplyOsWorkstreamShell
      storageScope={`${session.officeId}:${session.userId}`}
      workstream={workstream}
      caseId={caseId}
    />
  );
}
