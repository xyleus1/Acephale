"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ResearchField } from "@/lib/research-lists";
import styles from "./research.module.css";

export function ResearchImportPanel({ slug, fields }: { slug: string; fields: ResearchField[] }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [dedupeField, setDedupeField] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Array<{ row: number; error: string }>>([]);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setMessage(null);
    setErrors([]);
    try {
      const response = await fetch(`/api/research/${encodeURIComponent(slug)}/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, dedupeField: dedupeField || undefined }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Import failed.");
      setMessage(`Created ${result.created}, updated ${result.updated}, skipped ${result.skipped}.`);
      setErrors(result.errors ?? []);
      setText("");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.importPanel}>
      <div className={styles.sectionHeader}>
        <h2>Import records</h2>
        <span className={styles.meta}>CSV, JSON, or JSONL</span>
      </div>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Paste CSV or JSON"
        rows={7}
      />
      <div className={styles.importControls}>
        <label>
          <span>Dedupe column</span>
          <select
            value={dedupeField}
            onChange={(event) => setDedupeField(event.target.value)}
          >
            <option value="">None</option>
            {fields.map((field) => (
              <option key={field.key} value={field.key}>
                {field.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={submit}
          disabled={busy || !text.trim()}
        >
          {busy ? "Importing..." : "Import"}
        </button>
      </div>
      {message ? <p className={styles.importMessage}>{message}</p> : null}
      {errors.length ? (
        <ul className={styles.errors}>
          {errors.slice(0, 5).map((item) => (
            <li key={`${item.row}-${item.error}`}>
              Row {item.row}: {item.error}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
