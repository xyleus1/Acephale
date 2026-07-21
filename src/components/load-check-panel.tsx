"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { analyzeLoadIdeaAction, createRfqFromLoadIdeaAction } from "@/app/dashboard/market/actions";
import type { CheckFinding, LoadCheckResult, LoadIdea } from "@/lib/load-check";
import { COMMODITY_CATEGORIES, securityTierLabel } from "@/lib/security-sop";
import { CARRIER_EQUIPMENT_TYPES } from "@/lib/carrier-vetting";
import { CellInput, CellSelect } from "@/components/sheet-cells";
import { Icon } from "@/components/icon";

const EXAMPLE =
  "e.g. 8 pallets of lithium-ion battery modules from our CM in Fremont, CA to a pilot site in Austin, TX - about $180k, 12,000 lbs, needs to deliver in 2 days, pickup Friday";

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
  const [creating, setCreating] = useState(false);
  const [rev, setRev] = useState(0);
  const router = useRouter();

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
      } catch {
        setError("Could not analyze - check your connection and try again.");
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
          setRev((r) => r + 1); // remount cells back to the last good server state
          return;
        }
        // No rev bump on success: cell keys carry the server value, so only
        // cells whose value actually changed remount - in-progress typing in
        // OTHER cells survives a resolving re-check.
        setFields(res.fields);
        setResult(res.result);
        setNote(null);
      } catch {
        setError("Could not re-check - try again.");
        setRev((r) => r + 1);
      }
    });
  }

  function patch(partial: Partial<LoadIdea>) {
    recheck({ ...(fields ?? EMPTY_FIELDS), ...partial });
  }

  function createRfq() {
    if (!fields || creating) return;
    setCreating(true);
    startTransition(async () => {
      setError(null);
      try {
        const res = await createRfqFromLoadIdeaAction({ idea: fields });
        if ("error" in res) {
          setError(res.error);
          return;
        }
        router.push(`/dashboard/rfq/${res.inquiryId}`);
      } catch {
        setError("Could not create the RFQ - try again.");
      } finally {
        setCreating(false);
      }
    });
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
          <Icon name="zap" size={13} /> Load pre-flight - what breaks, and what to do about it
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
                  key={`cc:${rev}:${fields.commodityCategory ?? ""}`}
                  value={fields.commodityCategory}
                  options={COMMODITY_CATEGORIES}
                  allowEmpty
                  onCommit={(v) => patch({ commodityCategory: v || null })}
                />
              </Field>
              <Field label="Origin">
                <CellInput key={`o:${rev}:${fields.origin ?? ""}`} value={fields.origin} placeholder="City, ST" onCommit={(v) => patch({ origin: v || null })} />
              </Field>
              <Field label="Destination">
                <CellInput key={`d:${rev}:${fields.destination ?? ""}`} value={fields.destination} placeholder="City, ST" onCommit={(v) => patch({ destination: v || null })} />
              </Field>
              <Field label="Declared value (USD)">
                <CellInput key={`v:${rev}:${fields.declaredValue ?? ""}`} value={numText(fields.declaredValue)} placeholder="180000" onCommit={(v) => patch({ declaredValue: v ? Number(v.replace(/[$,\s]/g, "")) || null : null })} />
              </Field>
              <Field label="Weight (lbs)">
                <CellInput key={`w:${rev}:${fields.weightLbs ?? ""}`} value={numText(fields.weightLbs)} placeholder="12000" onCommit={(v) => patch({ weightLbs: v ? Number(v.replace(/[,\s]/g, "")) || null : null })} />
              </Field>
              <Field label="Equipment">
                <CellSelect
                  key={`e:${rev}:${fields.equipmentType ?? ""}`}
                  value={fields.equipmentType}
                  options={CARRIER_EQUIPMENT_TYPES}
                  allowEmpty
                  onCommit={(v) => patch({ equipmentType: v || null })}
                />
              </Field>
              <Field label="Pickup date">
                <CellInput key={`p:${rev}:${fields.pickupDate ?? ""}`} value={fields.pickupDate} placeholder="YYYY-MM-DD" onCommit={(v) => patch({ pickupDate: v || null })} />
              </Field>
              <Field label="Transit promise (days)">
                <CellInput key={`t:${rev}:${fields.transitDays ?? ""}`} value={numText(fields.transitDays)} placeholder="2" onCommit={(v) => patch({ transitDays: v ? Number(v) || null : null })} />
              </Field>
              {fields.inboundInternational && (
                <Field label="Inbound from (country)">
                  <CellInput key={`ic:${rev}:${fields.originCountry ?? ""}`} value={fields.originCountry} placeholder="China" onCommit={(v) => patch({ originCountry: v || null })} />
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

            {(() => {
              const blockers = result.findings.filter((f) => f.severity === "blocker");
              const risks = result.findings.filter((f) => f.severity === "risk");
              const watch = result.findings.filter((f) => f.severity === "watch");
              const verdictColor =
                blockers.length > 0 ? "var(--danger)" : risks.length > 0 ? "var(--warning)" : "var(--success, #2e7d32)";
              const verdict =
                blockers.length > 0
                  ? `NO-GO - clear ${blockers.length} blocker${blockers.length === 1 ? "" : "s"} first`
                  : risks.length > 0
                    ? `GO, with ${risks.length} action${risks.length === 1 ? "" : "s"}`
                    : "GO - nothing breaks";
              const row = (finding: CheckFinding, color: string) => (
                <details
                  key={finding.id}
                  style={{ padding: "8px 12px", borderLeft: `2px solid ${color}` }}
                >
                  <summary style={{ cursor: "pointer", fontSize: 13, lineHeight: 1.5 }}>
                    <strong>{finding.title}</strong>
                    <span style={{ opacity: 0.85 }}> → {finding.action}</span>
                  </summary>
                  <div style={{ fontSize: 12, opacity: 0.65, marginTop: 4, paddingLeft: 2 }}>{finding.detail}</div>
                </details>
              );
              const bench = result.carrierMatch;
              return (
                <>
                  <div
                    className="card"
                    style={{
                      padding: "10px 14px",
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      flexWrap: "wrap",
                      borderLeft: `3px solid ${verdictColor}`,
                    }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{verdict}</span>
                    <span style={{ fontSize: 12, opacity: 0.65 }}>
                      {[
                        result.securityTier && `${securityTierLabel(result.securityTier)} tier`,
                        result.originState &&
                          result.destState &&
                          `${result.originState} → ${result.destState}${result.estimatedMiles != null ? ` · ~${result.estimatedMiles} mi` : ""}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{ marginLeft: "auto" }}
                      disabled={creating || pending}
                      title="Creates an RFQ with these fields; the full report lands in its notes"
                      onClick={createRfq}
                    >
                      <Icon name="mail-in" size={13} /> {creating ? "Creating…" : "Create RFQ"}
                    </button>
                  </div>

                  {result.facts.length > 0 && (
                    <div className="card" style={{ padding: "10px 14px" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, opacity: 0.55, marginBottom: 4 }}>
                        Cited facts - USITC · CBP · FMCSA, live
                      </div>
                      {result.facts.map((line, index) => (
                        <div key={index} style={{ fontSize: 12, padding: "2px 0", lineHeight: 1.5 }}>
                          {line}
                        </div>
                      ))}
                    </div>
                  )}

                  {(blockers.length > 0 || risks.length > 0) && (
                    <div className="card" style={{ padding: "2px 0", display: "flex", flexDirection: "column" }}>
                      {blockers.map((f) => row(f, "var(--danger)"))}
                      {risks.map((f) => row(f, "var(--warning)"))}
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12 }}>
                    <span style={{ opacity: 0.85 }}>
                      <strong>Bench:</strong>{" "}
                      {bench.matched.length > 0 ? (
                        bench.matched.map((c, i) => (
                          <span key={c.id}>
                            {i > 0 && ", "}
                            <Link href={`/dashboard/carriers/${c.id}`} style={{ textDecoration: "underline" }}>
                              {c.name}
                            </Link>
                          </span>
                        ))
                      ) : (
                        <>
                          no approved match ({bench.approvedOnBench} on bench)
                          {bench.requirements.length > 0 && ` - needs ${bench.requirements.map((r) => r.label.toLowerCase()).join(", ")}`}
                          {" · "}
                          <Link href="/dashboard/carriers" style={{ textDecoration: "underline" }}>
                            vet a carrier
                          </Link>
                        </>
                      )}
                    </span>
                    {watch.length > 0 && (
                      <details style={{ marginLeft: "auto" }}>
                        <summary style={{ cursor: "pointer", opacity: 0.55 }}>Watch items ({watch.length})</summary>
                        <div className="card" style={{ marginTop: 6, padding: "2px 0" }}>
                          {watch.map((f) => row(f, "var(--border, rgba(128,128,128,0.4))"))}
                        </div>
                      </details>
                    )}
                  </div>
                </>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
}
