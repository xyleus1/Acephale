import { redirect } from "next/navigation";

export default function MarketRedirectPage() {
  redirect("/dashboard/supply-os?panel=scenarios");
}
