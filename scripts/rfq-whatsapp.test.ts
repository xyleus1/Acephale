import assert from "node:assert/strict";
import { buildWhatsAppInquiry, waPhoneDigits } from "../src/lib/rfq-whatsapp";

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

// Phone normalization: international kept, TR local formats promoted, junk dropped.
assert.equal(waPhoneDigits("+962 79 818 5729"), "962798185729");
assert.equal(waPhoneDigits("0532 123 45 67"), "905321234567");
assert.equal(waPhoneDigits("532 123 45 67"), "905321234567");
assert.equal(waPhoneDigits("0049 170 1234567"), "491701234567");
assert.equal(waPhoneDigits("1234"), null);
assert.equal(waPhoneDigits(null), null);

console.log("rfq-whatsapp tests passed");
