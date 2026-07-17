"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import {
  updateCarrierAction,
  updateChecklistItemAction,
  type CarrierPatch,
} from "@/app/dashboard/carriers/actions";
import {
  CARRIER_AUTHORITY_STATUSES,
  CARRIER_CHECKLIST_STATUSES,
  CARRIER_EQUIPMENT_TYPES,
  CARRIER_SECURITY_FEATURES,
  CARRIER_VETTING_CHECKLIST,
  CARRIER_VETTING_STATUSES,
  insuranceExpiryState,
  vettingStatusLabel,
  type VettingGateResult,
} from "@/lib/carrier-vetting";
import { CARRIER_CAPABILITY_BADGES, type CarrierDetail } from "@/lib/carrier-fields";
import { CellInput, CellSelect } from "@/components/sheet-cells";
import { Icon } from "@/components/icon";

const CHECKLIST_HINTS = new Map(CARRIER_VETTING_CHECKLIST.map((item) => [item.key, item.hint]));
const REQUIRED_KEYS = new Set(CARRIER_VETTING_CHECKLIST.filter((item) => item.required).map((item) => item.key));

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

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

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{title}</div>
        {hint && <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function grid(minWidth = 180): React.CSSProperties {
  return { display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`, gap: 12 };
}

export function CarrierDetailView({
  initialDetail,
  initialGate,
}: {
  initialDetail: CarrierDetail;
  initialGate: VettingGateResult;
}) {
  const [detail, setDetail] = useState(initialDetail);
  const [gate, setGate] = useState(initialGate);
  const [rev, setRev] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function flash(message: string) {
    setError(message);
    setTimeout(() => setError(null), 6000);
  }

  function commit(patch: CarrierPatch) {
    startTransition(async () => {
      try {
        const res = await updateCarrierAction(detail.id, patch);
        if ("error" in res) {
          flash(res.error);
          setRev((r) => r + 1);
          return;
        }
        setDetail(res.detail);
        setGate(res.gate);
      } catch {
        flash("Could not save — check your connection and try again.");
        setRev((r) => r + 1);
      }
    });
  }

  function commitChecklist(itemId: string, patch: { status?: string; note?: string; evidenceUrl?: string }) {
    startTransition(async () => {
      try {
        const res = await updateChecklistItemAction(itemId, patch);
        if ("error" in res) {
          flash(res.error);
          setRev((r) => r + 1);
          return;
        }
        setDetail((prev) => ({
          ...prev,
          checklist: prev.checklist.map((item) => (item.id === res.item.id ? res.item : item)),
        }));
        setGate(res.gate);
      } catch {
        flash("Could not save — check your connection and try again.");
        setRev((r) => r + 1);
      }
    });
  }

  // Text/date/money helper — remounts to server truth on failed saves via rev.
  function input(field: keyof CarrierPatch & keyof CarrierDetail, opts?: { placeholder?: string; date?: boolean }) {
    const raw = detail[field];
    const value =
      raw == null ? null : opts?.date ? String(raw).slice(0, 10) : typeof raw === "number" ? String(raw) : String(raw);
    return (
      <CellInput
        key={`${field}:${rev}:${value ?? ""}`}
        value={value}
        placeholder={opts?.placeholder ?? (opts?.date ? "YYYY-MM-DD" : undefined)}
        onCommit={(v) => commit({ [field]: v } as CarrierPatch)}
      />
    );
  }

  function toggleChip(label: string, on: boolean, onToggle: () => void, title?: string) {
    return (
      <button
        key={label}
        type="button"
        className={`mode-tab${on ? " active" : ""}`}
        title={title}
        onClick={onToggle}
      >
        {label}
      </button>
    );
  }

  const gateSummary = gate.canApprove
    ? "All required checks passed — this carrier can be approved."
    : `${gate.missing.length} required check(s) outstanding${gate.failed.length > 0 ? `, ${gate.failed.length} failed` : ""}.`;

  const cargoExpiry = insuranceExpiryState(detail.cargoInsuranceExpiry, new Date());

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1100 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Link href="/dashboard/carriers" className="btn btn-sm" title="Back to the carrier bench">
          <Icon name="arrow-left" size={13} /> Carriers
        </Link>
        <div style={{ flex: 1, minWidth: 220 }}>
          <CellInput key={`name:${rev}:${detail.name}`} value={detail.name} onCommit={(v) => commit({ name: v })} />
        </div>
        <div style={{ width: 160 }}>
          <CellSelect
            key={`vs:${rev}:${detail.vettingStatus}`}
            value={detail.vettingStatus}
            options={CARRIER_VETTING_STATUSES}
            onCommit={(v) => commit({ vettingStatus: v })}
          />
        </div>
        {toggleChip(detail.active ? "Active" : "Inactive", detail.active, () => commit({ active: !detail.active }), "Inactive carriers stay on file but are dimmed on the bench")}
        {error && <span className="sheet-error">{error}</span>}
      </div>

      <div
        className="card"
        style={{
          padding: "10px 16px",
          fontSize: 13,
          borderLeft: gate.canApprove ? "3px solid var(--success, #2e7d32)" : "3px solid var(--warning)",
        }}
      >
        <strong>Vetting gate:</strong> {gateSummary}
        {detail.vettedAt && (
          <span style={{ opacity: 0.6 }}> Approved {fmtDate(detail.vettedAt)}.</span>
        )}
        {detail.vettingStatus === "approved" && !gate.canApprove && (
          <span style={{ color: "var(--danger)" }}> Checklist regressed since approval — review below.</span>
        )}
      </div>

      <Section
        title="Vetting checklist"
        hint="Approval is blocked until every required item is passed or waived. Hints explain the fraud defense behind each check."
      >
        <div className="table-shell">
          <table className="data-table">
            <colgroup>
              <col />
              <col style={{ width: 110 }} />
              <col style={{ width: 220 }} />
              <col style={{ width: 190 }} />
              <col style={{ width: 100 }} />
            </colgroup>
            <thead>
              <tr>
                <th>Check</th>
                <th>Status</th>
                <th>Note</th>
                <th>Evidence URL</th>
                <th>Checked</th>
              </tr>
            </thead>
            <tbody>
              {detail.checklist.map((item) => (
                <tr key={item.id}>
                  <td title={CHECKLIST_HINTS.get(item.key) ?? undefined}>
                    {item.label}
                    {REQUIRED_KEYS.has(item.key) && <span style={{ color: "var(--danger)", marginLeft: 4 }} title="Required before approval">*</span>}
                  </td>
                  <td>
                    <CellSelect
                      key={`cs:${item.id}:${rev}:${item.status}`}
                      value={item.status}
                      options={CARRIER_CHECKLIST_STATUSES}
                      onCommit={(v) => commitChecklist(item.id, { status: v })}
                    />
                  </td>
                  <td>
                    <CellInput
                      key={`cn:${item.id}:${rev}:${item.note ?? ""}`}
                      value={item.note}
                      placeholder="e.g. producer callback 06/12, waived because…"
                      onCommit={(v) => commitChecklist(item.id, { note: v })}
                    />
                  </td>
                  <td>
                    <CellInput
                      key={`ce:${item.id}:${rev}:${item.evidenceUrl ?? ""}`}
                      value={item.evidenceUrl}
                      placeholder="Paste link"
                      onCommit={(v) => commitChecklist(item.id, { evidenceUrl: v })}
                    />
                  </td>
                  <td style={{ fontSize: 12, opacity: 0.7 }}>{fmtDate(item.checkedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Field label="Vetting notes">{input("vettingNotes", { placeholder: "Context for the current vetting status" })}</Field>
      </Section>

      <Section
        title="Fraud defense"
        hint="Verify against FMCSA and the insurance producer directly — never against details the carrier supplied."
      >
        <div style={grid()}>
          <Field label="Dispatch email">{input("dispatchEmail")}</Field>
          <Field label="Dispatch phone">{input("dispatchPhone")}</Field>
          <Field label="Verified callback phone">{input("verifiedPhone", { placeholder: "From the FMCSA record" })}</Field>
          <Field label="Expected email domain">{input("emailDomain", { placeholder: "carrierdomain.com" })}</Field>
          <Field label="Factoring company">{input("factoringCompany")}</Field>
          <Field label="Authority first active">{input("authorityFirstActive", { date: true })}</Field>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {toggleChip(
            detail.emailDomainVerified ? "Email domain verified" : "Email domain unverified",
            detail.emailDomainVerified,
            () => commit({ emailDomainVerified: !detail.emailDomainVerified })
          )}
          {detail.identityVerifiedAt ? (
            <>
              <span style={{ fontSize: 12, opacity: 0.7 }}>Identity verified {fmtDate(detail.identityVerifiedAt)}</span>
              <button type="button" className="btn btn-sm" onClick={() => commit({ identityVerified: false })}>
                Clear
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-sm" onClick={() => commit({ identityVerified: true })}>
              <Icon name="check" size={13} /> Mark identity verified
            </button>
          )}
        </div>
      </Section>

      <Section title="Authority & insurance" hint="COI limits verified with the producer. The review date follows the nearest expiry.">
        <div style={grid()}>
          <Field label="Legal name">{input("legalName")}</Field>
          <Field label="MC #">{input("mcNumber")}</Field>
          <Field label="DOT #">{input("dotNumber")}</Field>
          <Field label="SCAC">{input("scac")}</Field>
          <Field label="Authority status">
            <CellSelect
              key={`as:${rev}:${detail.authorityStatus ?? ""}`}
              value={detail.authorityStatus}
              options={CARRIER_AUTHORITY_STATUSES}
              allowEmpty
              onCommit={(v) => commit({ authorityStatus: v })}
            />
          </Field>
          <Field label="Insurance producer">{input("insuranceProducer", { placeholder: "Agency verified with" })}</Field>
          <Field label="Auto liability limit (USD)">{input("autoLiabilityLimit", { placeholder: "1000000" })}</Field>
          <Field label="Cargo limit (USD)">{input("cargoLimit", { placeholder: "100000" })}</Field>
          <Field label="Auto ins. expiry">{input("autoInsuranceExpiry", { date: true })}</Field>
          <Field label="Cargo ins. expiry">{input("cargoInsuranceExpiry", { date: true })}</Field>
          <Field label="High-value approved limit (USD)">{input("highValueApprovedLimit", { placeholder: "Max declared value without a rider" })}</Field>
          <Field label="COI link">{input("coiUrl", { placeholder: "Paste document URL" })}</Field>
        </div>
        <div style={{ fontSize: 12, opacity: 0.7 }}>
          Next review: {fmtDate(detail.nextReviewAt)}
          {cargoExpiry === "expired" && <span style={{ color: "var(--danger)", fontWeight: 600 }}> — cargo insurance EXPIRED</span>}
          {cargoExpiry === "expiring_soon" && <span style={{ color: "var(--warning)", fontWeight: 600 }}> — cargo insurance expires within 30 days</span>}
        </div>
      </Section>

      <Section title="Equipment & capability" hint="Capabilities drive the bench badges and add conditional vetting checks (lithium, hazmat).">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {CARRIER_EQUIPMENT_TYPES.map(([value, label]) =>
            toggleChip(label, detail.equipmentTypes.includes(value), () =>
              commit({
                equipmentTypes: detail.equipmentTypes.includes(value)
                  ? detail.equipmentTypes.filter((v) => v !== value)
                  : [...detail.equipmentTypes, value],
              })
            )
          )}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {CARRIER_CAPABILITY_BADGES.map(([field, , label]) =>
            toggleChip(label, detail[field], () => commit({ [field]: !detail[field] } as CarrierPatch))
          )}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {CARRIER_SECURITY_FEATURES.map(([value, label]) =>
            toggleChip(label, detail.securityFeatures.includes(value), () =>
              commit({
                securityFeatures: detail.securityFeatures.includes(value)
                  ? detail.securityFeatures.filter((v) => v !== value)
                  : [...detail.securityFeatures, value],
              })
            )
          )}
        </div>
        <div style={grid()}>
          <Field label="Service states (comma-separated)">
            <CellInput
              key={`ss:${rev}:${detail.serviceStates.join(",")}`}
              value={detail.serviceStates.join(", ")}
              placeholder="CA, NV, AZ"
              onCommit={(v) => commit({ serviceStates: v.split(",").map((s) => s.trim()).filter(Boolean) })}
            />
          </Field>
          <Field label="Home base">{input("homeBase", { placeholder: "Fremont, CA" })}</Field>
        </div>
      </Section>

      <Section title="Scorecard" hint="Computed from completed loads once the quote flywheel is live — manual for now.">
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 13 }}>
          <div><strong>{detail.loadsCompleted}</strong> loads</div>
          <div>On-time pickup: <strong>{detail.onTimePickupPct != null ? `${detail.onTimePickupPct}%` : "—"}</strong></div>
          <div>On-time delivery: <strong>{detail.onTimeDeliveryPct != null ? `${detail.onTimeDeliveryPct}%` : "—"}</strong></div>
          <div>Claims: <strong>{detail.claimCount}</strong></div>
          <div>Incidents: <strong>{detail.incidentCount}</strong></div>
          <div>Score: <strong>{detail.scorecardScore != null ? detail.scorecardScore.toFixed(0) : "—"}</strong></div>
        </div>
        <Field label="Notes">{input("notes", { placeholder: "Anything the next person booking this carrier should know" })}</Field>
      </Section>

      <p style={{ fontSize: 12, opacity: 0.5 }}>
        {vettingStatusLabel(detail.vettingStatus)} · MC {detail.mcNumber ?? "—"} · DOT {detail.dotNumber ?? "—"} · Changes save automatically.
      </p>
    </div>
  );
}
