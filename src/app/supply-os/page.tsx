import type { Metadata } from "next";
import { SupplyOsPrototype } from "./supply-os-prototype";

export const metadata: Metadata = {
  title: { absolute: "Derya Supply OS v0.5" },
  description: "A standalone prototype of Derya's supplier intelligence and logistics execution system.",
};

export default function SupplyOsPage() {
  return <SupplyOsPrototype />;
}
