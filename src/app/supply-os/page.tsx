import type { Route } from "next";
import { redirect } from "next/navigation";

export default function SupplyOsPage() {
  redirect("/dashboard/supply-os" as Route);
}
