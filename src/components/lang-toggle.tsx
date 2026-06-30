"use client";
import { useRouter } from "next/navigation";

export function LangToggle({ current }: { current: string }) {
  const router = useRouter();

  function toggle() {
    const next = current === "en" ? "tr" : "en";
    document.cookie = `lang=${next}; path=/; max-age=31536000; SameSite=Lax`;
    router.refresh();
  }

  return (
    <button className="lang-toggle-btn" onClick={toggle} title="Switch language / Dil değiştir">
      {current === "en" ? "TR" : "EN"}
    </button>
  );
}
