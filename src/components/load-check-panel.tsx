"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { analyzeLoadIdeaAction } from "@/app/dashboard/market/actions";
import type { CheckFinding, LoadCheckResult, LoadIdea } from "@/lib/load-check";
import { COMMODITY_CATEGORIES, securityTierLabel } from "@/lib/security-sop";
import { CARRIER_EQUIPMENT_TYPES } from "@/lib/carrier-vetting";
import { CellInput, CellSelect } from "@/components/sheet-cells";
import { Icon } from "@/components/icon";

const EXAMPLE =
  "e.g. 8 pallets of lithium-ion battery modules from our CM in Fremont, CA to a pilot site in Austin, TX — about $180k, 12,000 lbs, needs to deliver in 2 days, pickup Friday";

const SEVERITY_META: Record<CheckFinding["severity"], { label: string; border: string }> = {
  blocker: { label: "Blockers — will break", border: "var(--danger)" },
  risk: { label: "Risks — breaks without action", border: "var(--warning)" },
  watch: { label: "Watch", border: "var(--border, rgba(128,128,128,0.4))" },
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, opacity: 0.55 }}>
        {label}
      </span>
      {children}
    </label>
  );
}

const EMPTY_FIELDS: LoadIdea = {
  description: null,
  commodityCategory: null,
  origin: null,
  destination: null,
  declaredValue: null,
  weightLbs: null,
  equipmentType: null,
  temperatureSensitive: false,
  inboundInternational: false,
  originCountry: null,
  exportBound: false,
  defenseOrSpace: false,
  batteriesDamagedOrRecalled: false,
  pickupDate: null,
  transitDays: null,
};

export function LoadCheckPanel() {
  const [text, setText] = useState("");
  const [fields, setFields] = useState<LoadIdea | null>(null);
  const [result, setResult] = useState<LoadCheckResult | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [rev, setRev] = useState(0);

  function runAnalyze() {
    if (!text.trim() || pending) return;
    startTransition(async () => {
      setError(null);
      try {
        const res = await analyzeLoadIdeaAction({ text });
        if ("error" in res) {
          setError(res.error);
          return;
        }
        setFields(res.fields);
        setResult(res.result);
        setNote(res.note);
        setRev((r) => r + 1);
      } catch {
        setError("Could not analyze — check your connection and try again.");
      }
    });
  }

  function recheck(next: LoadIdea) {
    setFields(next);
    startTransition(async () => {
      setError(null);
      try {
        const res = await analyzeLoadIdeaAction({ idea: next });
        if ("error" in res) {
          setError(res.error);
          return;
        }
        setFields(res.fields);
        setResult(res.result);
        setNote(null);
        setRev((r) => r + 1);
      } catch {
        setError("Could not re-check — try again.");
      }
    });
  }

  function patch(partial: Partial<LoadIdea>) {
    recheck({ ...(fields ?? EMPTY_FIELDS), ...partial });
  }

  function chip(label: string, on: boolean, toggle: () => void, title?: string) {
    return (
      <button type="button" className={`mode-tab${on ? " active" : ""}`} title={title} onClick={toggle}>
        {label}
      </button>
    );
  }

  const numText = (v: number | null) => (v == null ? null : String(v));

  return (
    <div className="record-panel" style={{ marginBottom: 16 }}>
      <div className="record-card-header">
        <div className="record-card-title">
          <Icon name="zap" size={13} /> Load pre-flight — what breaks, and what to do about it
        </div>
      </div>
      <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <textarea
            className="sheet-input"
            style={{ flex: 1, minHeight: 56, resize: "vertical", lineHeight: 1.4 }}
            placeholder={EXAMPLE}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) runAnalyze();
            }}
          />
          <button type="button" className="btn btn-sm" disabled={pending || !text.trim()} onClick={runAnalyze}>
            {pending ? "Checking…" : "Analyze"}
          </button>
        </div>
        {(error || note) && (
          <div style={{ fontSize: 12, color: error ? "var(--danger)" : undefined, opacity: error ? 1 : 0.7 }}>
            {error ?? note}
          </div>
        )}

        {fields && result && (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                gap: 10,
              }}
            >
              <Field label="Commodity">
                <CellSelect
                  key={`cc:${rev}`}
                  value={fields.commodityCategory}
                  options={COMMODITY_CATEGORIES}
                  allowEmpty
                  onCommit={(v) => patch({ commodityCategory: v || null })}
                />
              </Field>
              <Field label="Origin">
                <CellInput key={`o:${rev}`} value={fields.origin} placeholder="City, ST" onCommit={(v) => patch({ origin: v || null })} />
              </Field>
              <Field label="Destination">
                <CellInput key={`d:${rev}`} value={fields.destination} placeholder="City, ST" onCommit={(v) => patch({ destination: v || null })} />
              </Field>
              <Field label="Declared value (USD)">
                <CellInput key={`v:${rev}`} value={numText(fields.declaredValue)} placeholder="180000" onCommit={(v) => patch({ declaredValue: v ? Number(v.replace(/[$,\s]/g, "")) || null : null })} />
              </Field>
              <Field label="Weight (lbs)">
                <CellInput key={`w:${rev}`} value={numText(fields.weightLbs)} placeholder="12000" onCommit={(v) => patch({ weightLbs: v ? Number(v.replace(/[,\s]/g, "")) || null : null })} />
              </Field>
              <Field label="Equipment">
                <CellSelect
                  key={`e:${rev}`}
                  value={fields.equipmentType}
                  options={CARRIER_EQUIPMENT_TYPES}
                  allowEmpty
                  onCommit={(v) => patch({ equipmentType: v || null })}
                />
              </Field>
              <Field label="Pickup date">
                <CellInput key={`p:${rev}`} value={fields.pickupDate} placeholder="YYYY-MM-DD" onCommit={(v) => patch({ pickupDate: v || null })} />
              </Field>
              <Field label="Transit promise (days)">
                <CellInput key={`t:${rev}`} value={numText(fields.transitDays)} placeholder="2" onCommit={(v) => patch({ transitDays: v ? Number(v) || null : null })} />
              </Field>
              {fields.inboundInternational && (
                <Field label="Inbound from (country)">
                  <CellInput key={`ic:${rev}`} value={fields.originCountry} placeholder="China" onCommit={(v) => patch({ originCountry: v || null })} />
                </Field>
              )}
            </div>

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {chip("Temp-sensitive", fields.temperatureSensitive, () => patch({ temperatureSensitive: !fields.temperatureSensitive }))}
              {chip("Inbound international", fields.inboundInternational, () => patch({ inboundInternational: !fields.inboundInternational }))}
              {chip("Export-bound", fields.exportBound, () => patch({ exportBound: !fields.exportBound }))}
              {chip("Defense / space", fields.defenseOrSpace, () => patch({ defenseOrSpace: !fields.defenseOrSpace }))}
              {chip("Damaged/recalled batteries", fields.batteriesDamagedOrRecalled, () => patch({ batteriesDamagedOrRecalled: !fields.batteriesDamagedOrRecalled }))}
            </div>

            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, opacity: 0.8 }}>
              {result.securityTier && (
                <span>
                  Security tier: <strong>{securityTierLabel(result.securityTier)}</strong>
                </span>
              )}
              {result.originState && result.destState && (
                <span>
                  Lane: <strong>{result.originState} → {result.destState}</strong>
                  {result.estimatedMiles != null && <span> (~{result.estimatedMiles} mi)</span>}
                </span>
              )}
              <span>
                Findings: <strong>{result.findings.filter((f) => f.severity === "blocker").length}</strong> blocker(s),{" "}
                <strong>{result.findings.filter((f) => f.severity === "risk").length}</strong> risk(s)
              </span>
            </div>

            {(["blocker", "risk", "watch"] as const).map((severity) => {
              const group = result.findings.filter((f) => f.severity === severity);
              if (group.length === 0) return null;
              return (
                <div key={severity}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, opacity: 0.6, marginBottom: 6 }}>
                    {SEVERITY_META[severity].label} ({group.length})
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {group.map((finding) => (
                      <div
                        key={finding.id}
                        className="card"
                        style={{ padding: "10px 12px", borderLeft: `3px solid ${SEVERITY_META[severity].border}` }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{finding.title}</div>
                        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>{finding.detail}</div>
                        <div style={{ fontSize: 12, marginTop: 6 }}>
                          <strong>→ {finding.action}</strong>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

            <div className="card" style={{ padding: "10px 12px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, opacity: 0.6, marginBottom: 6 }}>
                Carrier bench fit
              </div>
              {result.carrierMatch.requirements.length > 0 ? (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                  {result.carrierMatch.requirements.map((req) => (
                    <span key={req.key} className="mode-tab" style={{ cursor: "default" }}>
                      {req.label}
                    </span>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 8 }}>No special carrier requirements detected yet.</div>
              )}
              <div style={{ fontSize: 12 }}>
                {result.carrierMatch.matched.length > 0 ? (
                  <>
                    Matching approved carriers:{" "}
                    {result.carrierMatch.matched.map((c, i) => (
                      <span key={c.id}>
                        {i > 0 && ", "}
                        <Link href={`/dashboard/carriers/${c.id}`} style={{ textDecoration: "underline" }}>
                          {c.name}
                        </Link>
                      </span>
                    ))}
                  </>
                ) : (
                  <>
                    No matching approved carrier ({result.carrierMatch.approvedOnBench} approved on the bench).{" "}
                    <Link href="/dashboard/carriers" style={{ textDecoration: "underline" }}>
                      Open the bench
                    </Link>{" "}
                    to vet one.
                  </>
                )}
              </div>
            </div>

            <div style={{ fontSize: 11, opacity: 0.5 }}>
              Deterministic rules + your live carrier bench; AI only parses the text (edit any field to re-check).
              Decision aid, not legal advice — verify actions with the broker/authority that owns each rule.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
