"use server";

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { switchOffice } from "@/lib/office-switch";

export async function switchOfficeAction(formData: FormData) {
  const session = await requireSession();
  const targetOfficeId = formData.get("officeId");
  await switchOffice(
    session,
    typeof targetOfficeId === "string" ? targetOfficeId : "",
  );
  redirect("/dashboard/supply-os");
}
