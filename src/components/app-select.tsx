"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./app-select.module.css";

type AppSelectOption<T extends string> = {
  value: T;
  label: string;
  hint?: string;
};

export function AppSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  size = "md",
  className,
}: {
  value: T;
  options: Array<AppSelectOption<T>>;
  onChange: (value: T) => void;
  ariaLabel: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<T>(value);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function moveSelection(direction: 1 | -1) {
    if (!options.length) return;
    const index = Math.max(0, options.findIndex((option) => option.value === active));
    const next = options[Math.min(options.length - 1, Math.max(0, index + direction))];
    if (next) setActive(next.value);
  }

  function selectOption(next: T) {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div className={`${styles.root} ${styles[size]}${className ? ` ${className}` : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => {
          setActive(value);
          setOpen((current) => !current);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            if (!open) {
              setActive(value);
              setOpen(true);
            }
            else moveSelection(1);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) {
              setActive(value);
              setOpen(true);
            }
            else moveSelection(-1);
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (open) selectOption(active);
            else {
              setActive(value);
              setOpen(true);
            }
          }
        }}
      >
        <span>{selected?.label ?? ""}</span>
        <span className={styles.chevron} aria-hidden="true">⌄</span>
      </button>
      {open ? (
        <div ref={menuRef} className={styles.menu} role="listbox" aria-label={ariaLabel}>
          {options.map((option) => (
            <button
              type="button"
              key={option.value}
              className={`${styles.option}${option.value === value ? ` ${styles.selected}` : ""}`}
              role="option"
              aria-selected={option.value === value}
              data-active={option.value === active}
              onMouseEnter={() => setActive(option.value)}
              onClick={() => selectOption(option.value)}
            >
              <span>
                <strong>{option.label}</strong>
                {option.hint ? <small>{option.hint}</small> : null}
              </span>
              {option.value === value ? <span aria-hidden="true">✓</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
