"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import {
  SAMPLE_SUPPLY_CASE_PROMPT,
  generateSupplyCase,
  upsertSupplyCase,
  type SupplyEngagementScope,
  type SupplyCaseDashboard,
} from "@/lib/supply-os-case-model";
import { SUPPLY_ENGAGEMENT_OPTIONS } from "@/lib/supply-os-engagement-plan";
import {
  loadSupplyCases,
  persistSupplyCases,
  removeLegacySupplyCaseStorage,
} from "./supply-os-storage";
import styles from "./supply-os-workspace.module.css";

type GeneratorState = "idle" | "ready" | "error";

function listOrMissing(values: readonly string[]) {
  return values.length ? values.join(", ") : "Not provided";
}

export function SupplyOsCaseGenerator({ storageScope }: { storageScope: string }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [engagementScope, setEngagementScope] = useState<SupplyEngagementScope>("full_operation");
  const [generatedCase, setGeneratedCase] = useState<SupplyCaseDashboard | null>(null);
  const [state, setState] = useState<GeneratorState>("idle");
  const [message, setMessage] = useState("Describe the company and the movement you want to plan.");

  useEffect(() => {
    removeLegacySupplyCaseStorage();
  }, []);

  const canSave = Boolean(
    generatedCase
      && prompt.trim() === generatedCase.sourcePrompt
      && engagementScope === (generatedCase.engagementScope ?? "full_operation"),
  );

  function buildCase() {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      setState("error");
      setMessage("Add the company, location, sourcing needs, or destination first.");
      return;
    }

    const nextCase = generateSupplyCase(normalizedPrompt, new Date(), engagementScope);
    setPrompt(nextCase.sourcePrompt);
    setGeneratedCase(nextCase);
    setState("ready");
    setMessage("Review the extracted inputs, then save the customer dashboard.");
  }

  function saveAndOpen() {
    if (
      !generatedCase
      || prompt.trim() !== generatedCase.sourcePrompt
      || engagementScope !== (generatedCase.engagementScope ?? "full_operation")
    ) {
      setState("error");
      setMessage("Build the edited description before saving.");
      return;
    }

    const latest = loadSupplyCases(storageScope).cases;
    const nextCases = upsertSupplyCase(latest, generatedCase);
    if (!persistSupplyCases(storageScope, nextCases, generatedCase.id)) {
      setState("error");
      setMessage("Browser storage is unavailable. This dashboard was not saved.");
      return;
    }

    router.push("/dashboard/supply-os");
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
            <h2 id="case-builder-title">Describe the customer</h2>
            <p>Include what they make, where production happens, what they source, and where finished goods need to go.</p>
          </header>

          <fieldset className={styles.scopeFieldset}>
            <legend>How should Derya help?</legend>
            <p>Run the full supply chain, or choose one place to start.</p>
            <div className={styles.scopeOptions}>
              {SUPPLY_ENGAGEMENT_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  data-active={engagementScope === option.id}
                  aria-pressed={engagementScope === option.id}
                  onClick={() => {
                    setEngagementScope(option.id);
                    setGeneratedCase(null);
                    setState("idle");
                    setMessage("Build the case to preview this level of support.");
                  }}
                >
                  {option.shortLabel}
                </button>
              ))}
            </div>
          </fieldset>

          <label className={styles.composerLabel} htmlFor="supply-case-prompt">
            Company and supply chain
          </label>
          <textarea
            id="supply-case-prompt"
            className={styles.composer}
            value={prompt}
            onChange={(event) => {
              setPrompt(event.target.value);
              setState("idle");
              setMessage("Build the edited description to review it.");
            }}
            rows={8}
            placeholder="Example: Atlas Robotics builds warehouse robots in Austin. It sources motors, cameras, and aluminum housings from Shenzhen, then ships finished systems to factories in Detroit and Nashville."
          />

          <div className={styles.composerFooter}>
            <button
              type="button"
              className={styles.textButton}
              onClick={() => {
                setPrompt(SAMPLE_SUPPLY_CASE_PROMPT);
                setEngagementScope("full_operation");
                setGeneratedCase(null);
                setState("idle");
                setMessage("Example loaded. Build it to review the extracted inputs.");
              }}
            >
              Use example
            </button>
            <button type="button" className={styles.primaryButton} onClick={buildCase}>
              Build case <Icon name="arrow-right" size={14} />
            </button>
          </div>
          <p className={styles.statusLine} data-state={state} aria-live="polite">{message}</p>
        </section>

        <aside className={styles.reviewPanel} aria-live="polite">
          {generatedCase ? (
            <>
              <header className={styles.simpleHeader}>
                <span className={styles.eyebrow}>Review</span>
                <h2>{generatedCase.companyName ?? "Customer details"}</h2>
              </header>
              <dl className={styles.extractedFacts}>
                <div><dt>Production or receiving</dt><dd>{generatedCase.productionLocation ?? "Not provided"}</dd></div>
                {generatedCase.companyLocation && generatedCase.companyLocation !== generatedCase.productionLocation ? (
                  <div><dt>Company location</dt><dd>{generatedCase.companyLocation}</dd></div>
                ) : null}
                <div><dt>Sources</dt><dd>{listOrMissing(generatedCase.sourcingNeeds)}</dd></div>
                <div><dt>Origin</dt><dd>{listOrMissing(generatedCase.sourceRegions)}</dd></div>
                <div><dt>Destinations</dt><dd>{listOrMissing(generatedCase.destinations)}</dd></div>
              </dl>
              {generatedCase.openQuestions.length ? (
                <div className={styles.missingPreview}>
                  <h3>Still needed</h3>
                  <ul>
                    {generatedCase.openQuestions.slice(0, 4).map((question) => <li key={question}>{question}</li>)}
                  </ul>
                </div>
              ) : null}
              <button type="button" className={styles.primaryButton} onClick={saveAndOpen} disabled={!canSave}>
                Save and open dashboard <Icon name="arrow-right" size={14} />
              </button>
            </>
          ) : (
            <div className={styles.reviewEmpty}>
              <Icon name="file-check" size={20} />
              <h2>Review before saving</h2>
              <p>The extracted company, origin, destination, and missing inputs will appear here.</p>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
