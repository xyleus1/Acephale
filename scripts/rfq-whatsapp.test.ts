import assert from "node:assert/strict";
import {
  buildWhatsAppInquiry,
  seedWhatsAppLeadFields,
  waDigitsFromWhatsAppAddress,
  waPhoneDigits,
} from "../src/lib/rfq-whatsapp";

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

// Fully empty load → generic greeting, asks for everything, no wa link.
{
  const d = buildWhatsAppInquiry({ ...base });
  assert(d.text.startsWith("Merhaba, ben Derya Lojistik'ten Oğuzhan."), d.text);
  assert(d.text.includes("Taşınacak ürün nedir?"));
  assert(d.text.includes("Alım ve teslim adreslerini tam adres olarak iletebilir misiniz?"));
  assert(d.text.includes("Yük ne zaman hazır olacak?"));
  assert(d.missing.includes("weight"));
  assert.equal(d.phoneDisplay, null);
  assert.equal(d.waUrl, null);
}

// FCL with a country-level destination: no dims/weight asks, exact-point ask,
// Turkish-capitalized first name in the greeting, normalized wa.me link.
{
  const d = buildWhatsAppInquiry({
    ...base,
    origin: "Kayseri",
    destination: "Almanya",
    commodity: "mobilya",
    containerType: "40ft",
    parsedData: JSON.stringify({ fullName: "emre yılmaz", phone: "0532 123 45 67" }),
  });
  assert(d.text.startsWith("Emre Bey merhaba, ben Derya Lojistik'ten Oğuzhan."), d.text);
  assert(d.text.includes("Kayseri - Almanya 40ft konteyner yükünüz için yazıyorum"), d.text);
  assert(!d.text.includes("ağırlığını"), "booked container should not ask weight/dims");
  assert(d.text.includes("Yükün tam varış noktası neresi olacak?"));
  assert(d.missing.includes("exact destination"));
  assert(d.waUrl?.startsWith("https://wa.me/905321234567?text="), String(d.waUrl));
}

// Loose cargo with nothing measured merges dims/weight/pieces into one question.
{
  const d = buildWhatsAppInquiry({ ...base, origin: "Mersin", destination: "Ürdün", commodity: "mermer" });
  assert(
    d.text.includes("Yükün ölçülerini (en, boy, yükseklik), toplam ağırlığını ve parça sayısını iletebilir misiniz?"),
    d.text,
  );
  assert(d.missing.includes("exact destination"), "country-only destination should ask for the exact point");
}

// Complete load → no questions, pricing-underway note instead.
{
  const d = buildWhatsAppInquiry({
    ...base,
    origin: "İstanbul, Tuzla",
    destination: "Hamburg, Almanya",
    commodity: "yedek parça",
    packages: 3,
    weight: 1200,
    dimensions: JSON.stringify([{ qty: 3, length: 120, width: 80, height: 100 }]),
    cargoReadyDate: new Date("2026-07-10"),
  });
  assert.equal(d.missing.length, 0, d.missing.join(", "));
  assert(d.text.includes("Bilgileriniz elimizde"), d.text);
  assert(!d.text.includes("?"));
}

// AIR mode reads as an air shipment.
{
  const d = buildWhatsAppInquiry({ ...base, origin: "İstanbul", destination: "Londra", mode: "AIR" });
  assert(d.text.includes("İstanbul - Londra havayolu gönderiniz için yazıyorum"), d.text);
}

// US-market lead → English draft, en-US name casing ("igor" must not become
// "İgor"), country-only destination asks for the exact point, bare 10-digit
// NANP number promoted to +1.
{
  const d = buildWhatsAppInquiry({
    ...base,
    origin: "Savannah",
    destination: "india",
    commodity: "machine parts",
    containerType: "40ft",
    parsedData: JSON.stringify({ market: "US", fullName: "igor mogilatov", phone: "6105707011" }),
  });
  assert(d.text.startsWith("Hi Igor, this is Mert from Derya Logistics."), d.text);
  assert(d.text.includes("Savannah - india 40ft container shipment"), d.text);
  assert(!d.text.includes("ağırlığını"), "US draft must not contain Turkish");
  assert(d.text.includes("What will be the exact delivery point?"), d.text);
  assert(d.text.includes("When will the cargo be ready?"), d.text);
  assert(d.missing.includes("exact destination"));
  assert(d.waUrl?.startsWith("https://wa.me/16105707011?text="), String(d.waUrl));
}

// US loose cargo merges dims/weight/pieces into one English question.
{
  const d = buildWhatsAppInquiry({
    ...base,
    origin: "Los Angeles",
    destination: "Accra, Ghana",
    commodity: "furniture",
    parsedData: JSON.stringify({ market: "US" }),
  });
  assert(
    d.text.includes("Could you share the load's dimensions (L × W × H), total weight and piece count?"),
    d.text,
  );
}

// Complete US load → no questions, quote-underway note in English.
{
  const d = buildWhatsAppInquiry({
    ...base,
    origin: "Oakland, CA",
    destination: "San Salvador, El Salvador",
    commodity: "household goods",
    packages: 10,
    weight: 900,
    dimensions: JSON.stringify([{ qty: 10, length: 100, width: 80, height: 90 }]),
    cargoReadyDate: new Date("2026-08-01"),
    parsedData: JSON.stringify({ market: "US", fullName: "george quizz", phone: "+19254005097" }),
  });
  assert.equal(d.missing.length, 0, d.missing.join(", "));
  assert(d.text.includes("We have your details"), d.text);
  assert(!d.text.includes("?"));
  assert(d.waUrl?.startsWith("https://wa.me/19254005097?text="), String(d.waUrl));
}

// Phone normalization: international kept, TR local formats promoted, junk dropped.
assert.equal(waPhoneDigits("+962 79 818 5729"), "962798185729");
assert.equal(waPhoneDigits("0532 123 45 67"), "905321234567");
assert.equal(waPhoneDigits("532 123 45 67"), "905321234567");
assert.equal(waPhoneDigits("0049 170 1234567"), "491701234567");
assert.equal(waPhoneDigits("1234"), null);
assert.equal(waPhoneDigits(null), null);

// US market: bare NANP numbers get the +1; internationals stay untouched.
assert.equal(waPhoneDigits("6105707011", "US"), "16105707011");
assert.equal(waPhoneDigits("(424) 450-5023", "US"), "14244505023");
assert.equal(waPhoneDigits("+1 424 450 5023", "US"), "14244505023");
assert.equal(waPhoneDigits("12013759950", "US"), "12013759950");
assert.equal(waPhoneDigits("+962 79 818 5729", "US"), "962798185729");

// WhatsApp thread/message addresses ("whatsapp:<digits>") resolve to wa digits.
assert.equal(waDigitsFromWhatsAppAddress("whatsapp:905301743170"), "905301743170");
assert.equal(waDigitsFromWhatsAppAddress("whatsapp:962798185729"), "962798185729");
assert.equal(waDigitsFromWhatsAppAddress("lead@example.com"), null);
assert.equal(waDigitsFromWhatsAppAddress("whatsapp:1234"), null);
assert.equal(waDigitsFromWhatsAppAddress(null), null);

// WhatsApp-born inquiries get parsedData.phone/fullName seeded from the sender…
{
  const seeded = seedWhatsAppLeadFields({}, { fromEmail: "whatsapp:905301743170", fromName: "Hikmet Aydın" });
  assert.equal(seeded.phone, "+905301743170");
  assert.equal(seeded.fullName, "Hikmet Aydın");
}
// …without clobbering values that are already there…
{
  const seeded = seedWhatsAppLeadFields(
    { phone: "+90 532 000 00 00", fullName: "Existing Name" },
    { fromEmail: "whatsapp:905301743170", fromName: "Hikmet Aydın" },
  );
  assert.equal(seeded.phone, "+90 532 000 00 00");
  assert.equal(seeded.fullName, "Existing Name");
}
// …and leaving email senders untouched.
{
  const parsed = { subject: "x" };
  const seeded = seedWhatsAppLeadFields(parsed, { fromEmail: "lead@example.com", fromName: "Someone" });
  assert.deepEqual(seeded, parsed);
}

// The seeded phone round-trips into a wa.me link on the RFQ sheet draft.
{
  const seeded = seedWhatsAppLeadFields({}, { fromEmail: "whatsapp:905301743170", fromName: "hikmet aydın" });
  const d = buildWhatsAppInquiry({ ...base, parsedData: JSON.stringify(seeded) });
  assert(d.waUrl?.startsWith("https://wa.me/905301743170?text="), String(d.waUrl));
  assert(d.text.startsWith("Hikmet Bey merhaba"), d.text);
}

console.log("rfq-whatsapp tests passed");
