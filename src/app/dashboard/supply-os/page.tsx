import type { Metadata } from "next";
import { SupplyOsWorkspace } from "./supply-os-workspace";

export const metadata: Metadata = {
  title: "Supply OS",
  description: "Map suppliers, compare routes, and control logistics execution.",
};

export default function SupplyOsPage() {
  return <SupplyOsWorkspace />;
}
