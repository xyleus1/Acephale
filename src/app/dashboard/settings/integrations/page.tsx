import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { canReadMailLog } from "@/lib/email-account-policy";
import { IntegrationsSettings } from "./integrations-settings";

export const metadata: Metadata = {
  title: "Integrations",
  description: "Configure client data connections.",
};

export default async function IntegrationsSettingsPage() {
  const session = await requireSession();

  return (
    <IntegrationsSettings
      canConfigure={session.role === "ADMIN"}
      canReadMailLog={canReadMailLog({ role: session.role })}
    />
  );
}
