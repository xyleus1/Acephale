import { Suspense } from "react";
import { MarketBaseline } from "@/components/market-baseline";
import { LoadCheckPanel } from "@/components/load-check-panel";
import { requireSession } from "@/lib/auth";

// The Census customs queries legitimately take 5-10s on a cold cache - give
// the streamed page room instead of letting the platform default cut them off.
export const maxDuration = 60;

// Intelligence page: run a load idea through the pre-flight, with the open-data
// market baseline underneath. Source notes live in the baseline card's footer -
// no separate explainer cards.
export default async function MarketPage() {
  await requireSession();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="page-hero compact">
        <div>
          <div className="eyebrow">CA tech freight</div>
          <h1>Intelligence</h1>
          <p>Type a load idea, hit Analyze, get the pre-flight: what breaks, what to do, and who on the bench can run it.</p>
        </div>
      </div>

      <LoadCheckPanel />

      <Suspense fallback={null}>
        <MarketBaseline />
      </Suspense>
    </div>
  );
}
