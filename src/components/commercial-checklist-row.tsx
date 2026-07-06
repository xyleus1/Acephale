import type { ReactNode } from "react";
import type { StrategyCommercialChecklistItem } from "@/lib/commercial-strategy";

export function CommercialChecklistRow({
  item,
  index,
  className,
  actionSlot,
  showStopRule = true,
}: {
  item: StrategyCommercialChecklistItem;
  index: number;
  className: string;
  actionSlot?: ReactNode;
  showStopRule?: boolean;
}) {
  return (
    <div className={`${className} ${item.tone}`}>
      <span>{index + 1}</span>
      <div>
        <strong>{item.label} · {item.owner.toLowerCase()}</strong>
        <em>{item.action}</em>
        <small className="commercial-checklist-why">
          <b>Why:</b>{" "}
          {item.why}
        </small>
        {showStopRule && (
          <small className="commercial-checklist-stop">
            <b>Stop:</b>{" "}
            {item.stopRule}
          </small>
        )}
        {actionSlot}
      </div>
    </div>
  );
}
