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
import { companyNameHint } from "@/lib/supply-os-company-identity";
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

type GeneratorState = "idle" | "researching" | "fallback" | "error";

const RESEARCH_EXAMPLE = [
  "Company: AON3D",
  "Located: Montreal, Quebec, Canada",
  "Production: Montreal, Quebec, Canada",
  "Needs: motion controls, industrial electronics, heaters, fabricated frames, machined parts, and service inventory",
  "Sources: Shenzhen, China and Southern Ontario",
  "Ships to: Detroit, Michigan and Germany",
  "AON3D builds industrial 3D printers and material systems. Planned replenishment can move by ocean, urgent production parts by air, regional structures by truck, and finished machines through cross-border and international delivery lanes. Website: https://www.aon3d.com",
].join("\n");

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
      setState("fallback");
      setMessage("Public research stopped before verification. Building a draft from your input instead.");
      setResearchProgress((current) => [...current.filter((item) => item.id !== "dashboard"), {
        id: "dashboard",
        label: "Continuing with a draft",
        detail: `${detail} You can add the official website later to attach sourced company facts.`,
        status: "assumption",
      }]);
      await new Promise((resolve) => window.setTimeout(resolve, 450));
      buildWithoutResearch();
    } finally {
      window.removeEventListener(SUPPLY_RESEARCH_PROGRESS_EVENT, handleProgress);
    }
  }

  function buildWithoutResearch() {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) return;
    const name = companyNameHint(normalizedPrompt);
    const planningPrompt = name && !/^\s*company\s*:/i.test(normalizedPrompt)
      ? `Company: ${name}\n${normalizedPrompt}`
      : normalizedPrompt;
    saveAndPresent(generateSupplyCase(planningPrompt, new Date(), engagementScope));
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
            <span className={styles.eyebrow}>New customer</span>
            <h2 id="case-builder-title">Map a company&apos;s supply chain</h2>
            <p>Enter a company name. Derya verifies the business, identifies likely supply needs, and builds a first operating plan.</p>
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
            Company name, website, or what you know
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
            placeholder="Example: AON3D, aon3d.com, or a short description of what the company makes and where it operates."
          />

          <div className={styles.composerFooter}>
            <button
              type="button"
              className={styles.textButton}
              disabled={state === "researching"}
              onClick={() => {
                setEngagementScope("full_operation");
                setPrompt(RESEARCH_EXAMPLE);
                setState("idle");
                setResearchProgress([]);
                setMessage("Building the complete AON3D operating example.");
                saveAndPresent(generateSupplyCase(RESEARCH_EXAMPLE, new Date(), "full_operation"));
              }}
            >
              Open full AON3D demo
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
          <span className={styles.eyebrow}>Your dashboard</span>
          <ol>
            <li><strong>Company</strong><span>Official website, products, locations, and evidence.</span></li>
            <li><strong>Supply plan</strong><span>Likely inputs, known sites, and the lanes still needing confirmation.</span></li>
            <li><strong>First actions</strong><span>What Derya can run and what the customer needs to provide.</span></li>
          </ol>
          <p>No supplier award, booking, customs filing, or spend is committed without approval.</p>
        </aside>
      </main>
    </div>
  );
}
