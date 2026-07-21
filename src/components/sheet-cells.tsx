"use client";

// Inline-editable sheet cells shared by the CRM contact sheet and the RFQ sheet.
// CellInput commits on blur/Enter and cancels on Escape; CellSelect is a
// dropdown that keeps the picked value visible during the save round trip -
// a failed save remounts the cell (key bump) back to the stored value.

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icon";

export function CellInput({
  value,
  placeholder,
  list,
  title,
  onCommit,
}: {
  value: string | null;
  placeholder?: string;
  list?: string;
  title?: string;
  onCommit: (next: string) => void;
}) {
  const cancelled = useRef(false);
  return (
    <input
      className="sheet-input"
      defaultValue={value ?? ""}
      placeholder={placeholder}
      list={list}
      title={title}
      onBlur={(e) => {
        if (cancelled.current) {
          cancelled.current = false;
          e.target.value = value ?? "";
          return;
        }
        const next = e.target.value.trim();
        if (next !== (value ?? "")) onCommit(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export function CellSelect({
  value,
  options,
  allowEmpty,
  allowCreate,
  createLabel,
  onCommit,
}: {
  value: string | null;
  options: ReadonlyArray<readonly [string, string]>;
  allowEmpty?: boolean;
  // Notion-style: offer an "add option" row that commits a brand-new value.
  allowCreate?: boolean;
  createLabel?: string;
  onCommit: (next: string) => void;
}) {
  // Local state so the picked value stays visible during the save round trip;
  // a failed save remounts the cell (key bump) back to the stored value.
  const [local, setLocal] = useState(value ?? "");
  const [menu, setMenu] = useState<{ top: number; left: number; up: boolean } | null>(null);
  const [creating, setCreating] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const items: Array<readonly [string, string]> = allowEmpty ? [["", "-"], ...options] : [...options];
  // Custom values (created on the fly) have no options entry - show them raw.
  const label = options.find(([v]) => v === local)?.[1] ?? (local || "-");
  const hasCustomCurrent = Boolean(local) && !items.some(([v]) => v === local);

  function openMenu() {
    const r = triggerRef.current!.getBoundingClientRect();
    const height = items.length * 30 + 10 + (hasCustomCurrent ? 30 : 0) + (allowCreate ? 36 : 0);
    const up = r.bottom + height > window.innerHeight - 8;
    setMenu({ top: up ? r.top - 4 : r.bottom + 4, left: r.left, up });
  }

  function close(refocus = false) {
    setMenu(null);
    setCreating(false);
    if (refocus) triggerRef.current?.focus();
  }

  function pick(v: string) {
    close(true);
    if (v === local) return;
    setLocal(v);
    onCommit(v);
  }

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !triggerRef.current?.contains(t)) close();
    };
    const onScroll = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu !== null]);

  function onMenuKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      close(true);
      return;
    }
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && (e.target as HTMLElement).tagName !== "INPUT") {
      e.preventDefault();
      const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>(".sheet-select-option") ?? []);
      const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === "ArrowDown" ? Math.min(idx + 1, buttons.length - 1) : Math.max(idx - 1, 0);
      buttons[next]?.focus();
    }
  }

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={`sheet-select-trigger${local ? "" : " sheet-select-empty"}`}
        onClick={() => (menu ? close() : openMenu())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
            if (!menu) {
              e.preventDefault();
              openMenu();
            }
          }
        }}
      >
        <span className="sheet-select-label">{label}</span>
        <Icon name="chevron-down" size={12} strokeWidth={2} />
      </button>
      {menu && (
        <div
          ref={menuRef}
          className="sheet-select-menu"
          role="listbox"
          style={{ top: menu.top, left: menu.left, transform: menu.up ? "translateY(-100%)" : undefined }}
          onKeyDown={onMenuKeyDown}
        >
          {items.map(([v, optionLabel]) => (
            <button
              type="button"
              key={v || "(empty)"}
              className={`sheet-select-option${v === local ? " selected" : ""}`}
              role="option"
              aria-selected={v === local}
              autoFocus={v === local}
              onClick={() => pick(v)}
            >
              <span className="sheet-select-check">{v === local && <Icon name="check" size={12} strokeWidth={2.5} />}</span>
              {optionLabel}
            </button>
          ))}
          {hasCustomCurrent && (
            <button type="button" className="sheet-select-option selected" role="option" aria-selected autoFocus onClick={() => close(true)}>
              <span className="sheet-select-check"><Icon name="check" size={12} strokeWidth={2.5} /></span>
              {local}
            </button>
          )}
          {allowCreate && (
            creating ? (
              <input
                className="sheet-select-create-input"
                placeholder="New option, Enter to save"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  const next = e.currentTarget.value.trim();
                  if (next) pick(next);
                }}
              />
            ) : (
              <button type="button" className="sheet-select-option sheet-select-create" onClick={() => setCreating(true)}>
                <span className="sheet-select-check"><Icon name="plus" size={12} strokeWidth={2.5} /></span>
                {createLabel ?? "Add option…"}
              </button>
            )
          )}
        </div>
      )}
    </>
  );
}
