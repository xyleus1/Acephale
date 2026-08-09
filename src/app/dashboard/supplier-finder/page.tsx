import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { SteelSupplierFinder } from "./steel-supplier-finder";

export const metadata: Metadata = {
  title: "Supplier Finder",
  description: "Evidence-backed supplier discovery for steel-sector trade.",
};

export default async function SupplierFinderPage() {
  const session = await requireSession();
  return <SteelSupplierFinder storageScope={`${session.officeId}:${session.userId}`} />;
}
