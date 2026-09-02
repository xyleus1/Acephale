import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { CampaignChatDesk } from "./components/campaign-chat-desk";

export default async function CampaignsPage() {
  const session = await requireSession();
  if (session.accessKind === "customer" || session.role === "EMPLOYEE") {
    redirect("/dashboard/supply-os");
  }

  return <CampaignChatDesk />;
}
