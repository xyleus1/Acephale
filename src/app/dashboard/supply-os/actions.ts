"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { switchOffice } from "@/lib/office-switch";

export async function switchOfficeAction(formData: FormData) {
  const session = await requireSession();
  const targetOfficeId = formData.get("officeId");
  const workspaceId = formData.get("workspaceId");
  const result = await switchOffice(
    session,
    typeof targetOfficeId === "string" ? targetOfficeId : "",
  );
  const query = result.ok && typeof workspaceId === "string" && workspaceId.trim()
    ? `?workspace=${encodeURIComponent(workspaceId.trim())}`
    : "";
  redirect(`/dashboard/supply-os${query}` as Route);
}
