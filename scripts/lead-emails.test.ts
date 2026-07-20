import assert from "node:assert/strict";
import { buildLeadCustomerEmailContent } from "../src/lib/lead-emails";
import { buildWhatsAppInquiry } from "../src/lib/rfq-whatsapp";

const base = {
  origin: null,
  destination: null,
  mode: null,
  commodity: null,
  containerType: null,
  containerCount: null,
  packages: null,
  weight: null,
  volume: null,
  dimensions: null,
  cargoReadyDate: null,
  parsedData: null,
};

// Complete US lead → English confirmation, nothing asked.
{
  const email = buildLeadCustomerEmailContent({
    ...base,
    origin: "Oakland, CA",
    destination: "San Salvador, El Salvador",
    commodity: "household goods",
    containerType: "20 ft container",
    cargoReadyDate: new Date("2026-08-01"),
    parsedData: JSON.stringify({ market: "US", fullName: "george quizz" }),
  });
  assert.equal(email.kind, "confirmation");
  assert.equal(email.missing.length, 0);
  assert.equal(email.subject, "Your request has been received — Derya");
  assert(email.text.includes("within the next 6 hours"), email.text);
  assert(email.text.includes("Co-founder & CEO"), email.text);
}

// Incomplete US lead → English info-request listing the same questions the
// WhatsApp draft asks, greeting by first name.
{
  const inq = {
    ...base,
    origin: "Savannah",
    destination: "india",
    commodity: "machine parts",
    parsedData: JSON.stringify({ market: "US", fullName: "igor mogilatov" }),
  };
  const email = buildLeadCustomerEmailContent(inq);
  const wa = buildWhatsAppInquiry(inq);
  assert.equal(email.kind, "info-request");
  assert.equal(email.subject, "A few details for your shipping quote — Derya");
  assert(email.text.startsWith("Hi Igor,"), email.text);
  assert(email.text.includes("about your machine parts shipment (Savannah → india)"), email.text);
  assert(email.text.includes("- What will be the exact delivery point?"), email.text);
  assert(email.text.includes("- When will the cargo be ready?"), email.text);
  assert.deepEqual(email.missing, wa.missing, "email and WhatsApp must ask for the same things");
  assert(!email.text.includes("ağırlığını"), "US email must not contain Turkish");
}

// Container lead with a timing-range answer counts as complete: the form's
// "within 2-4 weeks" satisfies the ready-date, and FCL needs no dims/weight
// — this is the "pass directly to pricing" shape.
{
  const email = buildLeadCustomerEmailContent({
    ...base,
    origin: "Foshan",
    destination: "DDP Philadelphia, Pennsylvania",
    commodity: "Kitchen cabinets",
    containerType: "40FT",
    containerCount: 1,
    parsedData: JSON.stringify({
      market: "US",
      fullName: "adam rifi",
      answers: { timing: "within 2-4 weeks" },
    }),
  });
  assert.equal(email.kind, "confirmation", email.text);
}

// …but a researcher's "timing" is not a date — still asked.
{
  const email = buildLeadCustomerEmailContent({
    ...base,
    origin: "Foshan",
    destination: "Philadelphia",
    commodity: "Kitchen cabinets",
    containerType: "40FT",
    parsedData: JSON.stringify({
      market: "US",
      answers: { timing: "i'm just researching prices right now." },
    }),
  });
  assert.equal(email.kind, "info-request");
  assert(email.text.includes("- When will the cargo be ready?"), email.text);
}

// Battery/solar cargo always gets the DG probe (UN38.3), even when the load
// is otherwise complete.
{
  const email = buildLeadCustomerEmailContent({
    ...base,
    origin: "Port-au-Prince Haiti",
    destination: "Jeremie",
    commodity: "Solar panels and battery",
    containerType: "20FT",
    parsedData: JSON.stringify({
      market: "US",
      fullName: "max baptiste",
      answers: { timing: "within 2-4 weeks" },
    }),
  });
  assert.equal(email.kind, "info-request");
  assert(email.text.includes("UN38.3"), email.text);
  assert(email.missing.includes("dangerous goods details"));
}

// Incomplete TR lead → Turkish info-request.
{
  const email = buildLeadCustomerEmailContent({
    ...base,
    origin: "Mersin",
    destination: "Ürdün",
    commodity: "mermer",
    parsedData: JSON.stringify({ fullName: "emre yılmaz" }),
  });
  assert.equal(email.kind, "info-request");
  assert.equal(email.subject, "Fiyat teklifiniz için birkaç bilgi rica ederiz — Derya");
  assert(email.text.startsWith("Merhaba,"), email.text);
  assert(email.text.includes("- Yükün tam varış noktası neresi olacak?"), email.text);
  assert(email.text.includes("Kurucu Ortak & CEO"), email.text);
}

// Complete TR lead → the original Turkish confirmation copy.
{
  const email = buildLeadCustomerEmailContent({
    ...base,
    origin: "İstanbul, Tuzla",
    destination: "Hamburg, Almanya",
    commodity: "yedek parça",
    packages: 3,
    weight: 1200,
    dimensions: JSON.stringify([{ qty: 3, length: 120, width: 80, height: 100 }]),
    cargoReadyDate: new Date("2026-07-10"),
    parsedData: JSON.stringify({ fullName: "emre yılmaz" }),
  });
  assert.equal(email.kind, "confirmation");
  assert.equal(email.subject, "Talebiniz alındı — Derya");
  assert(email.text.includes("önümüzdeki 6 saat içinde"), email.text);
}

console.log("lead-emails tests passed");
