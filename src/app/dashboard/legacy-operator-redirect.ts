import { redirect } from "next/navigation";
import type { SupplyOsPanel } from "@/lib/supply-os/panel-routing";

export function redirectLegacyOperatorSurface(panel: SupplyOsPanel): never {
  redirect(`/dashboard/supply-os?panel=${panel}`);
}
