# Derya Freight OS — Demo

## Hybrid approach (recommended)

Show **your real procurement deal** for the first half (soybean meal to Ashgabat — gives the demo authenticity and operator credibility) and **seeded forwarding data** for the second half (where you don't have rate replies / BL docs / customer acceptance yet).

The two halves connect naturally: when you award a supplier, the platform auto-creates a child forwarding job. That handoff is where real becomes seeded — and the audience never notices because they're the same workflow visually.

**On camera, mention once:** *"This is our actual procurement deal, live data. The forwarding leg is staged because the shipment hasn't booked yet — but it's the same pipeline."*

---

# 75-second hybrid script

Real procurement → award → seeded forwarding job → ops → customer portal.

## Pre-record setup (one-time)

In agent chat, on JOB-2026-003 (or your soybean procurement job):

```
link all unlinked soybean meal threads to this job
```

Then:

```
extract supplier offers
```

Verify the supplier comparison table on the RFQ page has 3-5 rows with parsed prices. If under that, you may want to seed one or two more supplier reply emails.

For the forwarding half, seed (in your inbox or via paste):
- 3 carrier reply emails to a fake "JOB-2026-XXX rate request" thread (Maersk / MSC / CMA CGM, with prices)
- 1 customer acceptance email
- 1 BL.pdf attachment

---

## Script (75s, single take)

**0:00 — Open inbox**
*(`/dashboard/inbox`)*
> "We're mid-deal on a procurement we picked up last week. 300 metric tons of soybean meal, destination Ashgabat. Multiple suppliers replied — here they all are, AI-classified and attached to the deal."

Show the inbox; hover the thread count linked to the soybean deal. (Real data.)

**0:10 — Open the procurement job**
Click into the soybean meal RFQ. The supplier comparison table is the hero shot.

> "AI extracted each supplier's terms — price per ton, quantity, incoterms, payment, lead time. Cheapest is flagged. Operator picks a winner."

Type into agent (right rail):

```
summary of best rates
```

Agent ranks the suppliers, names the cheapest. (Real data.)

**0:25 — Counter-offer (optional, if time)**
Click **Counter** on the second-cheapest. Type *"5% under best."* AI drafts. Show the modal. Close it.

> "AI handles the negotiation polish. Operator reviews, hits send."

**0:32 — Award + auto-spinoff**
Click **Award** on the cheapest supplier. Confirm.

> "Procurement's done. We just told the supplier yes — and the platform spun up the forwarding job for the actual shipment. Origin pre-set to their port."

The Linked Jobs card shows ↓ Spinoff. Click it to open the forwarding job. **(Now we transition to seeded data.)**

**0:45 — Forwarding: rates roll in**
On the new forwarding job, agent chat:

```
summarize carrier rates
```

Three carrier rates listed, ranked. Cheapest flagged.

> "Same pattern, different ledger. Carriers replied to our rate request, AI extracted the numbers, ranked them."

**0:55 — Booking + customer notification**

```
mark this booked
```

Status pipeline advances. Customer auto-emailed (mention in voiceover).

> "Customer's getting an automated update right now — and a magic link to a live status portal."

Click **Customer portal** button → shows the public page rendering pipeline + ETD/ETA.

**1:08 — Document arrives**
Drop the BL.pdf into the email thread (or click to upload). Agent narrates the classification.

> "BL arrives, AI classifies it as Bill of Lading, attaches to the right slot."

**1:15 — Close**

> "From a real supplier email this morning to a tracked, customer-visible shipment in 75 seconds. The operator clicked six times. **One person can run a desk that used to need five.**"

---

## Why hybrid works

- **Authenticity** — opening on real data signals "this isn't a Figma mockup."
- **Coverage** — the seeded forwarding half lets you demo rate comparison, booking, customer portal, and document automation that your real deal hasn't reached yet.
- **The spinoff is the bridge** — procurement → forwarding job creation is automated, so the cut from real to seeded is invisible.

## Don't click live

- **Discard** (destructive)
- **Rotate link** (breaks portal URLs)
- **Merge duplicates** mid-recording

## Recording tips

- 1440p+
- Pre-warm Vercel by hitting `/dashboard` once before recording
- Cursor highlight overlay
- Single take — don't cut between procurement and forwarding halves; the continuity sells the story

---

# Backup: pure-forwarding 60s script (if you want a shorter cut)

See git history for the previous all-forwarding version — `git show HEAD~2:DEMO.md`. That one trades authenticity for speed if you only have 60 seconds of camera time.
