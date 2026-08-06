import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { SupplyOsWorkspace } from "./supply-os-workspace";

export const metadata: Metadata = {
  title: "Supply OS",
  description: "Build and save customer supply maps with sourcing, freight, customs, and risk checks.",
};

export default async function SupplyOsPage() {
  const session = await requireSession();
  return <SupplyOsWorkspace storageScope={`${session.officeId}:${session.userId}`} />;
}
