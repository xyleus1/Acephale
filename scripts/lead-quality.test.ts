import assert from "node:assert/strict";
import { assessLeadQuality, leadQualitySummary } from "../src/lib/lead-quality";

const lead = (over: {
  origin?: string | null;
  destination?: string | null;
  commodity?: string | null;
  fromEmail?: string | null;
  fromCompany?: string | null;
  targetPrice?: number | null;
  phone?: string | null;
  fullName?: string | null;
  answers?: Record<string, string>;
}) => ({
  origin: over.origin ?? null,
  destination: over.destination ?? null,
  commodity: over.commodity ?? null,
  fromEmail: over.fromEmail ?? null,
  fromCompany: over.fromCompany ?? null,
  targetPrice: over.targetPrice ?? null,
  parsedData: JSON.stringify({
    source: "meta-leads",
    market: "US",
    phone: over.phone ?? null,
    fullName: over.fullName ?? null,
    answers: over.answers ?? {},
  }),
});

// Unreachable lead → WEAK regardless of everything else.
{
  const q = assessLeadQuality(lead({
    origin: "Shenzhen", destination: "Philadelphia", commodity: "kitchen cabinets",
    answers: { commercial: "yes, commercial shipment.", shipmentType: "container", timing: "within 0-2 weeks" },
  }));
  assert.equal(q.tier, "WEAK");
  assert(q.reasons.join().includes("no usable email or phone"), q.reasons.join());
}

// "Isk → Idk" style non-lane → WEAK even with contact info.
{
  const q = assessLeadQuality(lead({
    origin: "Isk", destination: "Idk", fromEmail: "broker@example.com", phone: "+15163188900",
    targetPrice: 10000, commodity: "customers",
  }));
  assert.equal(q.tier, "WEAK");
  assert(q.reasons.join().includes("no usable origin or destination"), q.reasons.join());
}
{
  const q = assessLeadQuality(lead({
    origin: "national and international", destination: "national and international",
    fromEmail: "a@b.co", commodity: "products, vehicles, and trucks",
  }));
  assert.equal(q.tier, "WEAK");
}

// Commercial container load with real lane, near-term timing, budget → GOOD.
{
  const q = assessLeadQuality(lead({
    origin: "shenhi, china", destination: "Anchorage Alaska", commodity: "roof panels",
    fromEmail: "erinak1218@gmail.com", phone: "+19075212038", fromCompany: "emp holdings",
    fullName: "Erin P Paige", targetPrice: 8000,
    answers: {
      commercial: "yes, commercial shipment.",
      shipmentType: "partial load",
      loadInfo: "40 ft container",
      timing: "within 0-2 weeks",
    },
  }));
  assert.equal(q.tier, "GOOD", leadQualitySummary(q));
  assert(q.reasons.includes("commercial shipment"));
  assert(q.reasons.includes("container-sized load"));
}

// Declared-individual shipment caps at REVIEW no matter the container size
// (desk rule: GOOD = business-significant).
{
  const q = assessLeadQuality(lead({
    origin: "savanna", destination: "Germany", commodity: "cars",
    fromEmail: "mogilatovigor8@gmail.com", phone: "+19804467085", fromCompany: "AGIG LLC",
    fullName: "Igor", targetPrice: 1500,
    answers: {
      commercial: "no, individual shipment.",
      shipmentType: "container",
      loadInfo: "40 ft container",
      timing: "within 1-3 months",
    },
  }));
  assert.equal(q.tier, "REVIEW", leadQualitySummary(q));
  assert(q.reasons.includes("individual shipment"), q.reasons.join());
}

// Personal-effects move (household goods) caps at REVIEW even when the
// commercial answer is missing and the load is container-sized.
{
  const q = assessLeadQuality(lead({
    origin: "Oakland ca", destination: "El Salvador", commodity: "Household goods",
    fromEmail: "gman2587@gmail.com", phone: "+19254005097", fromCompany: "CDLTS TRUCKING",
    fullName: "George Quizz", targetPrice: 1800,
    answers: { shipmentType: "container", loadInfo: "20 ft container", timing: "within 2-4 weeks" },
  }));
  assert.equal(q.tier, "REVIEW", leadQualitySummary(q));
  assert(q.reasons.includes("personal effects move"), q.reasons.join());
}

// An importer who skipped/fudged the commercial question still ranks GOOD on
// load shape (business-looking commodity, pallets, near-term).
{
  const q = assessLeadQuality(lead({
    origin: "China", destination: "San Diego, California", commodity: "small copper statues",
    fromEmail: "importer@example.com", phone: "+16195550100", fromCompany: "Coastal Imports LLC",
    targetPrice: 2500,
    answers: { commercial: "i am not sure", shipmentType: "1–3 pallets", loadInfo: "1–3 pallets", timing: "within 0-2 weeks" },
  }));
  assert.equal(q.tier, "GOOD", leadQualitySummary(q));
}

// One-box sample shipper → REVIEW (real, but likely courier work).
{
  const q = assessLeadQuality(lead({
    origin: "New Jersey", destination: "india", commodity: "books and clothes",
    fromEmail: "sathishraj19101972@gmail.com", phone: "+12012759950", fromCompany: "no",
    fullName: "Sathish Raj", targetPrice: 100,
    answers: {
      commercial: "no, individual shipment.",
      shipmentType: "small package / sample",
      loadInfo: "1 box / sample",
      timing: "within 2-4 weeks",
    },
  }));
  assert.equal(q.tier, "REVIEW", leadQualitySummary(q));
  assert(q.reasons.includes("single box / sample"));
}

// Desk rule: an explicitly commercial shipment is ALWAYS Good — even a
// price-researcher with no budget (the "Teas Vietnam → Virginia" shape).
{
  const q = assessLeadQuality(lead({
    origin: "From Vitenam", destination: "Virginia", commodity: "Teas",
    fromEmail: "tea@example.com",
    answers: {
      commercial: "yes, commercial shipment.",
      shipmentType: "container",
      timing: "i'm just researching prices right now.",
    },
  }));
  assert.equal(q.tier, "GOOD", leadQualitySummary(q));
  assert(q.reasons.includes("commercial shipment"));
}

// …but the contact/lane gates still outrank it: an unreachable "commercial"
// lead is not a workable load.
{
  const q = assessLeadQuality(lead({
    origin: "Isk", destination: "Idk", fromEmail: "a@b.co",
    answers: { commercial: "yes, commercial shipment." },
  }));
  assert.equal(q.tier, "WEAK");
}

// The Turkish form's wording counts as commercial too.
{
  const q = assessLeadQuality(lead({
    origin: "Kayseri", destination: "Almanya", commodity: "mobilya",
    fromEmail: "emre@example.com", phone: "0532 123 45 67",
    answers: { commercial: "evet, ticari gönderi.", timing: "i'm just researching prices right now." },
  }));
  assert.equal(q.tier, "GOOD", leadQualitySummary(q));
}

// Price-researcher with an unclear load → not GOOD.
{
  const q = assessLeadQuality(lead({
    origin: "USA", destination: "Bosnia and Hercegovina", commodity: "furniture and tools",
    fromEmail: "feridtabak@att.net", phone: "+15108474230",
    fullName: "Ferid Tabak", fromCompany: "San Francisco, California",
    answers: {
      commercial: "no, individual shipment.",
      shipmentType: "container",
      loadInfo: "40 ft container",
      timing: "i'm just researching prices right now.",
    },
  }));
  assert.notEqual(q.tier, "GOOD", leadQualitySummary(q));
  assert(q.reasons.includes("just researching prices"));
}

// The company fallback (fromCompany === person's name) is not a company signal.
{
  const withRealCompany = assessLeadQuality(lead({
    origin: "Lagos", destination: "Baltimore", commodity: "palm oil",
    fromEmail: "c@x.com", fromCompany: "bleclem security services ltd", fullName: "Clement Attah",
    answers: { shipmentType: "4+ pallets", loadInfo: "10+ pallets", timing: "within 2-4 weeks", commercial: "yes, commercial shipment." },
  }));
  const withFallback = assessLeadQuality(lead({
    origin: "Lagos", destination: "Baltimore", commodity: "palm oil",
    fromEmail: "c@x.com", fromCompany: "Clement Attah", fullName: "Clement Attah",
    answers: { shipmentType: "4+ pallets", loadInfo: "10+ pallets", timing: "within 2-4 weeks", commercial: "yes, commercial shipment." },
  }));
  assert.equal(withRealCompany.score, withFallback.score + 1);
  assert.equal(withRealCompany.tier, "GOOD");
  assert(withRealCompany.reasons.includes("multi-pallet load"));
}

console.log("lead-quality tests passed");
