"use client";

import { useEffect } from "react";

const STORAGE_KEY = "derya-theme";

function storeTheme() {
  try {
    window.localStorage?.setItem(STORAGE_KEY, "notebook");
  } catch {
    // Storage can be unavailable in embedded browsers; the live theme switch should still work.
  }
}

function applyTheme() {
  document.documentElement.removeAttribute("data-theme");
}

export function AppearanceToggle() {
  useEffect(() => {
    storeTheme();
    applyTheme();
  }, []);

  function choose() {
    storeTheme();
    applyTheme();
  }

  return (
    <div className="appearance-toggle" role="group" aria-label="Appearance theme">
      <button
        type="button"
        className="active"
        onClick={choose}
        aria-pressed="true"
      >
        Notebook
      </button>
      <span className="appearance-toggle-note">Earth paper</span>
    </div>
  );
}
