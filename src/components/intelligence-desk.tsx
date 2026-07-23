"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { analyzeLoadIdeaAction, createRfqFromLoadIdeaAction } from "@/app/dashboard/market/actions";
import type { CheckFinding, LoadCheckResult, LoadIdea } from "@/lib/load-check";
import { COMMODITY_CATEGORIES, securityTierLabel } from "@/lib/security-sop";
import { CARRIER_EQUIPMENT_TYPES } from "@/lib/carrier-vetting";
import { CellInput, CellSelect } from "@/components/sheet-cells";
import { Icon } from "@/components/icon";

// One analyzed load idea in the conversation. Only the newest entry stays
// interactive (refine fields, create the RFQ); older ones are scrollback.
type Entry = {
  id: number;
  query: string;
  fields: LoadIdea;
  result: LoadCheckResult;
  note: string | null;
};

const SUGGESTIONS: { icon: Parameters<typeof Icon>[0]["name"]; label: string; prompt: string }[] = [
  {
    icon: "zap",
    label: "Battery modules · Fremont to Austin",
    prompt:
      "8 pallets of lithium-ion battery modules from our CM in Fremont, CA to a pilot site in Austin, TX, about $180k declared, 12,000 lbs, needs to deliver in 2 days, pickup Friday",
  },
  {
    icon: "layers",
    label: "Rack servers · San Jose to Ashburn",
    prompt:
      "Two crates of rack servers from San Jose, CA to a data center in Ashburn, VA, $450k declared, 6,000 lbs, liftgate at delivery, deliver by Monday",
  },
  {
    icon: "activity",
    label: "Cold-chain biotech · SSF to San Diego",
    prompt:
      "Temperature-controlled biotech reagents from South San Francisco, CA to a lab in San Diego, CA, $90k declared, 2 pallets, keep 2-8C, pickup tomorrow",
  },
  {
    icon: "plane",
    label: "Satellite optics · El Segundo to Canaveral",
    prompt:
      "Crated satellite optical assembly from El Segundo, CA to Cape Canaveral, FL, $2.4M declared, 3,500 lbs, air-ride van, dock date in 10 days",
  },
];

function FieldLabel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="intel-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function IntelligenceDesk({ baseline }: { baseline?: ReactNode }) {
  const [text, setText] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [rev, setRev] = useState(0);
  const seq = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();

  const hasThread = entries.length > 0 || pendingQuery != null;

  useEffect(() => {
    if (hasThread) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [entries.length, pendingQuery, hasThread]);

  function autosize() {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  function resetInput() {
    setText("");
    const el = inputRef.current;
    if (el) el.style.height = "auto";
  }

  function runAnalyze(source?: string) {
    const query = (source ?? text).trim();
    if (!query || pending) return;
    setError(null);
    setPendingQuery(query);
    resetInput();
    startTransition(async () => {
      try {
        const res = await analyzeLoadIdeaAction({ text: query });
        if ("error" in res) {
          setError(res.error);
          setText(query);
          setPendingQuery(null);
          return;
        }
        seq.current += 1;
        setEntries((prev) => [
          ...prev,
          { id: seq.current, query, fields: res.fields, result: res.result, note: res.note },
        ]);
        setPendingQuery(null);
      } catch {
        setError("Could not analyze. Check your connection and try again.");
        setText(query);
        setPendingQuery(null);
      }
    });
  }

  // Deterministic re-run after a manual field edit; applies to the newest entry.
  function recheck(next: LoadIdea) {
    setEntries((prev) => prev.map((entry, i) => (i === prev.length - 1 ? { ...entry, fields: next } : entry)));
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
        setEntries((prev) =>
          prev.map((entry, i) =>
            i === prev.length - 1 ? { ...entry, fields: res.fields, result: res.result, note: null } : entry,
          ),
        );
      } catch {
        setError("Could not re-check. Try again.");
        setRev((r) => r + 1);
      }
    });
  }

  function createRfq(fields: LoadIdea) {
    if (creating) return;
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
        setError("Could not create the RFQ. Try again.");
      } finally {
        setCreating(false);
      }
    });
  }

  function toggle(fields: LoadIdea, label: string, key: keyof LoadIdea, title?: string) {
    const on = Boolean(fields[key]);
    return (
      <button
        type="button"
        className={`mode-tab${on ? " active" : ""}`}
        title={title}
        onClick={() => recheck({ ...fields, [key]: !on })}
      >
        {label}
      </button>
    );
  }

  const numText = (v: number | null) => (v == null ? null : String(v));

  function findingRow(finding: CheckFinding, tone: "danger" | "warn" | "watch") {
    return (
      <details key={finding.id} className="intel-finding">
        <summary>
          <span className={`intel-finding-dot intel-finding-dot--${tone}`} />
          <span className="intel-finding-text">
            <strong>{finding.title}</strong>
            <span className="intel-finding-action"> → {finding.action}</span>
          </span>
          <Icon name="chevron-down" size={14} className="intel-finding-caret" />
        </summary>
        <div className="intel-finding-detail">{finding.detail}</div>
      </details>
    );
  }

  function answerBlock(entry: Entry, interactive: boolean) {
    const { fields, result } = entry;
    const blockers = result.findings.filter((f) => f.severity === "blocker");
    const risks = result.findings.filter((f) => f.severity === "risk");
    const watch = result.findings.filter((f) => f.severity === "watch");
    const tone = blockers.length > 0 ? "danger" : risks.length > 0 ? "warn" : "ok";
    const verdict =
      blockers.length > 0
        ? `NO-GO: clear ${blockers.length} blocker${blockers.length === 1 ? "" : "s"} first`
        : risks.length > 0
          ? `GO, with ${risks.length} action${risks.length === 1 ? "" : "s"}`
          : "GO, nothing breaks";
    const bench = result.carrierMatch;
    const route =
      result.originState && result.destState
        ? `${result.originState} → ${result.destState}${result.estimatedMiles != null ? ` · ~${result.estimatedMiles} mi` : ""}`
        : null;

    return (
      <div key={entry.id} className="intel-exchange">
        <div className="intel-msg-user">{entry.query}</div>

        <div className={`intel-answer${interactive && pending && !pendingQuery ? " is-busy" : ""}`}>
          <div className="intel-avatar">
            <Icon name="sparkles" size={15} />
          </div>
          <div className="intel-answer-body">
            <div className="intel-answer-head">
              <strong>Pre-flight</strong>
              {entry.note && <span>{entry.note}</span>}
            </div>

            <div className={`intel-verdict intel-verdict--${tone}`}>
              <span className="intel-verdict-icon">
                <Icon name={tone === "ok" ? "check" : tone === "warn" ? "alert" : "x"} size={15} />
              </span>
              <span className="intel-verdict-title">{verdict}</span>
              <span className="intel-verdict-meta">
                {result.securityTier && <span className="intel-pill">{securityTierLabel(result.securityTier)} tier</span>}
                {route && <span className="intel-pill">{route}</span>}
              </span>
            </div>

            {(blockers.length > 0 || risks.length > 0) && (
              <div className="intel-findings">
                {blockers.map((f) => findingRow(f, "danger"))}
                {risks.map((f) => findingRow(f, "warn"))}
              </div>
            )}

            {result.facts.length > 0 && (
              <div className="intel-facts">
                <div className="intel-facts-label">Cited facts · USITC · CBP · FMCSA, live</div>
                {result.facts.map((line, index) => (
                  <div key={index}>{line}</div>
                ))}
              </div>
            )}

            <div className="intel-bench">
              <span className="intel-bench-label">Bench</span>
              {bench.matched.length > 0 ? (
                bench.matched.map((c) => (
                  <Link key={c.id} href={`/dashboard/carriers/${c.id}`} className="intel-bench-chip">
                    <Icon name="truck" size={12} /> {c.name}
                  </Link>
                ))
              ) : (
                <>
                  <span className="intel-bench-none">
                    no approved match ({bench.approvedOnBench} on bench)
                    {bench.requirements.length > 0 &&
                      `, needs ${bench.requirements.map((r) => r.label.toLowerCase()).join(", ")}`}
                  </span>
                  <Link href="/dashboard/carriers" className="intel-bench-chip">
                    <Icon name="shield" size={12} /> Vet a carrier
                  </Link>
                </>
              )}
              {watch.length > 0 && (
                <details className="intel-watch">
                  <summary>Watch items ({watch.length})</summary>
                  <div className="intel-findings">{watch.map((f) => findingRow(f, "watch"))}</div>
                </details>
              )}
            </div>

            {interactive && (
              <>
                <details className="intel-refine">
                  <summary>
                    <Icon name="sliders" size={13} /> Refine details
                  </summary>
                  <div className="intel-refine-panel">
                    <div className="intel-refine-grid">
                      <FieldLabel label="Commodity">
                        <CellSelect
                          key={`cc:${rev}:${fields.commodityCategory ?? ""}`}
                          value={fields.commodityCategory}
                          options={COMMODITY_CATEGORIES}
                          allowEmpty
                          onCommit={(v) => recheck({ ...fields, commodityCategory: v || null })}
                        />
                      </FieldLabel>
                      <FieldLabel label="Origin">
                        <CellInput key={`o:${rev}:${fields.origin ?? ""}`} value={fields.origin} placeholder="City, ST" onCommit={(v) => recheck({ ...fields, origin: v || null })} />
                      </FieldLabel>
                      <FieldLabel label="Destination">
                        <CellInput key={`d:${rev}:${fields.destination ?? ""}`} value={fields.destination} placeholder="City, ST" onCommit={(v) => recheck({ ...fields, destination: v || null })} />
                      </FieldLabel>
                      <FieldLabel label="Declared value (USD)">
                        <CellInput key={`v:${rev}:${fields.declaredValue ?? ""}`} value={numText(fields.declaredValue)} placeholder="180000" onCommit={(v) => recheck({ ...fields, declaredValue: v ? Number(v.replace(/[$,\s]/g, "")) || null : null })} />
                      </FieldLabel>
                      <FieldLabel label="Weight (lbs)">
                        <CellInput key={`w:${rev}:${fields.weightLbs ?? ""}`} value={numText(fields.weightLbs)} placeholder="12000" onCommit={(v) => recheck({ ...fields, weightLbs: v ? Number(v.replace(/[,\s]/g, "")) || null : null })} />
                      </FieldLabel>
                      <FieldLabel label="Equipment">
                        <CellSelect
                          key={`e:${rev}:${fields.equipmentType ?? ""}`}
                          value={fields.equipmentType}
                          options={CARRIER_EQUIPMENT_TYPES}
                          allowEmpty
                          onCommit={(v) => recheck({ ...fields, equipmentType: v || null })}
                        />
                      </FieldLabel>
                      <FieldLabel label="Pickup date">
                        <CellInput key={`p:${rev}:${fields.pickupDate ?? ""}`} value={fields.pickupDate} placeholder="YYYY-MM-DD" onCommit={(v) => recheck({ ...fields, pickupDate: v || null })} />
                      </FieldLabel>
                      <FieldLabel label="Transit promise (days)">
                        <CellInput key={`t:${rev}:${fields.transitDays ?? ""}`} value={numText(fields.transitDays)} placeholder="2" onCommit={(v) => recheck({ ...fields, transitDays: v ? Number(v) || null : null })} />
                      </FieldLabel>
                      {fields.inboundInternational && (
                        <FieldLabel label="Inbound from (country)">
                          <CellInput key={`ic:${rev}:${fields.originCountry ?? ""}`} value={fields.originCountry} placeholder="China" onCommit={(v) => recheck({ ...fields, originCountry: v || null })} />
                        </FieldLabel>
                      )}
                    </div>
                    <div className="intel-toggles">
                      {toggle(fields, "Temp-sensitive", "temperatureSensitive")}
                      {toggle(fields, "Inbound international", "inboundInternational")}
                      {toggle(fields, "Export-bound", "exportBound")}
                      {toggle(fields, "Defense / space", "defenseOrSpace")}
                      {toggle(fields, "Damaged/recalled batteries", "batteriesDamagedOrRecalled")}
                    </div>
                  </div>
                </details>

                <div className="intel-actions">
                  <button
                    type="button"
                    className="intel-cta"
                    disabled={creating || pending}
                    title="Creates an RFQ with these fields; the full report lands in its notes"
                    onClick={() => createRfq(fields)}
                  >
                    {creating ? <span className="intel-spin" /> : <Icon name="mail-in" size={14} />}
                    {creating ? "Creating…" : "Create RFQ"}
                  </button>
                  <span className="intel-actions-hint">Edits above re-run the check instantly.</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`intel-stage${hasThread ? " has-thread" : " is-empty"}`}>
      {hasThread && (
        <div className="intel-thread">
          {entries.map((entry, i) => answerBlock(entry, i === entries.length - 1))}
          {pendingQuery && (
            <div className="intel-exchange">
              <div className="intel-msg-user">{pendingQuery}</div>
              <div className="intel-answer">
                <div className="intel-avatar">
                  <Icon name="sparkles" size={15} />
                </div>
                <div className="intel-thinking">
                  Running pre-flight checks
                  <span className="intel-dots">
                    <span />
                    <span />
                    <span />
                  </span>
                </div>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}

      {!hasThread && (
        <div className="intel-hello">
          <div className="intel-hello-mark">
            <Icon name="sparkles" size={20} />
          </div>
          <h1>What are we moving?</h1>
          <p>Pre-flight any load: what breaks, what to do about it, and who on the bench can run it.</p>
        </div>
      )}

      <div className="intel-composer-wrap">
        {error && (
          <div className="intel-error">
            <Icon name="alert" size={14} /> {error}
          </div>
        )}
        <div className="intel-composer">
          <textarea
            ref={inputRef}
            className="intel-input"
            rows={1}
            autoFocus
            placeholder={hasThread ? "Check another load…" : "Describe a load…"}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              autosize();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                runAnalyze();
              }
            }}
          />
          <button
            type="button"
            className="intel-send"
            aria-label="Analyze load"
            disabled={pending || !text.trim()}
            onClick={() => runAnalyze()}
          >
            {pending ? <span className="intel-spin" /> : <Icon name="arrow-up" size={17} strokeWidth={2.2} />}
          </button>
        </div>

        {!hasThread && (
          <div className="intel-chiprow">
            {SUGGESTIONS.map((s) => (
              <button key={s.label} type="button" className="intel-chip" title={s.prompt} onClick={() => runAnalyze(s.prompt)}>
                <Icon name={s.icon} size={13} /> {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {baseline}
    </div>
  );
}
