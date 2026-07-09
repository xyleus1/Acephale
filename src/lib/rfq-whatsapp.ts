// Draft WhatsApp inquiry for an RFQ, in Turkish, asking only for what the
// load is still missing. Built next to the email drafts on the RFQ sheet;
// the operator sends it manually (copy, or the wa.me deep link) — nothing
// sends automatically. Tone and question set follow Oğuzhan's real outreach
// messages.

export type InquiryForWhatsApp = {
  origin: string | null;
  destination: string | null;
  mode: string | null;
  commodity: string | null;
  containerType: string | null;
  containerCount: number | null;
  packages: number | null;
  weight: number | null;
  volume: number | null;
  dimensions: string | null;
  cargoReadyDate: Date | null;
  parsedData: string | null;
};

export type WhatsAppDraft = {
  phoneDisplay: string | null;
  waUrl: string | null;
  text: string;
  // English labels of what the message asks for, for UI chrome.
  missing: string[];
};

function parsedOf(inq: { parsedData: string | null }): Record<string, unknown> {
  if (!inq.parsedData) return {};
  try {
    const value = JSON.parse(inq.parsedData);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function s(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function capTr(value: string): string {
  return value.charAt(0).toLocaleUpperCase("tr-TR") + value.slice(1);
}

// "emre yılmaz" → "Emre"; initials and single letters fall back to the
// generic greeting rather than producing "M. Bey".
function firstNameOf(fullName: string | null): string | null {
  if (!fullName) return null;
  const first = fullName.trim().split(/\s+/)[0] ?? "";
  if (first.replace(/[^\p{L}]/gu, "").length < 2) return null;
  const lower = first.toLocaleLowerCase("tr-TR");
  return lower.charAt(0).toLocaleUpperCase("tr-TR") + lower.slice(1);
}

function hasDimensions(json: string | null): boolean {
  if (!json) return false;
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) && arr.length > 0;
  } catch {
    return false;
  }
}

// "a", "a ve b", "a, b ve c" — natural Turkish list join.
function joinTr(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} ve ${parts[parts.length - 1]}`;
}

// Leads often type a bare country ("Almanya", "ürdün") as origin/destination.
// A country-only endpoint can't be priced, so the draft asks for the exact
// point — mirroring the desk's real follow-up questions. Keys are lowercased
// with the tr locale and dotless-ı folded to i; common ASCII spellings are
// listed alongside the Turkish ones.
const COUNTRY_ONLY = new Set([
  "türkiye", "turkiye", "turkey",
  "almanya", "germany", "deutschland",
  "fransa", "france",
  "italya", "italy",
  "ispanya", "spain",
  "portekiz", "portugal",
  "hollanda", "netherlands",
  "belçika", "belcika", "belgium",
  "ingiltere", "england", "uk", "united kingdom", "birleşik krallik", "birlesik krallik",
  "irlanda", "ireland",
  "polonya", "poland",
  "romanya", "romania",
  "bulgaristan", "bulgaria",
  "yunanistan", "greece",
  "avusturya", "austria",
  "isviçre", "isvicre", "switzerland",
  "isveç", "isvec", "sweden",
  "norveç", "norvec", "norway",
  "danimarka", "denmark",
  "finlandiya", "finland",
  "çekya", "cekya", "czechia", "çek cumhuriyeti", "cek cumhuriyeti",
  "macaristan", "hungary",
  "slovakya", "slovakia",
  "slovenya", "slovenia",
  "hirvatistan", "croatia",
  "sirbistan", "serbia",
  "bosna", "bosna hersek", "bosnia",
  "makedonya", "kuzey makedonya", "macedonia",
  "kosova", "kosovo",
  "arnavutluk", "albania",
  "karadağ", "karadag", "montenegro",
  "litvanya", "lithuania",
  "letonya", "latvia",
  "estonya", "estonia",
  "ukrayna", "ukraine",
  "rusya", "russia",
  "belarus", "beyaz rusya",
  "moldova",
  "gürcistan", "gurcistan", "georgia",
  "azerbaycan", "azerbaijan",
  "ermenistan", "armenia",
  "kazakistan", "kazakhstan",
  "özbekistan", "ozbekistan", "uzbekistan",
  "türkmenistan", "turkmenistan",
  "kirgizistan", "kyrgyzstan",
  "tacikistan", "tajikistan",
  "irak", "iraq",
  "iran",
  "suriye", "syria",
  "ürdün", "urdun", "jordan",
  "israil", "israel",
  "lübnan", "lubnan", "lebanon",
  "filistin", "palestine",
  "misir", "mısır", "egypt",
  "libya",
  "tunus", "tunisia",
  "cezayir", "algeria",
  "fas", "morocco",
  "sudan",
  "suudi arabistan", "saudi arabia",
  "bae", "uae", "emirates", "birleşik arap emirlikleri", "birlesik arap emirlikleri",
  "katar", "qatar",
  "kuveyt", "kuwait",
  "umman", "oman",
  "bahreyn", "bahrain",
  "yemen",
  "abd", "amerika", "usa", "united states", "amerika birleşik devletleri", "amerika birlesik devletleri",
  "kanada", "canada",
  "meksika", "mexico",
  "brezilya", "brazil",
  "arjantin", "argentina",
  "şili", "sili", "chile",
  "kolombiya", "colombia",
  "çin", "cin", "china",
  "hindistan", "india",
  "pakistan",
  "bangladeş", "banglades", "bangladesh",
  "japonya", "japan",
  "güney kore", "guney kore", "kore", "south korea", "korea",
  "tayvan", "taiwan",
  "endonezya", "indonesia",
  "malezya", "malaysia",
  "singapur", "singapore",
  "tayland", "thailand",
  "vietnam",
  "filipinler", "philippines",
  "avustralya", "australia",
  "yeni zelanda", "new zealand",
  "güney afrika", "guney afrika", "south africa",
  "nijerya", "nigeria",
  "kenya",
  "etiyopya", "ethiopia",
  "gana", "ghana",
  "kibris", "kktc", "cyprus",
  "avrupa", "europe", "avrupa birliği", "avrupa birligi",
  "yurtdişi", "yurtdisi",
]);

function isCountryOnly(value: string | null): boolean {
  if (!value) return false;
  const norm = value.trim().toLocaleLowerCase("tr-TR").replace(/ı/g, "i");
  return COUNTRY_ONLY.has(norm);
}

// wa.me wants the full international number, digits only. Lead phones arrive
// as +962…, 0532…, or bare 5XX… — the last two are treated as Turkish.
export function waPhoneDigits(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const international = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  if (!international) {
    if (digits.startsWith("00")) digits = digits.slice(2);
    else if (digits.length === 11 && digits.startsWith("0")) digits = `9${digits}`;
    else if (digits.length === 10 && digits.startsWith("5")) digits = `90${digits}`;
  }
  return digits.length >= 10 ? digits : null;
}

// "whatsapp:905301234567" (thread/message address form) → wa-ready digits.
export function waDigitsFromWhatsAppAddress(address: string | null | undefined): string | null {
  if (!address || !address.startsWith("whatsapp:")) return null;
  return waPhoneDigits(`+${address.slice("whatsapp:".length).replace(/\D/g, "")}`);
}

// Inquiries born from a WhatsApp thread know their counterparty from the
// sender address — seed parsedData.phone/fullName so the RFQ sheet's WhatsApp
// draft (and the send action) has a recipient without re-asking the AI.
export function seedWhatsAppLeadFields(
  parsed: Record<string, unknown>,
  sender: { fromEmail: string | null; fromName: string | null },
): Record<string, unknown> {
  const digits = waDigitsFromWhatsAppAddress(sender.fromEmail);
  if (!digits) return parsed;
  const next = { ...parsed };
  if (!s(next.phone)) next.phone = `+${digits}`;
  if (!s(next.fullName) && sender.fromName?.trim()) next.fullName = sender.fromName.trim();
  return next;
}

function equipmentPhrase(inq: InquiryForWhatsApp): string | null {
  const type = s(inq.containerType);
  if (!type) return null;
  const count = inq.containerCount ?? 1;
  const label = count > 1 ? `${count}×${type}` : type;
  return /konteyner|container/i.test(type) ? label : `${label} konteyner`;
}

export function buildWhatsAppInquiry(inq: InquiryForWhatsApp): WhatsAppDraft {
  const parsed = parsedOf(inq);
  const phone = s(parsed.phone);
  const firstName = firstNameOf(s(parsed.fullName));

  const isFcl = Boolean(s(inq.containerType));
  const dims = hasDimensions(inq.dimensions);
  const origin = s(inq.origin);
  const destination = s(inq.destination);

  const questions: string[] = [];
  const missing: string[] = [];

  if (!s(inq.commodity)) {
    questions.push("Taşınacak ürün nedir?");
    missing.push("commodity");
  }

  // A booked container prices without piece-level measurements; loose cargo
  // doesn't — this is the desk's most common WhatsApp follow-up.
  if (!isFcl) {
    const bits: string[] = [];
    if (!dims && inq.volume == null) {
      bits.push("ölçülerini (en, boy, yükseklik)");
      missing.push("dimensions");
    }
    if (inq.weight == null) {
      bits.push("toplam ağırlığını");
      missing.push("weight");
    }
    if (!dims && inq.packages == null) {
      bits.push("parça sayısını");
      missing.push("piece count");
    }
    if (bits.length > 0) questions.push(`Yükün ${joinTr(bits)} iletebilir misiniz?`);
  }

  if (!origin && !destination) {
    questions.push("Alım ve teslim adreslerini tam adres olarak iletebilir misiniz?");
    missing.push("pickup address", "delivery address");
  } else {
    if (!origin) {
      questions.push("Yükün alınacağı tam adresi iletebilir misiniz?");
      missing.push("pickup address");
    } else if (isCountryOnly(origin)) {
      questions.push("Yükün tam çıkış noktası neresi olacak?");
      missing.push("exact origin");
    }
    if (!destination) {
      questions.push("Teslimat yapılacak tam adresi iletebilir misiniz?");
      missing.push("delivery address");
    } else if (isCountryOnly(destination)) {
      questions.push("Yükün tam varış noktası neresi olacak?");
      missing.push("exact destination");
    }
  }

  if (!inq.cargoReadyDate) {
    questions.push("Yük ne zaman hazır olacak?");
    missing.push("cargo ready date");
  }

  const greeting = firstName
    ? `${firstName} Bey merhaba, ben Derya Lojistik'ten Oğuzhan.`
    : "Merhaba, ben Derya Lojistik'ten Oğuzhan.";

  const lane = [origin, destination].filter(Boolean).join(" - ");
  const equip = equipmentPhrase(inq);
  const commodity = s(inq.commodity);
  const subjectPhrase = lane
    ? `${lane}${equip ? ` ${equip}` : ""} ${inq.mode === "AIR" ? "havayolu gönderiniz" : "yükünüz"}`
    : commodity
      ? `${commodity} gönderiniz`
      : "taşıma talebiniz";

  const intro = questions.length > 0
    ? `${capTr(subjectPhrase)} için yazıyorum, eksik birkaç detayı iletebilirseniz hemen fiyat çalışacağım.`
    : `${capTr(subjectPhrase)} için yazıyorum. Bilgileriniz elimizde, en kısa sürede fiyatı ileteceğim.`;

  const text = [`${greeting} ${intro}`, ...(questions.length > 0 ? [questions.join("\n")] : [])].join("\n\n");

  const digits = waPhoneDigits(phone);
  return {
    phoneDisplay: phone,
    waUrl: digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null,
    text,
    missing,
  };
}
