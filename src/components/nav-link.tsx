"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({
  href,
  icon,
  children
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isActive = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));

  return (
    <Link className={`nav-link${isActive ? " active" : ""}`} href={href as never}>
      <span className="nav-icon">{icon}</span>
      <span className="nav-link-text">{children}</span>
    </Link>
  );
}
