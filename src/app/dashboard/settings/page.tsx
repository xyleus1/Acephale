import type { Route } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";

export default async function SettingsPage() {
  const session = await requireSession();
  redirect((session.role === "ADMIN"
    ? "/dashboard/settings/customers"
    : "/dashboard/settings/integrations") as Route);
}
