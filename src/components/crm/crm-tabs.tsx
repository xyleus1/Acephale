"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  ["/dashboard/crm", "Command"],
  ["/dashboard/crm/companies", "Companies"],
  ["/dashboard/crm/people", "People"],
  ["/dashboard/crm/opportunities", "Opportunities"],
  ["/dashboard/crm/tasks", "Follow-ups"],
] as const;

export function CrmTabs() {
  const pathname = usePathname();
  return (
    <div className="crm-tabs">
      {TABS.map(([href, label]) => {
        const active = href === "/dashboard/crm" ? pathname === href : pathname.startsWith(href);
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined}>
            {label}
          </Link>
        );
      })}
    </div>
  );
}
