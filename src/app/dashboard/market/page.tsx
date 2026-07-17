import { Suspense } from "react";
import { MarketBaseline } from "@/components/market-baseline";
import { Icon } from "@/components/icon";
import { requireSession } from "@/lib/auth";

// Dedicated market-intelligence page for the CA tech-freight niche — the same
// open feeds that power the compact card on the domestic pricing desk, plus
// source/cadence notes. All feeds are read-only, cached, and fail soft.
export default async function MarketPage() {
  await requireSession();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="page-hero compact">
        <div>
          <div className="eyebrow">CA tech freight</div>
          <h1>Market</h1>
          <p>
            Live baseline from open public data: fuel and truckload rates, California carrier supply, and customs
            flows of tech goods through the LA, SF, and San Diego districts. Refreshes itself — no operator input.
          </p>
        </div>
      </div>

      <Suspense fallback={null}>
        <MarketBaseline />
      </Suspense>

      <div className="record-panel">
        <div className="record-card-header">
          <div className="record-card-title">
            <Icon name="info" size={13} /> Sources & cadence
          </div>
        </div>
        <div className="card-body">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12, fontSize: 12 }}>
            <div>
              <strong>FRED</strong> — US diesel (weekly), long-distance truckload PPI (monthly), freight volume TSI
              (monthly). Keyless, cached 6 h.
            </div>
            <div>
              <strong>EIA</strong> — California diesel (weekly). CA prices set fuel surcharges on CA lanes, not the
              national print. Cached 6 h.
            </div>
            <div>
              <strong>FMCSA census</strong> — active CA for-hire carriers by size and hazmat capability: the bench
              recruiting pool. Cached 24 h.
            </div>
            <div>
              <strong>US Census customs</strong> — monthly tech imports by HS code through CA districts (~2-month
              publication lag). The demand side of the niche. Cached 24 h.
            </div>
          </div>
          <div style={{ fontSize: 11, opacity: 0.55, marginTop: 10 }}>
            Not yet connected (paid): DAT RateView lane rates, company-level import BOLs (ImportGenius/Panjiva),
            CargoNet theft data. Quote outcomes and carrier bids recorded on the RFQ desk feed the office-private lane
            memory alongside these public feeds.
          </div>
        </div>
      </div>
    </div>
  );
}
