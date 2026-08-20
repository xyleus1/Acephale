import { ArrowRight } from "lucide-react";
import styles from "./supply-os-opportunities-preview.module.css";

const OPPORTUNITY_CARD_PREVIEWS = [
  { title: "Supplier change", measure: "Cost impact" },
  { title: "Route change", measure: "Transit impact" },
  { title: "Order change", measure: "Margin impact" },
] as const;

export function SupplyOsOpportunitiesPreview() {
  return (
    <section className={styles.preview} aria-labelledby="opportunities-preview-title">
      <header className={styles.header}>
        <div>
          <h2 id="opportunities-preview-title">Not active</h2>
          <p>Verified baselines and alternatives are not available.</p>
        </div>
        <span>Preview</span>
      </header>

      <div className={styles.cardGrid} aria-hidden="true">
        {OPPORTUNITY_CARD_PREVIEWS.map((card) => (
          <article key={card.title} className={styles.card}>
            <header>
              <span>{card.title}</span>
              <small>Preview</small>
            </header>
            <div className={styles.swapRow}>
              <div>
                <small>Current</small>
                <i className={styles.skeletonLine} data-width="medium" />
              </div>
              <ArrowRight size={16} strokeWidth={1.8} />
              <div>
                <small>Alternative</small>
                <i className={styles.skeletonLine} data-width="long" />
              </div>
            </div>
            <div className={styles.impactRow}>
              <span>{card.measure}</span>
              <i className={styles.skeletonMetric} />
            </div>
            <footer>
              <i className={styles.skeletonLine} data-width="long" />
              <i className={styles.skeletonLine} data-width="short" />
            </footer>
          </article>
        ))}
      </div>

      <p className={styles.boundary}>
        Impact estimates stay hidden until cost or transit evidence is verified.
      </p>
    </section>
  );
}
