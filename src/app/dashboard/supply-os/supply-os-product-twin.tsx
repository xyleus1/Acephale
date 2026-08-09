"use client";

import {
  Bot,
  Box,
  Camera,
  CheckCircle2,
  CircuitBoard,
  Clock3,
  Cog,
  Factory,
  ImageOff,
  PackageCheck,
  PackageOpen,
  ShieldCheck,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useId, useMemo, useState } from "react";
import { calculateTwinBuildability } from "@/lib/supply-os/snapshot-twin";
import styles from "./supply-os-product-twin.module.css";

type EvidenceBasis = "Demo fixture" | "Rule" | "Public evidence" | "Published snapshot";

type TwinEvidence = {
  label: string;
  detail: string;
  basis: EvidenceBasis;
};

export type SupplyOsTwinItem = {
  id: string;
  name: string;
  partNumber: string;
  category: "drive" | "vision" | "control" | "battery" | "frame" | "other";
  quantityPerRobot: number;
  onHand: number;
  allocated: number;
  confirmedInbound: number;
  location: string;
  sourceCountry: string;
  leadTimeDays: number;
  unitCostUsd: number;
  isOptional?: boolean;
  recommendation: string;
  decision: string;
  evidence: TwinEvidence[];
};

export type SupplyOsTwinModel = {
  source: "published-snapshot";
  workspaceId: string;
  workspaceName: string;
  snapshotId: string;
  snapshotVersion: number;
  publishedAt: string | null;
  productName: string;
  productPartNumber: string;
  productRevision: string;
  productImageUrl: string | null;
  demandUnits: number;
  items: SupplyOsTwinItem[];
};

type Scenario = {
  id: "current" | "assembled-vision" | "alternate-camera";
  label: string;
  description: string;
  unitCostDeltaUsd: number;
  leadTimeDays: number;
  buildableUnits: number;
  compliance: string;
  decision: string;
};

const DEMAND_UNITS = 24;

const BOM_ITEMS: SupplyOsTwinItem[] = [
  {
    id: "drive-module",
    name: "Dual servo drive module",
    partNumber: "DRV-220",
    category: "drive",
    quantityPerRobot: 2,
    onHand: 44,
    allocated: 6,
    confirmedInbound: 12,
    location: "Austin assembly floor",
    sourceCountry: "Japan",
    leadTimeDays: 31,
    unitCostUsd: 1340,
    recommendation: "Keep the confirmed inbound lot assigned to the next production wave and qualify a repair exchange path for service failures.",
    decision: "Approve whether service stock can be temporarily reassigned to production.",
    evidence: [
      { label: "Inventory snapshot", detail: "Demo ERP fixture with on-hand, allocated, and confirmed inbound quantities.", basis: "Demo fixture" },
      { label: "Supply rule", detail: "Two matched drive modules are required for each AMR-240 assembly.", basis: "Rule" },
    ],
  },
  {
    id: "vision-module",
    name: "Vision and radio module",
    partNumber: "VIS-410",
    category: "vision",
    quantityPerRobot: 1,
    onHand: 17,
    allocated: 2,
    confirmedInbound: 6,
    location: "Austin controlled stock",
    sourceCountry: "Taiwan",
    leadTimeDays: 42,
    unitCostUsd: 980,
    recommendation: "Compare an assembled module against an alternate camera source, then retain host-product FCC review before releasing the configuration.",
    decision: "Choose the assembled module or alternate source for supplier qualification.",
    evidence: [
      { label: "Inventory snapshot", detail: "Demo ERP fixture shows a three-unit gap after confirmed inbound receipts.", basis: "Demo fixture" },
      { label: "Compliance boundary", detail: "A radio-module authorization reference does not by itself clear the finished robot. Host integration review remains open.", basis: "Rule" },
      { label: "Supplier option", detail: "Demo quote fixture includes an assembled subassembly with shorter modeled lead time.", basis: "Demo fixture" },
    ],
  },
  {
    id: "control-cabinet",
    name: "Control cabinet",
    partNumber: "CTL-115",
    category: "control",
    quantityPerRobot: 1,
    onHand: 26,
    allocated: 3,
    confirmedInbound: 0,
    location: "Austin line-side stock",
    sourceCountry: "United States",
    leadTimeDays: 19,
    unitCostUsd: 760,
    recommendation: "Reserve one additional cabinet or reduce the production wave to the evidence-backed quantity.",
    decision: "Approve one bridge unit or accept a 23-unit production ceiling.",
    evidence: [
      { label: "Inventory snapshot", detail: "Demo ERP fixture has 23 unallocated cabinets and no confirmed inbound receipt.", basis: "Demo fixture" },
      { label: "Assembly rule", detail: "One released cabinet is required for each serialized robot.", basis: "Rule" },
    ],
  },
  {
    id: "battery-pack",
    name: "48 V battery pack",
    partNumber: "BAT-480",
    category: "battery",
    quantityPerRobot: 2,
    onHand: 50,
    allocated: 8,
    confirmedInbound: 4,
    location: "Austin hazmat cage",
    sourceCountry: "South Korea",
    leadTimeDays: 35,
    unitCostUsd: 510,
    recommendation: "Confirm the four inbound packs and source two additional packs before committing the full demand quantity.",
    decision: "Approve the two-pack gap for supplier outreach.",
    evidence: [
      { label: "Inventory snapshot", detail: "Demo ERP fixture supports 23 robots after the confirmed inbound receipt.", basis: "Demo fixture" },
      { label: "Storage rule", detail: "Battery inventory remains location-controlled and cannot be treated as general stock.", basis: "Rule" },
    ],
  },
  {
    id: "frame-assembly",
    name: "Machined frame assembly",
    partNumber: "FRM-240",
    category: "frame",
    quantityPerRobot: 1,
    onHand: 29,
    allocated: 4,
    confirmedInbound: 0,
    location: "Austin receiving",
    sourceCountry: "Mexico",
    leadTimeDays: 24,
    unitCostUsd: 690,
    recommendation: "Keep the current frame release. No additional buy is required for the 24-unit demand fixture.",
    decision: "No purchasing decision is required unless demand increases.",
    evidence: [
      { label: "Inventory snapshot", detail: "Demo ERP fixture has 25 unallocated frame assemblies.", basis: "Demo fixture" },
      { label: "Assembly rule", detail: "One inspected frame assembly is required for each robot.", basis: "Rule" },
    ],
  },
];

const ITEM_ICONS: Record<SupplyOsTwinItem["category"], LucideIcon> = {
  drive: Cog,
  vision: Camera,
  control: CircuitBoard,
  battery: PackageCheck,
  frame: Box,
  other: PackageOpen,
};

function netAvailable(item: SupplyOsTwinItem, includeInbound: boolean) {
  return Math.max(0, item.onHand - item.allocated + (includeInbound ? item.confirmedInbound : 0));
}

function supportedBuilds(item: SupplyOsTwinItem, includeInbound: boolean) {
  if (item.isOptional) return Number.POSITIVE_INFINITY;
  return Math.floor(netAvailable(item, includeInbound) / item.quantityPerRobot);
}

const BUILDABLE_NOW = Math.min(...BOM_ITEMS.map((item) => supportedBuilds(item, false)));
const BUILDABLE_WITH_INBOUND = Math.min(...BOM_ITEMS.map((item) => supportedBuilds(item, true)));
const BASE_UNIT_COST_USD = BOM_ITEMS.reduce(
  (total, item) => total + item.unitCostUsd * item.quantityPerRobot,
  0,
);

function buildableWithVisionSupport(visionSupport: number) {
  return Math.min(
    visionSupport,
    ...BOM_ITEMS
      .filter((item) => item.id !== "vision-module")
      .map((item) => supportedBuilds(item, true)),
  );
}

const SCENARIOS: Scenario[] = [
  {
    id: "current",
    label: "Current purchase plan",
    description: "Current stock and confirmed inbound.",
    unitCostDeltaUsd: 0,
    leadTimeDays: 42,
    buildableUnits: BUILDABLE_WITH_INBOUND,
    compliance: "Host integration review open",
    decision: "Accept a three-unit production gap or compare an alternate vision configuration.",
  },
  {
    id: "assembled-vision",
    label: "Buy assembled vision module",
    description: "Buy one qualified subassembly.",
    unitCostDeltaUsd: 190,
    leadTimeDays: 34,
    buildableUnits: buildableWithVisionSupport(24),
    compliance: "Host review and supplier approval",
    decision: "Approve the added modeled cost and start technical qualification of the assembled module.",
  },
  {
    id: "alternate-camera",
    label: "Qualify alternate camera source",
    description: "Replace only the constrained camera source.",
    unitCostDeltaUsd: -65,
    leadTimeDays: 38,
    buildableUnits: buildableWithVisionSupport(23),
    compliance: "Supplier qualification open",
    decision: "Approve sample, optical validation, and supplier qualification before award.",
  },
];

function safeImageSource(value: string | null | undefined) {
  const source = value?.trim();
  if (!source) return null;
  if (source.startsWith("/") && !source.startsWith("//")) return source;
  try {
    const url = new URL(source);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function signedCurrency(value: number) {
  if (value === 0) return "No change";
  return `${value > 0 ? "+" : "-"}${formatCurrency(Math.abs(value))}`;
}

function statusFor(item: SupplyOsTwinItem, demandUnits: number, buildableWithInbound: number) {
  if (item.isOptional) return "ready" as const;
  const projected = supportedBuilds(item, true);
  if (projected >= demandUnits) return "ready" as const;
  if (projected === buildableWithInbound) return "critical" as const;
  return "review" as const;
}

function statusLabel(item: SupplyOsTwinItem, demandUnits: number) {
  if (item.isOptional) return "Optional";
  const projected = supportedBuilds(item, true);
  if (projected >= demandUnits) return "Covered";
  return `${demandUnits - projected} build${demandUnits - projected === 1 ? "" : "s"} short`;
}

export type SupplyOsPhotoAttribution = {
  href: string;
  label: string;
  title: string;
};

function ProductVisual({ source, alt, label, attribution }: { source?: string | null; alt: string; label: string; attribution?: SupplyOsPhotoAttribution | null }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const safeSource = safeImageSource(source);
  const showImage = safeSource && safeSource !== failedSource;

  return (
    <div className={styles.productVisual} data-fallback={!showImage}>
      {showImage ? (
        <img
          src={safeSource}
          alt={alt}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedSource(safeSource)}
        />
      ) : (
        <div className={styles.productVisualFallback}>
          <Bot size={38} strokeWidth={1.35} aria-hidden="true" />
          <span><ImageOff size={12} /> Safe image fallback</span>
        </div>
      )}
      {showImage && attribution ? (
        <a href={attribution.href} target="_blank" rel="noreferrer" title={attribution.title}>{attribution.label}</a>
      ) : <small>{label}</small>}
    </div>
  );
}

export type SupplyOsProductTwinProps = {
  productImageUrl?: string | null;
  productImageAttribution?: SupplyOsPhotoAttribution | null;
  className?: string;
  model?: SupplyOsTwinModel | null;
  view?: "materials" | "scenarios";
};

export function SupplyOsProductTwin({
  productImageUrl,
  productImageAttribution,
  className = "",
  model,
  view = "materials",
}: SupplyOsProductTwinProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const shortageTitleId = `${id}-shortages`;
  const graphTitleId = `${id}-graph`;
  const inventoryTitleId = `${id}-inventory`;
  const scenarioTitleId = `${id}-scenarios`;
  const [selectedItemId, setSelectedItemId] = useState("vision-module");
  const [selectedScenarioId, setSelectedScenarioId] = useState<Scenario["id"]>("current");

  const isPublishedSnapshot = model?.source === "published-snapshot";
  const bomItems = isPublishedSnapshot ? model.items : BOM_ITEMS;
  const demandUnits = isPublishedSnapshot ? model.demandUnits : DEMAND_UNITS;
  const { buildableNow, buildableWithInbound } = calculateTwinBuildability(bomItems, demandUnits);
  const selectedItem = bomItems.find((item) => item.id === selectedItemId) ?? bomItems[0] ?? BOM_ITEMS[0];
  const selectedScenario = isPublishedSnapshot
    ? null
    : SCENARIOS.find((scenario) => scenario.id === selectedScenarioId) ?? SCENARIOS[0];
  const SelectedItemIcon = ITEM_ICONS[selectedItem.category];
  const shortageRows = useMemo(() => bomItems
    .map((item) => ({
      item,
      supported: supportedBuilds(item, true),
      missingParts: item.isOptional ? 0 : Math.max(0, demandUnits * item.quantityPerRobot - netAvailable(item, true)),
    }))
    .filter((row) => row.missingParts > 0)
    .sort((left, right) => left.supported - right.supported), [bomItems, demandUnits]);

  const productName = isPublishedSnapshot ? model.productName : "AMR-240 warehouse robot";
  const productNumber = isPublishedSnapshot ? model.productPartNumber : "AMR-240";
  const productRevision = isPublishedSnapshot ? model.productRevision : "C";
  const productContext = isPublishedSnapshot ? model.workspaceName : "Atlas Robotics, Austin";
  const selectedPlanBuildable = selectedScenario?.buildableUnits ?? buildableWithInbound;

  return (
    <section className={`${styles.twin} ${className}`.trim()} data-view={view} aria-labelledby={titleId}>
      <header className={styles.identityStrip}>
        <ProductVisual
          source={isPublishedSnapshot ? model.productImageUrl : productImageUrl}
          alt={`${productName} product image`}
          label={isPublishedSnapshot ? `Published snapshot v${model.snapshotVersion}` : "Illustrative"}
          attribution={isPublishedSnapshot ? null : productImageAttribution}
        />
        <div className={styles.productIdentity}>
          <span className={styles.kicker}><Factory size={13} /> {productContext}</span>
          <h2 id={titleId}>{productName}</h2>
          <div className={styles.identityMeta}>
            <span>Rev {productRevision}</span>
            <span>Demand {demandUnits}</span>
          </div>
        </div>
        <dl className={styles.buildMetrics} aria-label="Calculated buildability">
          <div>
            <dt>Buildable now</dt>
            <dd>{buildableNow}</dd>
          </div>
          <div>
            <dt>With inbound</dt>
            <dd>{buildableWithInbound}</dd>
          </div>
          <div>
            <dt>{selectedScenario ? "Selected plan" : "Published plan"}</dt>
            <dd>{selectedPlanBuildable}</dd>
          </div>
          <div data-alert={selectedPlanBuildable < demandUnits}>
            <dt>Gap to demand</dt>
            <dd>{Math.max(0, demandUnits - selectedPlanBuildable)}</dd>
          </div>
        </dl>
      </header>

      <div className={styles.twinWorkspace}>
        <aside className={styles.bomNavigator} aria-label="Product bill of materials">
          <header className={styles.panelHeader}>
            <span>BOM</span>
            <small>{bomItems.length} modules</small>
          </header>
          <div className={styles.productRoot}>
            <span><Bot size={16} /></span>
            <div><strong>{productNumber}</strong></div>
          </div>
          <div className={styles.treeList}>
            {bomItems.map((item, index) => {
              const Icon = ITEM_ICONS[item.category];
              const active = item.id === selectedItem.id;
              return (
                <motion.button
                  key={item.id}
                  type="button"
                  data-active={active}
                  data-status={statusFor(item, demandUnits, buildableWithInbound)}
                  aria-pressed={active}
                  onClick={() => setSelectedItemId(item.id)}
                  whileHover={{ x: 2 }}
                  whileTap={{ scale: 0.99 }}
                >
                  {active ? <motion.span className={styles.treeActiveRail} layoutId="supply-os-tree-selection" /> : null}
                  <span className={styles.treeIndex}>{String(index + 1).padStart(2, "0")}</span>
                  <span className={styles.treeIcon}><Icon size={15} /></span>
                  <span className={styles.treeCopy}>
                    <strong>{item.name}</strong>
                    <small>{item.quantityPerRobot} per {isPublishedSnapshot ? "product" : "robot"}, {item.partNumber}</small>
                  </span>
                  <i>{statusLabel(item, demandUnits)}</i>
                </motion.button>
              );
            })}
          </div>
          <section className={styles.shortageQueue} aria-labelledby={shortageTitleId}>
            <header>
              <span id={shortageTitleId}>Current-plan shortages</span>
              <TriangleAlert size={14} />
            </header>
            {shortageRows.map(({ item, missingParts }) => (
              <button key={item.id} type="button" onClick={() => setSelectedItemId(item.id)}>
                <span><strong>{item.partNumber}</strong><small>{item.name}</small></span>
                <b>{missingParts} part{missingParts === 1 ? "" : "s"}</b>
              </button>
            ))}
          </section>
        </aside>

        <main className={styles.analysisCanvas}>
          <header className={styles.canvasHeader}>
            <span><strong>Assembly</strong></span>
          </header>

          <section className={styles.graphPanel} aria-labelledby={graphTitleId}>
            <div className={styles.graphHeading}>
              <span>
                <h3 id={graphTitleId}>Build limits</h3>
              </span>
              <span className={styles.graphLegend}>
                <i data-state="ready" /> Covered
                <i data-state="review" /> Gap
                <i data-state="critical" /> Primary blocker
              </span>
            </div>

            <div className={styles.graphLayout}>
              <div className={styles.assemblyNode}>
                <span><Bot size={21} /></span>
                <small>Final assembly</small>
                <strong>{productNumber}</strong>
                <em>{buildableWithInbound} / {demandUnits} buildable</em>
              </div>
              <div className={styles.graphTrunk} aria-hidden="true" />
              <div className={styles.componentNodes}>
                {bomItems.map((item) => {
                  const Icon = ITEM_ICONS[item.category];
                  const active = item.id === selectedItem.id;
                  const available = netAvailable(item, true);
                  return (
                    <motion.button
                      key={item.id}
                      type="button"
                      className={styles.componentNode}
                      data-active={active}
                      data-status={statusFor(item, demandUnits, buildableWithInbound)}
                      aria-pressed={active}
                      onClick={() => setSelectedItemId(item.id)}
                      whileHover={{ x: 3 }}
                      whileTap={{ scale: 0.995 }}
                    >
                      {active ? <motion.span className={styles.componentActiveRail} layoutId="supply-os-graph-selection" /> : null}
                      <span className={styles.componentIcon}><Icon size={16} /></span>
                      <span className={styles.componentName}><small>{item.partNumber}</small><strong>{item.name}</strong></span>
                      <span className={styles.componentInventory}><small>Available</small><strong>{available}</strong></span>
                      <span className={styles.componentSupport}><small>Supports</small><strong>{item.isOptional ? "Optional" : supportedBuilds(item, true)}</strong></span>
                    </motion.button>
                  );
                })}
              </div>
            </div>
          </section>

          <section className={styles.inventorySection} aria-labelledby={inventoryTitleId}>
            <header>
              <span><h3 id={inventoryTitleId}>Inventory</h3></span>
              <small>Inbound shown separately.</small>
            </header>
            <div className={styles.inventoryTableWrap}>
              <table className={styles.inventoryTable}>
                <thead>
                  <tr><th>Module</th><th>On hand</th><th>Allocated</th><th>{isPublishedSnapshot ? "Inbound and on order" : "Inbound"}</th><th>Supports now</th><th>Supports after inbound</th></tr>
                </thead>
                <tbody>
                  {bomItems.map((item) => (
                    <tr key={item.id} data-selected={item.id === selectedItem.id}>
                      <th scope="row"><button type="button" onClick={() => setSelectedItemId(item.id)}>{item.partNumber}</button></th>
                      <td>{item.onHand}</td>
                      <td>{item.allocated}</td>
                      <td>{item.confirmedInbound}</td>
                      <td>{item.isOptional ? "Optional" : supportedBuilds(item, false)}</td>
                      <td data-gap={!item.isOptional && supportedBuilds(item, true) < demandUnits}>{item.isOptional ? "Optional" : supportedBuilds(item, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {selectedScenario ? <section className={styles.scenarioSection} aria-labelledby={scenarioTitleId}>
            <header>
              <span><h3 id={scenarioTitleId}>Scenarios</h3></span>
              <small>Demo inputs</small>
            </header>
            <div className={styles.scenarioTableWrap}>
              <table className={styles.scenarioTable}>
                <thead>
                  <tr><th>Plan</th><th>Unit cost</th><th>Lead time</th><th>Buildable</th><th>Review state</th></tr>
                </thead>
                <tbody>
                  {SCENARIOS.map((scenario) => {
                    const active = scenario.id === selectedScenario.id;
                    return (
                      <tr key={scenario.id} data-selected={active}>
                        <th scope="row">
                          <motion.button type="button" aria-pressed={active} onClick={() => setSelectedScenarioId(scenario.id)} whileTap={{ scale: 0.995 }}>
                            <span>{scenario.label}</span><small>{scenario.description}</small>
                          </motion.button>
                        </th>
                        <td><strong>{formatCurrency(BASE_UNIT_COST_USD + scenario.unitCostDeltaUsd)}</strong><small>{signedCurrency(scenario.unitCostDeltaUsd)}</small></td>
                        <td><strong>{scenario.leadTimeDays} days</strong><small>{scenario.leadTimeDays - SCENARIOS[0].leadTimeDays} day change</small></td>
                        <td><strong>{scenario.buildableUnits} / {demandUnits}</strong><small>{Math.max(0, demandUnits - scenario.buildableUnits)} unit gap</small></td>
                        <td><span>{scenario.compliance}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section> : (
            <section className={styles.scenarioSection} aria-labelledby={scenarioTitleId}>
              <header>
                <span><h3 id={scenarioTitleId}>No scenarios</h3></span>
                <small>Not published</small>
              </header>
              <div className={styles.scenarioEmpty}>
                <ShieldCheck size={18} />
                <p>Add supplier and cost evidence to compare plans.</p>
              </div>
            </section>
          )}
        </main>

        <aside className={styles.decisionDossier} aria-label="Selected component decision">
          <p className={styles.srOnly} aria-live="polite" aria-atomic="true">
            Selected {selectedItem.name}. {statusLabel(selectedItem, demandUnits)}. {selectedScenario ? `Scenario ${selectedScenario.label}, ${selectedScenario.buildableUnits} buildable units.` : `Published plan, ${buildableWithInbound} buildable units.`}
          </p>
          <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${selectedItem.id}:${selectedScenario?.id ?? model?.snapshotId ?? "published"}`}
            className={styles.dossierContent}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -6 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          >
            <header className={styles.dossierHeader}>
              <span className={styles.dossierIcon} data-status={statusFor(selectedItem, demandUnits, buildableWithInbound)}>
                <SelectedItemIcon size={18} />
              </span>
              <span><small>Selected</small><h3>{selectedItem.name}</h3><em>{selectedItem.partNumber}</em></span>
              <i data-status={statusFor(selectedItem, demandUnits, buildableWithInbound)}>{statusLabel(selectedItem, demandUnits)}</i>
            </header>

            <div className={styles.dossierBody}>
              <dl className={styles.dossierFacts}>
                <div><dt>Per {isPublishedSnapshot ? "product" : "robot"}</dt><dd>{selectedItem.quantityPerRobot}</dd></div>
                <div><dt>Available now</dt><dd>{netAvailable(selectedItem, false)}</dd></div>
                <div><dt>{isPublishedSnapshot ? "Inbound and on order" : "Confirmed inbound"}</dt><dd>{selectedItem.confirmedInbound}</dd></div>
                <div><dt>Lead time</dt><dd>{isPublishedSnapshot ? "Not supplied" : `${selectedItem.leadTimeDays} days`}</dd></div>
                <div><dt>Source country</dt><dd>{selectedItem.sourceCountry}</dd></div>
                <div><dt>Inventory point</dt><dd>{selectedItem.location}</dd></div>
              </dl>

              <section className={styles.dossierRecommendation}>
                <h4>Next action</h4>
                <p>{selectedItem.recommendation}</p>
              </section>

              {selectedScenario ? <section className={styles.selectedScenario}>
                <header><small>Plan</small><strong>{selectedScenario.label}</strong></header>
                <dl>
                  <div><dt>Modeled unit cost</dt><dd>{formatCurrency(BASE_UNIT_COST_USD + selectedScenario.unitCostDeltaUsd)}</dd></div>
                  <div><dt>Buildable units</dt><dd>{selectedScenario.buildableUnits}</dd></div>
                </dl>
                <p>{selectedScenario.decision}</p>
              </section> : null}

              <section className={styles.evidenceSection}>
                <header><h4>Evidence</h4><span>{selectedItem.evidence.length}</span></header>
                {selectedItem.evidence.map((evidence) => (
                  <article key={evidence.label}>
                    <span>{evidence.basis === "Rule" ? <ShieldCheck size={14} /> : <CheckCircle2 size={14} />}</span>
                    <div><strong>{evidence.label}</strong><p>{evidence.detail}</p><small>{evidence.basis}</small></div>
                  </article>
                ))}
              </section>
            </div>

            <footer className={styles.dossierFooter}>
              <span><Clock3 size={13} /> Approval required</span>
              <strong>{selectedItem.decision}</strong>
            </footer>
          </motion.div>
          </AnimatePresence>
        </aside>
      </div>

      <footer className={styles.dataBoundary}>
        <span><ShieldCheck size={14} /> {isPublishedSnapshot ? `Snapshot v${model.snapshotVersion}` : "Demo"}</span>
        <p>{isPublishedSnapshot ? "Read only. No supplier, order, shipment, filing, or spend is approved." : "Demo only. Nothing is approved or live."}</p>
      </footer>
    </section>
  );
}
