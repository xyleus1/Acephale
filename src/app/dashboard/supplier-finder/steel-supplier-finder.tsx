"use client";

/* eslint-disable @next/next/no-img-element */

import {
  AlertTriangle,
  Check,
  CircleDashed,
  ExternalLink,
  Factory,
  Images,
  LockKeyhole,
  Search,
  ShieldCheck,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  SteelSupplierCommercialModel,
  SteelSupplierEvidenceGate,
  SteelSupplierSearchInput,
  SteelSupplierSearchResult,
  SteelSupplierSegment,
  SteelSupplierVisual,
  SteelSupplierVisualKind,
} from "@/lib/steel-supplier-search";
import styles from "./supplier-finder.module.css";

type SupplierFinderDraft = SteelSupplierSearchInput & {
  confidentialOriginNotes: string;
};

const DEFAULT_DRAFT: SupplierFinderDraft = {
  segment: "raw_material",
  product: "",
  specification: "",
  quantity: "",
  targetMarket: "Türkiye",
  preferredRegions: "",
  commercialModel: "trade_or_representation",
  requirements: "",
  confidentialOriginNotes: "",
};

const SEGMENTS: Array<{ value: SteelSupplierSegment; label: string }> = [
  { value: "raw_material", label: "Raw material" },
  { value: "fuel", label: "Fuel" },
  { value: "semi_finished", label: "Semi-finished product" },
  { value: "finished_product", label: "Finished product" },
];

const COMMERCIAL_MODELS: Array<{ value: SteelSupplierCommercialModel; label: string }> = [
  { value: "trade_or_representation", label: "Trade or representation" },
  { value: "direct_trade", label: "Direct trade" },
  { value: "representation", label: "Agent or representative" },
];

const GATE_LABELS: Record<SteelSupplierEvidenceGate, string> = {
  official_identity: "Official identity",
  producer_status: "Producer status",
  product_capability: "Product capability",
  quality_system: "Quality system",
  export_market: "Export market evidence",
};

const ROLE_LABELS = {
  producer: "Producer",
  trader: "Trader",
  agent_or_representative: "Agent or representative",
} as const;

const VISUAL_KIND_LABELS: Record<SteelSupplierVisualKind, string> = {
  logo: "Logo",
  facility: "Facility",
  product: "Product",
  company: "Company",
  context: "Related image",
};

function text(value: unknown) {
  return typeof value === "string" ? value.slice(0, 1_000) : "";
}

function restoreDraft(value: unknown): SupplierFinderDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_DRAFT;
  const row = value as Record<string, unknown>;
  const segment = SEGMENTS.some((item) => item.value === row.segment)
    ? row.segment as SteelSupplierSegment
    : DEFAULT_DRAFT.segment;
  const commercialModel = COMMERCIAL_MODELS.some((item) => item.value === row.commercialModel)
    ? row.commercialModel as SteelSupplierCommercialModel
    : DEFAULT_DRAFT.commercialModel;
  return {
    segment,
    commercialModel,
    product: text(row.product),
    specification: text(row.specification),
    quantity: text(row.quantity),
    targetMarket: text(row.targetMarket) || DEFAULT_DRAFT.targetMarket,
    preferredRegions: text(row.preferredRegions),
    requirements: text(row.requirements),
    confidentialOriginNotes: text(row.confidentialOriginNotes),
  };
}

function supportedEvidenceCount(result: SteelSupplierSearchResult["candidates"][number]) {
  return result.evidence.filter((item) => item.status === "supported").length;
}

function sourceLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Public source";
  }
}

function SupplierVisualCard({ visual }: { visual: SteelSupplierVisual }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <a
      className={styles.visualCard}
      data-kind={visual.kind}
      href={visual.sourcePageUrl}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open image source for ${visual.subject}`}
    >
      <div className={styles.visualImage}>
        <img
          src={visual.thumbnailUrl ?? visual.imageUrl}
          alt={visual.caption}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
        <span>{VISUAL_KIND_LABELS[visual.kind]}</span>
      </div>
      <div className={styles.visualMeta}>
        <strong>{visual.subject}</strong>
        <p>{visual.caption}</p>
        <small>{visual.sourceDomain} <ExternalLink size={9} /></small>
      </div>
    </a>
  );
}

function SupplierVisualGallery({ visuals, compact = false }: { visuals: SteelSupplierVisual[]; compact?: boolean }) {
  if (!visuals.length) return null;
  return (
    <div className={compact ? styles.compactVisualGrid : styles.visualGrid}>
      {visuals.map((visual) => <SupplierVisualCard key={visual.id} visual={visual} />)}
    </div>
  );
}

export function SteelSupplierFinder({ storageScope }: { storageScope: string }) {
  const storageKey = useMemo(() => `derya:supplier-finder:${storageScope}`, [storageScope]);
  const [draft, setDraft] = useState<SupplierFinderDraft>(DEFAULT_DRAFT);
  const [storageReady, setStorageReady] = useState(false);
  const [result, setResult] = useState<SteelSupplierSearchResult | null>(null);
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) setDraft(restoreDraft(JSON.parse(stored)));
    } catch {
      setError("The private browser draft could not be opened.");
    } finally {
      setStorageReady(true);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!storageReady) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(draft));
    } catch {
      setError("The private browser draft could not be saved.");
    }
  }, [draft, storageKey, storageReady]);

  function setField<K extends keyof SupplierFinderDraft>(field: K, value: SupplierFinderDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSearching(true);
    setResult(null);
    const publicInput: SteelSupplierSearchInput = {
      segment: draft.segment,
      product: draft.product,
      specification: draft.specification,
      quantity: draft.quantity,
      targetMarket: draft.targetMarket,
      preferredRegions: draft.preferredRegions,
      commercialModel: draft.commercialModel,
      requirements: draft.requirements,
    };
    try {
      const response = await window.fetch("/api/supplier-finder/search", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(publicInput),
      });
      const body = await response.json().catch(() => null) as { result?: SteelSupplierSearchResult; error?: string } | null;
      if (!response.ok || !body?.result) throw new Error(body?.error || "Supplier research failed.");
      setResult(body.result);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Supplier research failed.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div>
          <h1>Supplier Finder</h1>
        </div>
        <div className={styles.heroBoundary}>
          <ShieldCheck size={18} />
          <span><strong>Candidate discovery only</strong> No supplier is approved, awarded, or called reliable by this search.</span>
        </div>
      </header>

      <section className={styles.privacyNotice}>
        <LockKeyhole size={18} />
        <span><strong>Sensitive origin protection:</strong> private origin notes stay in this browser. Public research receives only the product brief.</span>
      </section>

      <div className={styles.topGrid}>
        <form className={styles.searchCard} onSubmit={submitSearch}>
          <header className={styles.cardHeader}>
            <div>
              <span>01</span>
              <h2>Public search brief</h2>
            </div>
            <small>Sent to public-source research</small>
          </header>

          <div className={styles.formGrid}>
            <label>
              <span>Product stage</span>
              <select value={draft.segment} onChange={(event) => setField("segment", event.target.value as SteelSupplierSegment)}>
                {SEGMENTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label>
              <span>Commercial model</span>
              <select value={draft.commercialModel} onChange={(event) => setField("commercialModel", event.target.value as SteelSupplierCommercialModel)}>
                {COMMERCIAL_MODELS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className={styles.fullField}>
              <span>Product or material <b>Required</b></span>
              <input
                required
                minLength={2}
                value={draft.product}
                onChange={(event) => setField("product", event.target.value)}
                placeholder="Example: HRC, billets, scrap, ferroalloy, coke, galvanized coil"
              />
            </label>
            <label className={styles.fullField}>
              <span>Grade, standard, and technical specification</span>
              <input
                value={draft.specification}
                onChange={(event) => setField("specification", event.target.value)}
                placeholder="Example: S355JR, EN 10025-2, width and thickness range"
              />
            </label>
            <label>
              <span>Volume and cadence</span>
              <input value={draft.quantity} onChange={(event) => setField("quantity", event.target.value)} placeholder="Example: 40,000 mt quarterly" />
            </label>
            <label>
              <span>Buying market <b>Required</b></span>
              <input required minLength={2} value={draft.targetMarket} onChange={(event) => setField("targetMarket", event.target.value)} />
            </label>
            <label className={styles.fullField}>
              <span>Regions to search</span>
              <input
                value={draft.preferredRegions}
                onChange={(event) => setField("preferredRegions", event.target.value)}
                placeholder="Leave blank for a broad search, or name public target regions"
              />
            </label>
            <label className={styles.fullField}>
              <span>Required evidence or certifications</span>
              <textarea
                value={draft.requirements}
                onChange={(event) => setField("requirements", event.target.value)}
                placeholder="Example: mill test certificates, ISO 9001, producer authorization, export references"
              />
            </label>
          </div>

          <button className={styles.searchButton} type="submit" disabled={searching}>
            <Search size={16} /> {searching ? "Searching attributable public sources..." : "Find supplier candidates"}
          </button>
        </form>

        <aside className={styles.sideStack}>
          <section className={styles.privateCard}>
            <header className={styles.cardHeader}>
              <div>
                <span><LockKeyhole size={13} /></span>
                <h2>Private origin context</h2>
              </div>
              <small>Browser only</small>
            </header>
            <textarea
              value={draft.confidentialOriginNotes}
              onChange={(event) => setField("confidentialOriginNotes", event.target.value)}
              placeholder="Current origins, supplier relationships, sensitivities, or names that must never enter public research"
            />
            <p>Browser only. Excluded from public search.</p>
          </section>

          <section className={styles.gateCard}>
            <header className={styles.cardHeader}>
              <div><span>02</span><h2>Reliability gate</h2></div>
              <small>Before contact or award</small>
            </header>
            <ol>
              <li><Check size={14} /><span><strong>Public evidence</strong> Identity, producer status, capability, quality, export activity</span></li>
              <li><CircleDashed size={14} /><span><strong>Independent screen</strong> Ownership, sanctions, adverse media, litigation</span></li>
              <li><CircleDashed size={14} /><span><strong>Commercial proof</strong> Bank and trade references, capacity, allocation, authority</span></li>
              <li><CircleDashed size={14} /><span><strong>Technical proof</strong> Sample, mill certificate, inspection, audit, contract controls</span></li>
            </ol>
          </section>
        </aside>
      </div>

      {error ? <div className={styles.error} role="alert"><AlertTriangle size={17} /> {error}</div> : null}

      <section className={styles.resultsSection} aria-live="polite">
        <header className={styles.resultsHeader}>
          <div>
            <span className={styles.eyebrow}>Results</span>
            <h2>{result ? `${result.candidates.length} attributable candidates` : "No search run yet"}</h2>
          </div>
          {result ? <small>Researched {new Date(result.searchedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</small> : null}
        </header>

        {!result ? (
          <div className={styles.emptyState}>
            <Factory size={25} />
            <h3>Enter a product to search</h3>
          </div>
        ) : (
          <>
            <p className={styles.resultSummary}>{result.summary}</p>
            {result.visuals.some((visual) => visual.candidateId === null) ? (
              <section className={styles.productVisuals}>
                <header>
                  <div><Images size={16} /><h3>Product and market images</h3></div>
                  <small>{result.visuals.filter((visual) => visual.candidateId === null).length} public images</small>
                </header>
                <p>Images do not prove grade, origin, availability, or product fit.</p>
                <SupplierVisualGallery visuals={result.visuals.filter((visual) => visual.candidateId === null)} />
              </section>
            ) : null}
            <div className={styles.candidateGrid}>
              {result.candidates.map((candidate) => {
                const supported = supportedEvidenceCount(candidate);
                const candidateVisuals = result.visuals.filter((visual) => visual.candidateId === candidate.id);
                return (
                  <article className={styles.candidateCard} key={candidate.id}>
                    <header>
                      <div>
                        <span>{candidate.country}</span>
                        <h3>{candidate.companyName}</h3>
                        <div className={styles.roleList}>
                          {candidate.roles.map((role) => <small key={role}>{ROLE_LABELS[role]}</small>)}
                        </div>
                      </div>
                      <strong className={styles.evidenceScore}>{supported}<small>/5 public gates</small></strong>
                    </header>

                    <p className={styles.productFit}>{candidate.productFit}</p>
                    <p className={styles.evidenceSummary}>{candidate.evidenceSummary}</p>

                    {candidateVisuals.length ? (
                      <section className={styles.candidateVisuals}>
                        <header>
                          <strong>Public company images</strong>
                          <small>{candidateVisuals.length} linked sources</small>
                        </header>
                        <SupplierVisualGallery visuals={candidateVisuals} compact />
                        <p>Images do not prove ownership, production, or facility control.</p>
                      </section>
                    ) : null}

                    <div className={styles.evidenceList}>
                      {candidate.evidence.map((item) => (
                        <div key={item.gate} data-status={item.status}>
                          <i>{item.status === "supported" ? <Check size={12} /> : item.status === "partial" ? <CircleDashed size={12} /> : <AlertTriangle size={12} />}</i>
                          <span><strong>{GATE_LABELS[item.gate]}</strong><small>{item.detail}</small></span>
                        </div>
                      ))}
                    </div>

                    {candidate.cautions.length ? (
                      <div className={styles.cautions}>
                        <strong>Open cautions</strong>
                        <ul>{candidate.cautions.map((item) => <li key={item}>{item}</li>)}</ul>
                      </div>
                    ) : null}

                    <div className={styles.nextStep}><strong>Next verification</strong><p>{candidate.nextVerification}</p></div>

                    <footer>
                      <a href={candidate.website} target="_blank" rel="noreferrer">Official or primary page <ExternalLink size={12} /></a>
                      <details>
                        <summary>{candidate.sourceUrls.length} public sources</summary>
                        <div>{candidate.sourceUrls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer">{sourceLabel(url)} <ExternalLink size={10} /></a>)}</div>
                      </details>
                    </footer>
                  </article>
                );
              })}
            </div>

            {(result.gaps.length || result.warnings.length) ? (
              <div className={styles.gapsPanel}>
                <section><h3>Search gaps</h3><ul>{result.gaps.map((item) => <li key={item}>{item}</li>)}</ul></section>
                <section><h3>Boundaries</h3><ul>{result.warnings.map((item) => <li key={item}>{item}</li>)}</ul></section>
              </div>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
