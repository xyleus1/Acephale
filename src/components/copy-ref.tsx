"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/icon";

// Click-to-copy RFQ ref (DRY26070001). Used in the sheet's Ref cell, the US
// lead cards and the detail hero - stopPropagation so row-expand clicks
// underneath don't fire.
export function CopyRef({ code, className }: { code: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function copy(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    navigator.clipboard?.writeText(code).then(
      () => {
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  }

  return (
    <button
      type="button"
      className={`copy-ref${copied ? " copy-ref--copied" : ""}${className ? ` ${className}` : ""}`}
      title={copied ? "Copied" : `Copy ${code}`}
      onClick={copy}
    >
      <span className="copy-ref-code">{code}</span>
      <Icon name={copied ? "check" : "copy"} size={11} strokeWidth={2.25} />
    </button>
  );
}
