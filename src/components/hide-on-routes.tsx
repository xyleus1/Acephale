"use client";

import { usePathname } from "next/navigation";

// Renders nothing when the current route starts with one of the prefixes.
export function HideOnRoutes({ prefixes, children }: { prefixes: string[]; children: React.ReactNode }) {
  const pathname = usePathname();
  if (prefixes.some((prefix) => pathname.startsWith(prefix))) return null;
  return <>{children}</>;
}
