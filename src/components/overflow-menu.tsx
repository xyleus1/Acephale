import type { ReactNode } from "react";

export function OverflowMenu({
  children,
  label = "More",
  align = "right",
}: {
  children: ReactNode;
  label?: string;
  align?: "left" | "right";
}) {
  return (
    <details className={`overflow-menu overflow-menu-${align}`}>
      <summary>{label}</summary>
      <div className="overflow-menu-panel">{children}</div>
    </details>
  );
}
