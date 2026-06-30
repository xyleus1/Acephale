"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export function SidebarToggle() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const userPref = localStorage.getItem("sidebar-collapsed");
    // Auto-collapse on the dashboard root (the workbench).
    // Expand on every other route, unless the user explicitly chose otherwise.
    let next: boolean;
    if (pathname === "/dashboard") {
      next = userPref === "false" ? false : true;
    } else {
      next = userPref === "true" ? true : false;
    }
    setCollapsed(next);
    document.documentElement.classList.toggle("sidebar-collapsed", next);
  }, [pathname]);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("sidebar-collapsed", String(next));
    document.documentElement.classList.toggle("sidebar-collapsed", next);
  }

  return (
    <button
      className="sidebar-toggle-btn"
      onClick={toggle}
      title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
    >
      {collapsed ? "›" : "‹"}
    </button>
  );
}
