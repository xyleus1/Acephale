import { Suspense } from "react";
import { IntelligenceDesk } from "@/components/intelligence-desk";
import { MarketBaseline } from "@/components/market-baseline";
import { requireSession } from "@/lib/auth";

// The Census customs queries legitimately take 5-10s on a cold cache - give
// the streamed page room instead of letting the platform default cut them off.
export const maxDuration = 60;

// Intelligence page: a conversational pre-flight desk. Type a load idea in
// the composer, get the verdict + findings as a chat exchange; the open-data
// market baseline streams in as the ticker under the composer.
export default async function MarketPage() {
  await requireSession();

  return (
    <IntelligenceDesk
      baseline={
        <Suspense fallback={null}>
          <MarketBaseline />
        </Suspense>
      }
    />
  );
}
