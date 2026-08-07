"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import {
  generateSupplyCase,
  upsertSupplyCase,
  type SupplyEngagementScope,
  type SupplyCaseDashboard,
} from "@/lib/supply-os-case-model";
import { SUPPLY_ENGAGEMENT_OPTIONS } from "@/lib/supply-os-engagement-plan";
import type { SupplyResearchProgress } from "@/lib/supply-os-company-research";
import {
  requestCompanyResearch,
  SUPPLY_RESEARCH_PROGRESS_EVENT,
} from "./supply-os-research-client";
import {
  loadSupplyCases,
  persistSupplyCases,
  removeLegacySupplyCaseStorage,
} from "./supply-os-storage";
import styles from "./supply-os-workspace.module.css";

type GeneratorState = "idle" | "researching" | "error";

const RESEARCH_EXAMPLE = "AON3D builds industrial additive-manufacturing hardware, software, and material systems in Montreal and serves customers globally. Website: https://www.aon3d.com";

export function SupplyOsCaseGenerator({ storageScope }: { storageScope: string }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [engagementScope, setEngagementScope] = useState<SupplyEngagementScope>("full_operation");
  const [state, setState] = useState<GeneratorState>("idle");
  const [message, setMessage] = useState("Enter a company name, website, or the operating context you already know.");
  const [researchProgress, setResearchProgress] = useState<SupplyResearchProgress[]>([]);

  useEffect(() => {
    removeLegacySupplyCaseStorage();
  }, []);

  function saveAndPresent(dashboard: SupplyCaseDashboard) {
    const latest = loadSupplyCases(storageScope).cases;
    const nextCases = upsertSupplyCase(latest, dashboard);
    if (!persistSupplyCases(storageScope, nextCases, dashboard.id)) {
      setState("error");
      setMessage("Browser storage is unavailable. The dashboard was not saved.");
      return;
    }
    router.push("/dashboard/supply-os?present=1");
  }

  async function researchAndBuild() {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      setState("error");
      setMessage("Add a company name, website, or operating description first.");
      return;
    }

    setState("researching");
    setResearchProgress([]);
    setMessage("Research started. Verified facts and assumptions will appear below as they are found.");
    const handleProgress = (rawEvent: Event) => {
      const event = (rawEvent as CustomEvent<SupplyResearchProgress>).detail;
      if (!event) return;
      setResearchProgress((current) => {
        const existing = current.findIndex((item) => item.id === event.id);
        if (existing < 0) return [...current, event];
        return current.map((item, index) => index === existing ? event : item);
      });
      setMessage(event.detail || event.label);
    };
    window.addEventListener(SUPPLY_RESEARCH_PROGRESS_EVENT, handleProgress);
    try {
      const research = await requestCompanyResearch(normalizedPrompt);
      const dashboard = generateSupplyCase(normalizedPrompt, new Date(), engagementScope, research);
      setMessage("Research complete. Saving the evidence-backed customer dashboard.");
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      saveAndPresent(dashboard);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Company research failed.";
      setState("error");
      setMessage(detail);
      setResearchProgress((current) => [...current.filter((item) => item.id !== "dashboard"), {
        id: "dashboard",
        label: "Research could not complete",
        detail,
        status: "error",
      }]);
    } finally {
      window.removeEventListener(SUPPLY_RESEARCH_PROGRESS_EVENT, handleProgress);
    }
  }

  function buildWithoutResearch() {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) return;
    saveAndPresent(generateSupplyCase(normalizedPrompt, new Date(), engagementScope));
  }

  return (
    <div className={`${styles.workspace} supply-os-workspace`}>
      <header className={styles.topBar}>
        <div className={styles.brandBlock}>
          <h1>New customer</h1>
          <span>Supply OS</span>
        </div>
        <Link className={styles.secondaryButton} href="/dashboard/supply-os">
          Customer dashboards
        </Link>
      </header>

      <main className={`${styles.main} ${styles.generatorMain}`}>
        <section className={styles.generatorCard} aria-labelledby="case-builder-title">
          <header className={styles.simpleHeader}>
            <span className={styles.eyebrow}>Company research</span>
            <h2 id="case-builder-title">Build the customer picture</h2>
            <p>Derya finds the official site and relevant public evidence, then maps what the company makes, what it may source, and how goods could move.</p>
          </header>

          <fieldset className={styles.scopeFieldset} disabled={state === "researching"}>
            <legend>Where should Derya start?</legend>
            <div className={styles.scopeOptions}>
              {SUPPLY_ENGAGEMENT_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  data-active={engagementScope === option.id}
                  aria-pressed={engagementScope === option.id}
                  onClick={() => setEngagementScope(option.id)}
                >
                  {option.shortLabel}
                </button>
              ))}
            </div>
          </fieldset>

          <label className={styles.composerLabel} htmlFor="supply-case-prompt">
            Company name, website, or context
          </label>
          <textarea
            id="supply-case-prompt"
            className={styles.composer}
            value={prompt}
            disabled={state === "researching"}
            onChange={(event) => {
              setPrompt(event.target.value);
              setState("idle");
              setResearchProgress([]);
              setMessage("Derya will verify the company before building the dashboard.");
            }}
            rows={7}
            placeholder="Example: AON3D, aon3d.com. They build industrial 3D printers in Montreal and sell globally. Show where Derya can take over sourcing, inbound logistics, customs, and delivery."
          />

          <div className={styles.composerFooter}>
            <button
              type="button"
              className={styles.textButton}
              disabled={state === "researching"}
              onClick={() => {
                setPrompt(RESEARCH_EXAMPLE);
                setEngagementScope("full_operation");
                setState("idle");
                setResearchProgress([]);
                setMessage("Example loaded. Research it to build an evidence-backed dashboard.");
              }}
            >
              Use AON3D example
            </button>
            <button type="button" className={styles.primaryButton} onClick={researchAndBuild} disabled={state === "researching"}>
              {state === "researching" ? "Researching company..." : "Research and build dashboard"}
              <Icon name="arrow-right" size={14} />
            </button>
          </div>
          <p className={styles.statusLine} data-state={state} aria-live="polite">{message}</p>
          {researchProgress.length ? (
            <section className={styles.researchTrace} aria-label="Company research progress">
              <div className={styles.traceHeader}>
                <strong>Research progress</strong>
                <span>{researchProgress.filter((item) => item.status === "complete").length} verified</span>
              </div>
              <ol>
                {researchProgress.map((item) => (
                  <li key={item.id} data-status={item.status}>
                    <span className={styles.traceMarker} aria-hidden="true">
                      {item.status === "complete" ? "✓" : item.status === "active" ? "…" : item.status === "error" ? "!" : "?"}
                    </span>
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.detail}</small>
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          {state === "error" && prompt.trim() ? (
            <button type="button" className={styles.fallbackButton} onClick={buildWithoutResearch}>
              Build from my description without public research
            </button>
          ) : null}
        </section>

        <aside className={styles.researchMethod}>
          <span className={styles.eyebrow}>What gets built</span>
          <ol>
            <li><strong>Verified company profile</strong><span>Official website, logo, products, locations, markets, and source links.</span></li>
            <li><strong>Supply-chain hypothesis</strong><span>Likely inputs, source regions, receiving points, and finished-goods markets, clearly marked for confirmation.</span></li>
            <li><strong>Operating handoff</strong><span>What Derya can run now, what the customer approves, and the three inputs needed to start.</span></li>
          </ol>
          <p>Public research is evidence, not permission to book freight, file customs entries, award suppliers, or commit spend.</p>
        </aside>
      </main>
    </div>
  );
}
