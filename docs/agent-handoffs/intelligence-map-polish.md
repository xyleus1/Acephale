# Intelligence Map Polish Handoff

## Task

Make `/dashboard/intelligence` look like a real freight intelligence map and make geography clearer without adding an external map API.

## Files Changed

- `src/app/dashboard/intelligence/page.tsx`
- `src/components/intelligence/world-intelligence-map.tsx`
- `src/components/intelligence/world-map-base.tsx`
- `src/lib/market-intelligence/intelligence-map.ts`
- `scripts/intelligence-map.test.ts`
- `docs/agent-handoffs/intelligence-map-polish.md`

## What Changed

- Improved the offline Natural Earth map base with stronger ocean/land contrast, coastline stroke, shelf glow, brighter grid labels, and visible dashed freight reference routes.
- Tightened fixed reference geography:
  - chokepoints: Suez Canal, Panama Canal, Strait of Hormuz, Bab el-Mandeb, Strait of Malacca, Bosporus, Gibraltar
  - ports: Shanghai, Singapore, Hamburg, Rotterdam, Los Angeles, Long Beach, Istanbul
  - continent labels remain visible on the map.
- Added label offsets for crowded freight geography so LA/Long Beach, Rotterdam/Hamburg, and Turkey/Mediterranean labels do not all stack on top of each other.
- Added an empty-map CTA with the requested copy, `Pull trusted market data to light up the map`, and visible source buttons for Maersk, Drewry, CBP, and Port of LA.
- Collapsed noisy evidence refs in Intelligence page rows behind `<details>` so operator summaries, implications, and actions are readable first.
- Changed customs/compliance map semantics so CBP/customs signals render as U.S. compliance hotspots and do not draw lane arcs, even when a valid-looking lane string is present.
- De-duplicated hotspot evidence refs in map data.
- Extended `scripts/intelligence-map.test.ts` to assert the requested ports/chokepoints, empty-state source buttons, and customs-no-lane behavior.

## Verification

Initial setup note: this workspace had no `node_modules`. `npm ci` installed dependencies but its postinstall `prisma generate` failed because `DATABASE_URL` was unset. I used a throwaway local Postgres database named `derya_intelligence_map_jackson` for schema-backed verification, then dropped it after verification.

Commands run:

```bash
npx tsc --noEmit
DATABASE_URL='postgresql://mert@127.0.0.1:5432/derya_intelligence_map_jackson' DATABASE_URL_UNPOOLED='postgresql://mert@127.0.0.1:5432/derya_intelligence_map_jackson' npm run test:intelligence-map
DATABASE_URL='postgresql://mert@127.0.0.1:5432/derya_intelligence_map_jackson' DATABASE_URL_UNPOOLED='postgresql://mert@127.0.0.1:5432/derya_intelligence_map_jackson' npm run build
DATABASE_URL='postgresql://mert@127.0.0.1:5432/derya_intelligence_map_jackson' DATABASE_URL_UNPOOLED='postgresql://mert@127.0.0.1:5432/derya_intelligence_map_jackson' npm run ai:handoff
```

All required verification commands passed after local dependency/schema setup.

Additional local smoke check:

- Started `npm run dev` against a second throwaway local Postgres database.
- Seeded one local-only admin user.
- Verified `/login` returned `200`.
- Verified unauthenticated `/dashboard/intelligence` redirected to `/login`.
- Verified authenticated `/dashboard/intelligence` returned `200` and included `Live intelligence map`, `Pull trusted market data to light up the map`, `Port of LA`, and `Suez Canal`.
- Dropped the throwaway visual-check database afterward.

## Caveats

- No live Firecrawl ingestion was run.
- Market cron was not enabled.
- No production deploy was run.
- No production database migration was run.
- A local throwaway DB was created and migrated with existing migrations only so tests/build could run, then dropped; no `prisma db push`, `migrate dev`, or `migrate reset` was used.
- The in-app Browser surface was unavailable in this Conductor session (`iab` unavailable), so visual verification was limited to build output plus authenticated local HTML smoke checks rather than an actual screenshot pass.
- I did not edit ingestion logic, DB schema, Gmail files, or old-data import scripts.

## Recommended Next Step

Open `/dashboard/intelligence` in a browser with representative map data and do a visual pass at desktop and laptop widths. The map is much less fake now, but crowded Europe/Middle East labels are still the area most likely to need another hand-tuned pass once real production signals accumulate.
