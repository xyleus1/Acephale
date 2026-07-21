"use client";

import { useFormStatus } from "react-dom";

// Drop-in replacement for a form submit <button> that disables itself while
// the server action is pending - prevents double/triple submits on slow
// actions (Vercel cold starts made every unprotected form fire repeatedly).
export function SubmitButton({
  children,
  pendingLabel,
  className = "btn",
  style,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} style={style} disabled={pending} aria-busy={pending}>
      {pending ? (pendingLabel ?? "Working…") : children}
    </button>
  );
}
