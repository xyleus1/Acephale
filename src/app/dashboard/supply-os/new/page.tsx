import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";

export const metadata: Metadata = {
  title: "New customer | Supply OS",
  description: "Create a customer supply chain dashboard.",
};

export default async function NewSupplyOsCustomerPage() {
  await requireSession();
  redirect("/dashboard/supply-os");
}
