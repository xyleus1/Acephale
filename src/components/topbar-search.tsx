"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function TopbarSearch({ placeholder }: { placeholder: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = q.trim();
    if (!trimmed) return;
    router.push(`/dashboard/search?q=${encodeURIComponent(trimmed)}`);
  }

  return (
    <form className="topbar-search-form" onSubmit={submit}>
      <span className="topbar-search-icon">⌕</span>
      <input
        className="topbar-search-input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        type="search"
      />
    </form>
  );
}
