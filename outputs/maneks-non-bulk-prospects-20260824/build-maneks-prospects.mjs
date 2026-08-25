import fs from "node:fs";
import path from "node:path";

const outputDir = path.dirname(new URL(import.meta.url).pathname);
const sourcePath = path.resolve(
  outputDir,
  "../bourne-sourcing-upload-20260822/bourne-procurement-sources-net-new-9802.csv",
);
const outputPath = path.join(outputDir, "maneks-non-bulk-prospects.csv");

const headers = [
  "company_name",
  "country",
  "city",
  "segment",
  "website",
  "domain",
  "what_they_buy",
  "size_signal",
  "general_email",
  "contact_name",
  "contact_title",
  "contact_email",
  "phone",
  "whatsapp",
  "language",
  "evidence_urls",
  "source_query",
  "notes",
];

const segments = {
  service:
    "steel service centers, coil processors, slitting and cut-to-length lines",
  fabricator:
    "metal fabricators, machine shops, sheet metal and laser cutting shops",
  pipe: "pipe, tube and profile producers",
  machinery: "machinery, equipment and vehicle-body manufacturers",
  construction:
    "construction, infrastructure and precast contractors that buy rebar, plate or profile",
  foundry:
    "foundries, smelters and ferroalloy plants (for iron, chrome and manganese ore)",
  distributor:
    "regional steel stockists, distributors and small importing traders",
  freight:
    "container and breakbulk freight-forwarding importers who buy on their own account",
};

const languageByCountry = {
  Algeria: "fr",
  Belgium: "fr",
  Brazil: "pt",
  Bulgaria: "bg",
  China: "zh",
  Colombia: "es",
  "Dominican Republic": "es",
  Egypt: "ar",
  Georgia: "ka",
  Germany: "de",
  Greece: "el",
  India: "en",
  Italy: "it",
  Malta: "en",
  Mexico: "es",
  Morocco: "fr",
  Netherlands: "nl",
  Oman: "en",
  Pakistan: "en",
  Panama: "es",
  Poland: "pl",
  Portugal: "pt",
  Romania: "ro",
  Russia: "ru",
  "Saudi Arabia": "en",
  Spain: "es",
  Trinidad: "en",
  "Trinidad and Tobago": "en",
  Tunisia: "fr",
  Turkey: "tr",
  Ukraine: "uk",
  "United Arab Emirates": "en",
  Venezuela: "es",
  Vietnam: "vi",
};

function parseCsv(input) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...data] = rows;
  return data
    .filter((values) => values.some(Boolean))
    .map((values) => Object.fromEntries(header.map((key, i) => [key, values[i] ?? ""])));
}

function clean(value) {
  return String(value ?? "")
    .replaceAll("\u2014", "-")
    .replaceAll("\u2013", "-")
    .replace(/\s+/g, " ")
    .trim();
}

function domainFromUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function evidence(...urls) {
  return [...new Set(urls.map(clean).filter((url) => /^https?:\/\//.test(url)))].slice(0, 3).join(" ");
}

function csvCell(value) {
  const normalized = clean(value);
  return /[",\n]/.test(normalized) ? `"${normalized.replaceAll('"', '""')}"` : normalized;
}

function segmentFor(category) {
  const text = category.toLowerCase();
  if (/service cent|slitting|blanking|cut.to.length|coil processing|decoil/.test(text) && !/machinery|machine|equipment|production line/.test(text)) return segments.service;
  if (/pipe|tube|tubing|hollow section|profile producer|extruded profile/.test(text)) return segments.pipe;
  if (/foundr|casting|cast iron|cast steel|forging|ferroalloy|smelt/.test(text)) return segments.foundry;
  if (/construction|infrastructure|precast|prefabricated building|steel structure/.test(text)) return segments.construction;
  if (/vehicle|automotive|tractor|truck|trailer|equipment|machine tool|machinery|pump|valve|fastener|press|stamping|aerospace/.test(text)) return segments.machinery;
  if (/machining|cnc|fabricat|metalwork|sheet.metal|laser|weld|tooling|dies|molds|moulds/.test(text)) return segments.fabricator;
  if (/stockist|distribut|trader|trading|wholesale|industrial metals/.test(text)) return segments.distributor;
  return "";
}

function productsFor(segment, category, evidenceNote = "") {
  const text = `${category} ${evidenceNote}`.toLowerCase();
  if (/fastener|nut|bolt|screw|washer|cold head/.test(text)) {
    return "steel wire rod, cold-heading-quality wire, steel bar";
  }
  if (/pump|valve/.test(text)) {
    return "cast iron, steel bar, plate, pipe";
  }
  if (segment === segments.service) {
    if (/stainless/.test(text)) return "stainless steel coil, sheet and strip";
    return "hot rolled coil, cold rolled coil, galvanized coil, steel sheet";
  }
  if (segment === segments.pipe) return "hot rolled coil, steel strip, plate";
  if (segment === segments.foundry) {
    if (/alumin/.test(text)) return "steel tooling, molds and ferrous machine components";
    return "pig iron, ferromanganese, ferrochrome, steel feedstock";
  }
  if (segment === segments.construction) return "rebar, structural plate, beams, hollow sections";
  if (segment === segments.fabricator) {
    if (/tool|die|mold|mould/.test(text)) return "tool steel, alloy steel bar, plate";
    if (/machin|cnc/.test(text)) return "steel bar, plate, tube, special steel";
    return "steel sheet, plate, tube, profile";
  }
  if (segment === segments.machinery) {
    if (/automotive|vehicle|tractor|truck|trailer/.test(text)) return "cold rolled coil, galvanized sheet, bar, tube";
    return "steel plate, bar, sheet, tube, special steel";
  }
  if (segment === segments.distributor) return "rebar, plate, coil, tube, profile";
  return "steel plate, coil, tube, profile";
}

function relevanceScore(row) {
  const text = `${row.category} ${row.evidence_note} ${row.source_name}`.toLowerCase();
  if (!segmentFor(row.category)) return -100;
  if (/integrated flat steel|integrated steel|steel.producing member|steel mill|blast furnace|electric arc furnace/.test(text)) return -100;
  if (/scrap.yard|scrap dealer|real estate|tourism|retail store/.test(text)) return -100;
  if (/automotive replacement parts, components, and industrial hardware/.test(row.category.toLowerCase())) return -100;
  if (/machine tools, metalworking, and fabrication equipment/.test(row.category.toLowerCase())) return -100;
  if (/medical gas regulators|biomedical equipment assembly/.test(row.category.toLowerCase())) return -100;
  if (/semiconductor|wafer foundry|hydrogen|electroly[sz]er|gas and hydrogen pipeline|pipeline transport|energy infrastructure|bulk-liquid and gas terminal/.test(text)) return -100;
  if (/zinc and lead smelting|copper smelting/.test(text)) return -100;
  if (/railway infrastructure construction, operation, and maintenance/.test(text)) return -100;
  if (/eurofer official steel-producing members directory/.test(text)) return -100;
  if (/steel billets/.test(row.category.toLowerCase()) && /rebar|reinforcing steel|wire rod|merchant bars/.test(row.category.toLowerCase())) return -100;
  if (/adhesive|abrasive|plastic|polymer|rubber|paper|packaging|printing|software|robot|sensor|electronics|electrical control|metrology|inspection|refractor|chemical|battery|lighting|telecommunication|pharmaceutical|glass|composite/.test(text)) return -40;
  if (/aluminium|aluminum/.test(text) && !/steel|ferrous|tooling|mold|mould|machinery|equipment/.test(text)) return -30;

  let score = 0;
  if (/steel service|slitt|blanking|cut.to.length|coil process/.test(text)) score += 14;
  if (/foundr|cast iron|steel casting|ferrous casting|forging/.test(text)) score += 16;
  if (/precision machin|cnc machin|sheet.metal|metal fabricat|metalwork|tooling|tool and die|dies and molds|dies and moulds/.test(text)) score += 11;
  if (/pipe|tube|hollow section|steel profile/.test(text)) score += 9;
  if (/vehicle|automotive|tractor|truck|trailer/.test(text)) score += 8;
  if (/machinery|machine tool|industrial equipment|pump|valve|fastener/.test(text)) score += 6;
  if (/construction|infrastructure|steel structure|precast/.test(text)) score += 6;
  if (/manufactur|production facility|fabricates|fabrication shop/.test(text)) score += 4;
  if (/steel|ferrous|iron|metal/.test(text)) score += 3;
  if (/official association|official member|official company|official exhibitor/.test(text)) score += 2;
  if (row.seed_quality === "A") score += 2;
  if (row.seed_quality === "B") score += 1;
  return score;
}

const existingQuotas = {
  Italy: 25,
  Brazil: 25,
  India: 25,
  Germany: 25,
  Vietnam: 20,
  Spain: 20,
  Turkey: 20,
  Egypt: 15,
  Poland: 20,
  Portugal: 15,
  Romania: 15,
  Mexico: 10,
  Morocco: 8,
  Pakistan: 10,
  Netherlands: 2,
  Bulgaria: 5,
  Colombia: 2,
  Oman: 5,
  "United Arab Emirates": 3,
  "Trinidad and Tobago": 2,
  Belgium: 1,
  China: 5,
};

function curated(row) {
  const website = clean(row.website);
  return {
    company_name: clean(row.company_name),
    country: clean(row.country),
    city: clean(row.city),
    segment: row.segment,
    website,
    domain: clean(row.domain || domainFromUrl(website)),
    what_they_buy: clean(row.what_they_buy),
    size_signal: clean(row.size_signal),
    general_email: clean(row.general_email),
    contact_name: "",
    contact_title: "",
    contact_email: clean(row.contact_email),
    phone: clean(row.phone),
    whatsapp: clean(row.whatsapp),
    language: clean(row.language || languageByCountry[row.country] || "en"),
    evidence_urls: evidence(...row.evidence_urls),
    source_query: clean(row.source_query),
    notes: clean(row.notes),
  };
}

const webRows = [
  curated({ company_name: "ININCA Instalaciones Industriales", country: "Venezuela", city: "", segment: segments.fabricator, website: "https://ininca.com.ve/", what_they_buy: "carbon steel plate, stainless steel sheet, pipe, structural profile", evidence_urls: ["https://ininca.com.ve/"], source_query: "Venezuela empresa fabricación estructuras metálicas acero tanques tuberías sitio oficial", notes: "Industrial structures, pressure vessels and tanks. Sanctions and counterparty screening required before any trade or outreach." }),
  curated({ company_name: "INGIMEC, C.A.", country: "Venezuela", city: "", segment: segments.fabricator, website: "https://www.ingimecca.com/", what_they_buy: "structural plate, pressure pipe, steel profile", evidence_urls: ["https://www.ingimecca.com/"], source_query: "Venezuela empresa fabricación estructuras metálicas acero tanques tuberías sitio oficial", notes: "Fabricates and erects steel structures and pressure piping. Sanctions and counterparty screening required." }),
  curated({ company_name: "VHICOA", country: "Venezuela", city: "Puerto Ordaz", segment: segments.fabricator, website: "https://www.vhicoa.com/", what_they_buy: "heavy structural plate, beams, pressure-vessel plate", evidence_urls: ["https://www.vhicoa.com/"], source_query: "Venezuela metalmecánica fabricación acero empresa Valencia Puerto Cabello", notes: "Heavy steel structures and pressure vessels near the Orinoco industrial corridor. Sanctions and counterparty screening required." }),
  curated({ company_name: "Industrias Acero Placencia, C.A. (IAPCA)", country: "Venezuela", city: "Valencia", segment: segments.machinery, website: "https://iapca.com.ve/", what_they_buy: "carbon steel plate, stainless steel plate and sheet", size_signal: "approximately 8,000 m2 facility", phone: "+58 414 481 7397", evidence_urls: ["https://iapca.com.ve/informacion-general/"], source_query: "Venezuela metalmecánica fabricación acero empresa Valencia Puerto Cabello", notes: "Builds pressure vessels, reactors, columns, tanks and process equipment. Sanctions and counterparty screening required." }),
  curated({ company_name: "Taller Industrial Metalúrgico Antonio, C.A. (TIMACA)", country: "Venezuela", city: "", segment: segments.fabricator, website: "https://www.timaca.com.ve/", what_they_buy: "structural plate, beams, profiles", evidence_urls: ["https://www.timaca.com.ve/Brochure_Timaca_2016.pdf"], source_query: "Venezuela empresa fabricación estructuras metálicas acero tanques tuberías sitio oficial", notes: "Public company brochure documents steel structures, containers, walkways and tanks. Sanctions and counterparty screening required." }),

  curated({ company_name: "Fast-Tec Estructuras", country: "Panama", city: "Panama City", segment: segments.construction, website: "https://fast-tec.com/", what_they_buy: "galvanized Zn-Al-Mg coil, structural profile", evidence_urls: ["https://fast-tec.com/"], source_query: "Panama empresa estructuras metalicas fabricación acero perfiles sitio web", notes: "Cold-forms galvanized structural profiles and prefabricated bolted steel structures for regional projects." }),
  curated({ company_name: "Lasco Compa", country: "Panama", city: "Panama City", segment: segments.fabricator, website: "https://lascocompa.com/", what_they_buy: "structural plate, beams, hollow sections", evidence_urls: ["https://lascocompa.com/"], source_query: "Panama empresa estructuras metalicas fabricación acero perfiles sitio web", notes: "Fabricator located in PanaPark Free Zone, useful for container and regional distribution access." }),
  curated({ company_name: "Industrias Correagua", country: "Panama", city: "Panama City", segment: segments.pipe, website: "https://correagua.com/", what_they_buy: "galvanized coil, steel sheet, beams, tube", phone: "+507 231 0455", size_signal: "operating since 1962", evidence_urls: ["https://correagua.com/"], source_query: "Panama empresa estructuras metalicas fabricación acero perfiles sitio web", notes: "Produces steel structures, roofing, shelving and tanks and sells smaller-order construction products." }),
  curated({ company_name: "NewCon Steel", country: "Panama", city: "Panama City", segment: segments.pipe, website: "https://www.newconsteel.com/", what_they_buy: "Zn-Al-Mg coated steel coil", general_email: "info@newconsteel.com", phone: "+507 6608 8555", whatsapp: "+507 6608 8555", evidence_urls: ["https://www.newconsteel.com/"], source_query: "Panama empresa estructuras metalicas fabricación acero perfiles sitio web", notes: "CNC cold-forming line consumes 0.85 to 2.5 mm coated coil for LGS/CFS profiles and kits." }),
  curated({ company_name: "Panaweb Soluciones Constructivas", country: "Panama", city: "Panama City", segment: segments.fabricator, website: "https://www.panawebsc.com/", what_they_buy: "structural plate, beams, profiles, pipe", phone: "+507 393 0645", evidence_urls: ["https://www.panawebsc.com/estructuras-metalicas"], source_query: "Panama empresa estructuras metalicas fabricación acero perfiles sitio web", notes: "Fabricates structures, bridges, tanks, gates and special piping for Central America." }),
  curated({ company_name: "Galvanizadora Civelmec", country: "Panama", city: "", segment: segments.fabricator, website: "https://www.galvanizadoracivelmec.com/", what_they_buy: "structural plate, profiles, fabricated steel", phone: "+507 310 8676", whatsapp: "+507 6276 3031", evidence_urls: ["https://www.galvanizadoracivelmec.com/"], source_query: "Panama empresa estructuras metalicas fabricación acero perfiles sitio web", notes: "In-house metal fabrication and hot-dip galvanizing." }),
  curated({ company_name: "APRA Ingeniería, S.A.", country: "Panama", city: "Panama City", segment: segments.fabricator, website: "https://apraing.com/", what_they_buy: "structural plate, beams, profiles", evidence_urls: ["https://apraing.com/"], source_query: "Panama empresa estructuras metalicas fabricación acero perfiles sitio web", notes: "Own fabrication shop with CNC plasma, saws, punch and welding equipment." }),
  curated({ company_name: "Formetal Panamá", country: "Panama", city: "Panama City", segment: segments.fabricator, website: "https://formetalpanama.com/", what_they_buy: "galvanized sheet, stainless steel sheet, light-gauge profile", general_email: "info@formetalpanama.com", phone: "+507 307 8544", whatsapp: "+507 6670 7408", size_signal: "operating since 1946", evidence_urls: ["https://formetalpanama.com/"], source_query: "Panama empresa estructuras metalicas fabricación acero perfiles sitio web", notes: "Produces doors, ducts, roofing and light-gauge steel structures." }),
  curated({ company_name: "Steel Buildings & Bridges Corp", country: "Panama", city: "", segment: segments.fabricator, website: "https://sbb.com.pa/", what_they_buy: "structural plate, beams, profiles", evidence_urls: ["https://sbb.com.pa/servicios/estructuras-metalicas/"], source_query: "Panama empresa estructuras metalicas fabricación acero perfiles sitio web", notes: "Designs, fabricates and erects large steel structures." }),

  curated({ company_name: "Tinmeca", country: "Dominican Republic", city: "", segment: segments.fabricator, website: "https://tinmeca.com.do/", what_they_buy: "structural plate, steel pipe, sheet", evidence_urls: ["https://tinmeca.com.do/"], source_query: "Republica Dominicana empresa fabricación estructuras metálicas acero inox metalmecánica sitio oficial", notes: "Industrial workshop for structures, special steel pipe, tanks, cutting and bending." }),
  curated({ company_name: "FRACORP Constructions", country: "Dominican Republic", city: "Santo Domingo", segment: segments.construction, website: "https://www.fracorp.com.do/", what_they_buy: "galvanized light-gauge steel, structural profile", general_email: "info@fracorprd.com", phone: "+1 809 770 1187", evidence_urls: ["https://www.fracorp.com.do/estructuras-metalicas"], source_query: "Dominican Republic metal fabrication steel structures company Santo Domingo", notes: "Designs, fabricates and installs steel framing and industrial structures." }),
  curated({ company_name: "Proacero SRL", country: "Dominican Republic", city: "Santo Domingo", segment: segments.fabricator, website: "https://www.proacero.com.do/", what_they_buy: "structural plate, beams, profiles", general_email: "info@proacero.com.do", phone: "+1 809 332 1653", evidence_urls: ["https://www.proacero.com.do/"], source_query: "Dominican Republic metal fabrication steel structures company Santo Domingo", notes: "Designs, fabricates and installs steel structures." }),
  curated({ company_name: "Hardom", country: "Dominican Republic", city: "Santo Domingo", segment: segments.construction, website: "https://hardom.com.do/", what_they_buy: "structural plate, beams, profiles", general_email: "hardom_@hotmail.com", phone: "+1 809 567 1288", size_signal: "more than 20 years in market", evidence_urls: ["https://hardom.com.do/"], source_query: "Dominican Republic metal fabrication steel structures company Santo Domingo", notes: "Builds industrial buildings, mezzanines and steel structures." }),
  curated({ company_name: "Ingeniería Metálica SRL", country: "Dominican Republic", city: "Santo Domingo", segment: segments.fabricator, website: "https://ingenieriametalica.com/", domain: "ingenieriametalica.com", what_they_buy: "structural plate, beams, profiles", general_email: "info@ingenieriametalica.com.do", phone: "+1 809 536 7958", size_signal: "more than 40 years of experience", evidence_urls: ["https://ingenieriametalica.com/"], source_query: "Dominican Republic metal fabrication steel structures company Santo Domingo", notes: "Fabricates small, medium and large steel structures for industrial and civil projects." }),
  curated({ company_name: "Acero del Caribe, SRL", country: "Dominican Republic", city: "Santo Domingo", segment: segments.fabricator, website: "https://acerodelcaribe.com/", what_they_buy: "structural plate, steel sheet, C and Z purlins, tube", general_email: "oficina@acerodelcaribe.com", phone: "+1 829 535 0022", evidence_urls: ["https://acerodelcaribe.com/servicios.php"], source_query: "Dominican Republic metal fabrication steel structures company Santo Domingo", notes: "Fabricates structures, tanks, roofing sheet and project hardware." }),
  curated({ company_name: "Blue Steel S.A.S.", country: "Dominican Republic", city: "Santo Domingo", segment: segments.fabricator, website: "https://bluesteel.do/", what_they_buy: "structural plate, beams, profiles", general_email: "info@bluesteel.do", phone: "+1 809 286 0101", size_signal: "500 t/month fabrication capacity; 3,600 m2 facility", evidence_urls: ["https://bluesteel.do/"], source_query: "Dominican Republic metal fabrication steel structures company Santo Domingo", notes: "Direct supplier relationships and stated monthly fabrication capacity make it a clear steel buyer." }),
  curated({ company_name: "Grúas y Servicios Electromecánicos (GYSEM)", country: "Dominican Republic", city: "Santo Domingo", segment: segments.fabricator, website: "https://www.gysem.com/", what_they_buy: "mild steel plate, stainless steel sheet, pipe, structural profile", general_email: "info@gysem.com", phone: "+1 809 683 2687", size_signal: "800 m2 workshop and warehouse", evidence_urls: ["https://www.gysem.com/en/"], source_query: "Dominican Republic metal fabrication steel structures company Santo Domingo", notes: "Fabricates mild-steel and stainless pipe and structures for industrial projects." }),

  curated({ company_name: "ALFAPIPE", country: "Algeria", city: "Algiers", segment: segments.pipe, website: "https://www.alfapipe.dz/", what_they_buy: "hot rolled coil, steel strip, plate", evidence_urls: ["https://www.alfapipe.dz/"], source_query: "Algeria steel fabrication tubes profiles company manufacturer", notes: "Spiral-welded steel pipe producer for hydrocarbon transport and water projects." }),
  curated({ company_name: "Profil Algeria", country: "Algeria", city: "Oran", segment: segments.pipe, website: "https://profilalgeria.com/", what_they_buy: "hot rolled coil, steel strip", evidence_urls: ["https://profilalgeria.com/dosyalar/pdf/profil-algeria2.pdf"], source_query: "Algeria steel fabrication tubes profiles company manufacturer", notes: "Public company profile documents square and rectangular tube and profile production." }),

  curated({ company_name: "EBA Industrie Métallique", country: "Tunisia", city: "", segment: segments.fabricator, website: "https://eba.com.tn/", what_they_buy: "mild steel sheet, stainless steel sheet, Hardox plate, tube, profile", evidence_urls: ["https://eba.com.tn/", "https://eba.com.tn/structure-metallique/"], source_query: "Tunisia société fabrication structures métalliques acier tubes profils", notes: "Laser, plasma, flame cutting, bending, rolling, machining and welding since 1993." }),
  curated({ company_name: "General Metallic Product (GMP)", country: "Tunisia", city: "Sfax", segment: segments.fabricator, website: "https://gmp-tunisia.com/", what_they_buy: "structural plate, beams, profiles", general_email: "direction@gmp-tunisia.com", phone: "+216 74 681 313", size_signal: "6,000 m2 facility; operating since 2006", evidence_urls: ["https://gmp-tunisia.com/"], source_query: "Tunisia société fabrication structures métalliques acier tubes profils", notes: "Two fabrication workshops plus blasting, painting and raw-material storage." }),
  curated({ company_name: "SICO", country: "Tunisia", city: "", segment: segments.fabricator, website: "https://www.sico.com.tn/", what_they_buy: "steel sheet, tube, profile", size_signal: "more than 23 years in operation", evidence_urls: ["https://www.sico.com.tn/"], source_query: "Tunisia société fabrication structures métalliques acier tubes profils", notes: "Sheet-metal subcontractor producing small and medium series with CNC laser, bending, welding and machining." }),
  curated({ company_name: "BRI Industries", country: "Tunisia", city: "Gabès", segment: segments.fabricator, website: "https://www.bri-industries.com/", what_they_buy: "structural plate, pressure-vessel plate, pipe, profiles", size_signal: "70 employees; approximately 6,500 m2 covered workshops", general_email: "bri@gnet.tn", phone: "+216 75 275 611", evidence_urls: ["https://www.bri-industries.com/"], source_query: "Tunisia société fabrication structures métalliques acier tubes profils", notes: "Near Gabès port industrial zone; steel construction, pressure equipment and piping." }),
  curated({ company_name: "SOTIG Tunisie", country: "Tunisia", city: "", segment: segments.fabricator, website: "https://sotigtunisie.com/", what_they_buy: "structural plate, steel pipe, profiles", size_signal: "operating since 2007", evidence_urls: ["https://sotigtunisie.com/"], source_query: "Tunisia société fabrication structures métalliques acier tubes profils", notes: "Construction, boiler work, machining, material handling and industrial piping." }),
  curated({ company_name: "Fabre Metal", country: "Tunisia", city: "", segment: segments.construction, website: "https://fabre-metal.com/", what_they_buy: "structural plate, beams, profiles", evidence_urls: ["https://fabre-metal.com/"], source_query: "Tunisia société fabrication structures métalliques acier tubes profils", notes: "Fabricates and erects custom steel frames for industrial, commercial and civil projects." }),
  curated({ company_name: "TEM TRUSS", country: "Tunisia", city: "Sfax", segment: segments.fabricator, website: "https://www.tem-truss.com/", what_they_buy: "structural steel, sheet, tube, profile", size_signal: "operating since 1997", evidence_urls: ["https://www.tem-truss.com/wp-content/uploads/2023/05/CATALOGUE-2023.pdf"], source_query: "Tunisia société fabrication structures métalliques acier tubes profils", notes: "Workshop makes steel structures, supports, stages and metal furniture." }),

  curated({ company_name: "Zaminox Enterprise Limited", country: "Malta", city: "Marsa", segment: segments.fabricator, website: "https://zaminox.com/", what_they_buy: "mild steel sheet, stainless steel sheet, tube", general_email: "info@zaminox.com", phone: "+356 2124 4216", evidence_urls: ["https://zaminox.com/laser-cutting/"], source_query: "Malta steel fabrication company sheet metal laser cutting", notes: "Laser cutting, bending, welding, polishing and punching from 0.5 to 15 mm sheet." }),
  curated({ company_name: "JACAP Limited", country: "Malta", city: "Mosta", segment: segments.fabricator, website: "https://www.jacap.net/", what_they_buy: "mild steel sheet, stainless steel sheet, tube, profile", evidence_urls: ["https://www.jacap.net/home/"], source_query: "Malta steel fabrication company sheet metal laser cutting", notes: "Laser and plasma cutting, sheet guillotine, bending and custom fabrication." }),

  curated({ company_name: "Metal Holding", country: "Ukraine", city: "Kyiv", segment: segments.service, website: "https://en.metal-holding.ua/", domain: "metal-holding.ua", what_they_buy: "steel pipe, stainless steel sheet, construction steel, aluminum", size_signal: "service-center network in Kyiv, Dnipro, Lviv, Odesa and Kharkiv", evidence_urls: ["https://en.metal-holding.ua/"], source_query: "Ukraine steel service center metal fabrication pipe producer company", notes: "Wholesale and retail service-center network. War-zone logistics, sanctions and counterparty screening required." }),

  curated({ company_name: "Georgian Steel Engineering LLC", country: "Georgia", city: "", segment: segments.fabricator, website: "https://georgiansteel.ge/", what_they_buy: "structural plate, large-diameter pipe feedstock, beams, profiles", size_signal: "24+ years; 500+ completed projects; 70+ partners", evidence_urls: ["https://georgiansteel.ge/en"], source_query: "Georgia country steel fabrication company metal structures tubes", notes: "Factory reached full capacity in 2026 for steel structures, hydro equipment, tanks and large-diameter pipe." }),

  curated({ company_name: "LASAR Service Metal Center", country: "Russia", city: "", segment: segments.service, website: "https://lasar.ru/", what_they_buy: "hot rolled coil, cold rolled coil, galvanized coil, steel plate", size_signal: "300,000 m2 production and warehouse area", evidence_urls: ["https://lasar.ru/"], source_query: "россия сервисный металлоцентр лазерная резка листового металла компания", notes: "Slitting, cross-cutting, laser and plasma cutting, bending and punched sheet. Sanctions and counterparty screening required." }),
  curated({ company_name: "Service Metal Center Stami", country: "Russia", city: "Yekaterinburg", segment: segments.service, website: "https://www.stami.ru/", domain: "stami.ru", what_they_buy: "steel strip, sheet, welded tube", general_email: "info@stami.ru", phone: "+7 343 359 3925", evidence_urls: ["https://www.stami.ru/stami/factory/"], source_query: "россия сервисный металлоцентр лазерная резка листового металла компания", notes: "Slits strip, laser-cuts products and makes electric-welded tube. Sanctions and counterparty screening required." }),
  curated({ company_name: "KVIN Metal Center", country: "Russia", city: "Perm", segment: segments.service, website: "https://kvin.ru/", what_they_buy: "steel sheet, plate, tube, profile", contact_email: "zakaz@kvin.ru", phone: "+7 342 219 5660", evidence_urls: ["https://kvin.ru/metallocenter/catalog/%D0%9F%D1%80%D0%B0%D0%B9%D1%81%20%D0%9C%D0%B5%D1%82%D0%B0%D0%BB%D0%BB%D0%BE%D1%86%D0%B5%D0%BD%D1%82%D1%80%20%D0%9A%D0%92%D0%98%D0%9D%2018.11.pdf"], source_query: "россия сервисный металлоцентр лазерная резка листового металла компания", notes: "Public price list documents laser cutting and metal processing. Sanctions and counterparty screening required." }),
  curated({ company_name: "Globus-Stal", country: "Russia", city: "", segment: segments.service, website: "https://www.globus-stal.ru/", what_they_buy: "steel sheet, plate, tube, profile", evidence_urls: ["https://www.globus-stal.ru/imgs/GS_uslugi%20new%202025.pdf"], source_query: "россия сервисный металлоцентр лазерная резка листового металла компания", notes: "Public service-center presentation documents sheet and tube laser cutting. Sanctions and counterparty screening required." }),

  curated({ company_name: "G-Steel", country: "Greece", city: "Thessaloniki", segment: segments.fabricator, website: "https://g-steel.gr/", what_they_buy: "carbon steel sheet, stainless steel sheet, galvanized sheet, plate", phone: "+30 2310 705572", evidence_urls: ["https://g-steel.gr/en/laser-cutting/"], source_query: "Greece steel service center laser cutting sheet metal fabrication company", notes: "Two fiber lasers cut carbon steel to 40 mm plus tube cutting, bending, welding and punching." }),
  curated({ company_name: "Steel Service Center S.A.", country: "Greece", city: "Sindos", segment: segments.service, website: "https://kes.gr/", what_they_buy: "steel plate, profiles", size_signal: "24,000 t/year; 40 employees; 23,000 m2 site", evidence_urls: ["https://kes.gr/about-us-2/"], source_query: "Greece steel service center laser cutting sheet metal fabrication company", notes: "Near Thessaloniki transit; processes plate and profiles with CNC cutting, drilling, blasting and painting." }),
  curated({ company_name: "D. Giantsis & Co. S.A.", country: "Greece", city: "", segment: segments.fabricator, website: "https://giantsis.gr/", what_they_buy: "steel sheet, plate, profiles", evidence_urls: ["https://giantsis.gr/en/services-equipment"], source_query: "Greece steel service center laser cutting sheet metal fabrication company", notes: "Laser and plasma cutting, shearing and broader iron-processing equipment." }),

  curated({ company_name: "Lasere", country: "Belgium", city: "Namur", segment: segments.fabricator, website: "https://www.lasere.be/", what_they_buy: "S235 and S355 steel sheet, galvanized sheet, Corten plate, stainless sheet", phone: "+32 81 61 42 82", size_signal: "operating since 1991", evidence_urls: ["https://www.lasere.be/en/nos-services/"], source_query: "Belgium steel service center laser cutting sheet metal fabrication company", notes: "Stocks and processes steel by laser, waterjet and bending in Suarlée industrial zone." }),
  curated({ company_name: "Jaegerson nv", country: "Belgium", city: "Beernem", segment: segments.fabricator, website: "https://www.jaegerson.be/", what_they_buy: "steel sheet, stainless sheet, pipe, profiles", general_email: "info@jaegerson.be", phone: "+32 50 79 11 35", evidence_urls: ["https://www.jaegerson.be/en/productie/sheet-metal-processing"], source_query: "Belgium steel service center laser cutting sheet metal fabrication company", notes: "Produces small and large batches with laser cutting, punching, forming, sawing and welding." }),
  curated({ company_name: "MEBF meca SA", country: "Belgium", city: "Herstal", segment: segments.fabricator, website: "https://mebf.be/", what_they_buy: "steel sheet, stainless sheet, bar, plate", general_email: "web@mebf.be", phone: "+32 4 248 08 28", evidence_urls: ["https://mebf.be/en/"], source_query: "Belgium steel service center laser cutting sheet metal fabrication company", notes: "Machining and sheet-metal shop with laser, punching, folding, welding and assembly." }),

  curated({ company_name: "Den Oudsten Staalservice B.V.", country: "Netherlands", city: "Rhenen", segment: segments.service, website: "https://denoudsten.nl/", what_they_buy: "steel plate, sheet and profiles", general_email: "info@denoudsten.nl", phone: "+31 317 61 66 46", size_signal: "operating since 1993", evidence_urls: ["https://denoudsten.nl/en/"], source_query: "Netherlands steel service center sheet metal laser cutting company", notes: "Stocks standard and XXL plate and offers laser, plasma, bending, plate rolling and profile rolling." }),
  curated({ company_name: "MCB Nederland", country: "Netherlands", city: "Valkenswaard", segment: segments.service, website: "https://www.mcb.eu/", what_they_buy: "steel coil, stainless coil, sheet, tube, profiles", general_email: "verkoop@mcb.nl", phone: "+31 40 20 88 582", evidence_urls: ["https://www.mcb.eu/nl/maatwerk"], source_query: "Netherlands steel service center sheet metal laser cutting company", notes: "Slitting, decoiling, shearing, blasting, sawing and finishing; serves custom-size orders." }),
  curated({ company_name: "Dumaco Europe B.V.", country: "Netherlands", city: "Hardinxveld-Giessendam", segment: segments.fabricator, website: "https://www.dumaco.com/", what_they_buy: "steel sheet, plate, tube", general_email: "info@dumaco.com", phone: "+31 85 273 3317", evidence_urls: ["https://www.dumaco.com/en/operations/sheet-metal-working-laser-cutting"], source_query: "Netherlands steel service center sheet metal laser cutting company", notes: "Multi-site sheet-metal processor for single pieces through large series." }),

  curated({ company_name: "Metal Care Center FZC", country: "United Arab Emirates", city: "Sharjah", segment: segments.service, website: "https://www.metalcarecenter.com/", what_they_buy: "hot rolled coil, cold rolled coil, galvanized coil", general_email: "info@metalcarecenter.com", phone: "+971 6 526 9297", whatsapp: "+971 55 954 1094", evidence_urls: ["https://www.metalcarecenter.com/services_center.html"], source_query: "UAE steel service center coil processing slitting cut to length company", notes: "Hamriyah Free Zone facility with two cut-to-length lines and one slitting line; maximum coil weight 30 t." }),
  curated({ company_name: "Tee Dee International FZE", country: "United Arab Emirates", city: "Dubai", segment: segments.service, website: "https://teedee.ae/", what_they_buy: "HR, CRCA, GI, PPGI and stainless steel coil", general_email: "teedee@teedee.ae", phone: "+971 4 880 6761", whatsapp: "+971 50 408 4767", size_signal: "processes coils up to 25 t", evidence_urls: ["https://teedee.ae/coil-service-center/"], source_query: "UAE steel service center coil processing slitting cut to length company", notes: "Jebel Ali Free Zone stockist with slitting, cut-to-length and polishing." }),
  curated({ company_name: "Clever Metal Industries LLC", country: "United Arab Emirates", city: "Sharjah", segment: segments.service, website: "https://clevertrading.org/", what_they_buy: "HR, CR and GI coil, structural steel", contact_email: "nilesh@clevertrading.org", phone: "+971 6 577 8786", whatsapp: "+971 52 999 4440", size_signal: "operating since 1995", evidence_urls: ["https://clevertrading.org/"], source_query: "UAE steel service center coil processing slitting cut to length company", notes: "Importer, stockist and ERW pipe maker with slitting, recoiling and cut-to-length." }),
  curated({ company_name: "Modella Overseas", country: "United Arab Emirates", city: "", segment: segments.service, website: "https://modellaoverseas.com/", what_they_buy: "steel coil, stainless coil, galvanized coil", evidence_urls: ["https://modellaoverseas.com/services/"], source_query: "UAE steel service center coil processing slitting cut to length company", notes: "Coil service center supplying smaller sheet and strip requirements to stampers and equipment manufacturers." }),
  curated({ company_name: "BRS Steel Factory", country: "United Arab Emirates", city: "Ajman", segment: segments.service, website: "https://www.brsteeluae.com/", what_they_buy: "steel coil, sheet and strip", evidence_urls: ["https://www.brsteeluae.com/"], source_query: "UAE steel service center coil processing slitting cut to length company", notes: "Coil slitting, cutting and shearing from 0.3 to 4.0 mm and up to 1,550 mm width." }),
  curated({ company_name: "FISTCO Steel Service Center", country: "United Arab Emirates", city: "Dubai", segment: segments.service, website: "https://www.fistco.net/", what_they_buy: "hot rolled, cold rolled, galvanized, PPGI and Aluzinc coil", evidence_urls: ["https://www.fistco.net/services/coil-processing"], source_query: "UAE steel service center coil processing slitting cut to length company", notes: "Jebel Ali South center cuts, slits, recoils and downsizes master coils to 5 t." }),

  curated({ company_name: "Modern Metal Works LLC", country: "Oman", city: "Muscat", segment: segments.fabricator, website: "https://modmetaloman.com/", what_they_buy: "structural plate, beams, profiles, pipe", size_signal: "SME steel workshop operating since 2014", evidence_urls: ["https://modmetaloman.com/"], source_query: "Oman steel fabrication sheet metal service center company", notes: "Riyada SME steel workshop in Misfa Industrial Area." }),
  curated({ company_name: "Al Mada Steel Fabrication and Engineering Co. LLC", country: "Oman", city: "", segment: segments.fabricator, website: "https://www.almadallc.com/", what_they_buy: "structural plate, pipe, beams, profiles", evidence_urls: ["https://www.almadallc.com/"], source_query: "Oman steel fabrication sheet metal service center company", notes: "Fabrication and engineering company serving industrial projects including Duqm." }),

  curated({ company_name: "Khair Steel Industrial Company Ltd", country: "Saudi Arabia", city: "Jeddah", segment: segments.service, website: "https://khairsteel.com/", what_they_buy: "HR, CR, galvanized and pre-painted coil", general_email: "info@khairsteel.com", phone: "+966 12 659 6650", size_signal: "384,000 t/year service center; 124,000 t/year manufacturing", evidence_urls: ["https://khairsteel.com/"], source_query: "Saudi Arabia steel fabrication company sheet metal service center pipes profiles manufacturer", notes: "Large downstream service center and pipe producer; qualify whether part-cargo purchasing is handled locally." }),
  curated({ company_name: "Steel Corners for Operation and Maintenance", country: "Saudi Arabia", city: "Riyadh", segment: segments.distributor, website: "https://arkantekopm.com/", what_they_buy: "carbon steel and stainless pipe, plate, structural sections", general_email: "inquiries@arkantekom.com", phone: "+966 55 720 3021", evidence_urls: ["https://arkantekopm.com/"], source_query: "Saudi Arabia steel fabrication company sheet metal service center pipes profiles manufacturer", notes: "Fabricator, stockholder and supplier with pipe, tank, spool and structural work." }),
  curated({ company_name: "Fabrication & Engineering Technologies Company (FETCO)", country: "Saudi Arabia", city: "Dammam", segment: segments.fabricator, website: "https://fetco-sa.com/", what_they_buy: "carbon steel pipe, plate, structural sections", phone: "+966 59 881 8174", evidence_urls: ["https://fetco-sa.com/"], source_query: "Saudi Arabia steel fabrication company sheet metal service center pipes profiles manufacturer", notes: "Pipe-spool fabrication, steel fabrication and coating in Dammam." }),
  curated({ company_name: "Mian Muhammad & Company", country: "Saudi Arabia", city: "Medina", segment: segments.pipe, website: "https://www.mmcosteel.com/", what_they_buy: "hot rolled, cold rolled and galvanized coil", general_email: "mmco.madina@gmail.com", phone: "+966 54 217 0786", size_signal: "operating since 2010", evidence_urls: ["https://www.mmcosteel.com/"], source_query: "Saudi Arabia steel fabrication company sheet metal service center pipes profiles manufacturer", notes: "Produces GI, CRC, square and rectangular pipe plus profiles." }),
  curated({ company_name: "Arif Al Khayr Steel", country: "Saudi Arabia", city: "", segment: segments.pipe, website: "https://arifalkhayr.com/", what_they_buy: "hot rolled coil, galvanized coil, steel strip", size_signal: "operating since 1998", evidence_urls: ["https://arifalkhayr.com/services/"], source_query: "Saudi Arabia steel fabrication company sheet metal service center pipes profiles manufacturer", notes: "ERW round, square and rectangular pipe producer with nationwide distribution." }),
  curated({ company_name: "Alabuo Steel", country: "Saudi Arabia", city: "Riyadh", segment: segments.distributor, website: "https://alabuo.sa/", what_they_buy: "steel sheet, plate, pipe, tube, structural sections", phone: "+966 11 269 0999", evidence_urls: ["https://alabuo.sa/en/about"], source_query: "Saudi Arabia steel fabrication company sheet metal service center pipes profiles manufacturer", notes: "Saudi distributor and fabricator serving contractors; public page includes WhatsApp but number was not separately published." }),
  curated({ company_name: "Rafee Metal Industries", country: "Saudi Arabia", city: "Dammam", segment: segments.fabricator, website: "https://rafeemetal.com/", what_they_buy: "mild steel sheet, stainless steel sheet, plate, tube, channels", size_signal: "more than two decades of experience", evidence_urls: ["https://rafeemetal.com/"], source_query: "Saudi Arabia steel fabrication company sheet metal service center pipes profiles manufacturer", notes: "Light sheet-metal through heavy fabrication, laser cutting and section rolling." }),
  curated({ company_name: "ADPCO Metals Division", country: "Saudi Arabia", city: "Al Khobar", segment: segments.distributor, website: "https://www.asdpco.com/", what_they_buy: "plate, sheet, bars, pipe, tube, fittings, flanges, gratings", size_signal: "metals division operating since 2002", evidence_urls: ["https://www.asdpco.com/metals.html"], source_query: "Saudi Arabia steel fabrication company sheet metal service center pipes profiles manufacturer", notes: "Stocks steel for industrial, marine and construction buyers and also performs shearing, bending and fabrication." }),

  curated({ company_name: "Shanghai Prime Steel Corporation", country: "China", city: "Shanghai", segment: segments.service, website: "https://www.shanghaiprimesteel.com/", what_they_buy: "stainless steel coil, sheet and strip", phone: "+86 21 5948 1312", size_signal: "20,000 m2 site; 30,000 t stock", evidence_urls: ["https://www.shanghaiprimesteel.com/"], source_query: "Shanghai steel service center coil slitting cut to length company", notes: "Value-added stainless processor with slitting, cut-to-length, laser and plasma." }),
  curated({ company_name: "Daming Steel Processing", country: "China", city: "Wuxi", segment: segments.service, website: "https://www.dmsteels.com/", what_they_buy: "stainless and carbon steel coil and plate", general_email: "mpj@jsdmss.com", size_signal: "160,000 t stainless and 300,000 t carbon steel inventory", evidence_urls: ["https://www.dmsteels.com/products/ctlsl-service/"], source_query: "China coil processing center company slitting cut-to-length steel service center", notes: "Large service-center chain with 141 cut-to-length and slitting equipment sets; qualify local part-cargo buying authority." }),
  curated({ company_name: "China Steel Precision Metals Kunshan Co., Ltd.", country: "China", city: "Kunshan", segment: segments.service, website: "http://www.csc-csmk.com/", domain: "csc-csmk.com", what_they_buy: "steel and aluminum coil", size_signal: "more than 180,000 t/year; 26,000 m2 plant", phone: "+86 512 5760 1373", evidence_urls: ["https://www.csc.com.tw/csc_e/gc/gro_Log_p4.html"], source_query: "China coil processing center company slitting cut-to-length steel service center", notes: "Five cutting lines serving East China automotive, appliance and equipment customers." }),
  curated({ company_name: "Hunter Special Steel Co., Ltd.", country: "China", city: "Jinan", segment: segments.service, website: "https://www.huntersteels.com/", what_they_buy: "special steel coil and strip", evidence_urls: ["https://www.huntersteels.com/"], source_query: "China coil processing center company slitting cut-to-length steel service center", notes: "Slitting, blanking, cut-to-length, shearing, cold pressing and laser cutting." }),
  curated({ company_name: "Emerson Metal", country: "China", city: "Tianjin", segment: segments.fabricator, website: "https://www.emersonmetal.com/", what_they_buy: "carbon steel plate, alloy plate, cold rolled and galvanized sheet, bar and pipe", contact_email: "sai@emersonsteel.com", phone: "+86 22 8725 9592", whatsapp: "+86 135 1202 8034", evidence_urls: ["https://www.emersonmetal.com/"], source_query: "Tianjin steel fabrication service center plate laser cutting company", notes: "Seaport-city fabricator with laser, waterjet, flame cutting, machining and welding." }),
  curated({ company_name: "Aoxing Metal Service Center", country: "China", city: "", segment: segments.service, website: "https://www.aoxingmetal.com/", what_they_buy: "stainless steel coil and sheet", evidence_urls: ["https://www.aoxingmetal.com/service/"], source_query: "China coil processing center company slitting cut-to-length steel service center", notes: "Recoiling, slitting, leveling, cut-to-length and surface finishing for downstream equipment and fabrication customers." }),
  curated({ company_name: "Rigang Materials", country: "China", city: "", segment: segments.service, website: "https://rigangmaterials.com/", what_they_buy: "hot rolled, cold rolled and pickled coil", evidence_urls: ["https://rigangmaterials.com/products/carbon-steel/carbon-steel-coil/"], source_query: "China coil processing center company slitting cut-to-length steel service center", notes: "Carbon-steel service center offering slitting, cut-to-length, leveling, pickling and edge trimming." }),

  curated({ company_name: "Pramec S.A.S.", country: "Colombia", city: "Bogotá", segment: segments.fabricator, website: "https://pramec.co/", what_they_buy: "carbon steel sheet, stainless steel sheet", size_signal: "operating since 1979; two sheet-laser machines", evidence_urls: ["https://pramec.co/fabrica-piezas-metalicas/pramec-corter-laser-de-lamina/"], source_query: "Colombia empresa corte laser lámina acero fabricación metalmecánica Bogotá", notes: "Automotive and motorcycle component producer that cuts small through large production runs." }),
  curated({ company_name: "International Green Products (IGP Steels)", country: "Colombia", city: "Barranquilla", segment: segments.fabricator, website: "https://igpforms.com/", what_they_buy: "structural plate, beams, profiles, sheet", contact_email: "diego.salamanca@igpforms.com", phone: "+57 315 781 0369", evidence_urls: ["https://igpforms.com/"], source_query: "Colombia estructuras metálicas fabricación acero empresa Cartagena Barranquilla", notes: "Fabrication plants in Barranquilla free zone and Tocancipá; builds frames, warehouses, bridges and tanks." }),
  curated({ company_name: "Frencher Servicios Industriales", country: "Colombia", city: "Bogotá", segment: segments.fabricator, website: "https://www.frenchersi.com/", what_they_buy: "HR and CR sheet, plate, tube", size_signal: "29 years in market", evidence_urls: ["https://www.frenchersi.com/"], source_query: "Colombia empresa corte laser lámina acero fabricación metalmecánica Bogotá", notes: "Laser cutting, CNC bending, punching, machining, welding and sheet or tube rolling." }),
  curated({ company_name: "Servicios Metalmecánicos e Ingeniería SMI S.A.S.", country: "Colombia", city: "Barranquilla", segment: segments.fabricator, website: "https://www.smiltda.com.co/", what_they_buy: "structural plate, beams, profiles, tread plate", general_email: "gerencia@smiltda.com", phone: "+57 301 370 9109", evidence_urls: ["https://www.smiltda.com.co/index.php/servicios/estructuras"], source_query: "Colombia estructuras metálicas fabricación acero empresa Cartagena Barranquilla", notes: "Fabricates platforms, mezzanines, stairs, walkways, chimneys and custom beams." }),
  curated({ company_name: "Cimec S.A.S.", country: "Colombia", city: "Barranquilla", segment: segments.fabricator, website: "https://cimecmetalmecanica.com/", what_they_buy: "structural plate, beams, profiles, grating", general_email: "gerencia@cimecmetalmecanica.com", size_signal: "more than 40 years of experience", evidence_urls: ["https://cimecmetalmecanica.com/estructuras-metalicas/"], source_query: "Colombia estructuras metálicas fabricación acero empresa Cartagena Barranquilla", notes: "Fabricates structures, production equipment and truck structures with plasma and oxyfuel cutting." }),
  curated({ company_name: "Dinacol S.A.S.", country: "Colombia", city: "Cartagena", segment: segments.fabricator, website: "https://dinacolsa.com/", what_they_buy: "structural plate, beams, profiles", general_email: "comercial@dinacol.com", phone: "+57 5 667 1685", evidence_urls: ["https://dinacolsa.com/proyectos/"], source_query: "Colombia estructuras metálicas fabricación acero empresa Cartagena Barranquilla", notes: "Fabricates port, terminal, tank, warehouse and infrastructure steel near Cartagena and Barranquilla." }),
  curated({ company_name: "Costacero", country: "Colombia", city: "Barranquilla", segment: segments.fabricator, website: "https://costacero.com.co/", what_they_buy: "structural plate, beams, profiles", contact_email: "directorcomercial@costacero.com.co", phone: "+57 316 471 0000", evidence_urls: ["https://costacero.com.co/"], source_query: "Colombia estructuras metálicas fabricación acero empresa Cartagena Barranquilla", notes: "Industrial metalworking plant for high-demand structures and components near Barranquilla." }),
  curated({ company_name: "Wesco Acero Inoxidable", country: "Colombia", city: "", segment: segments.service, website: "https://www.wesco.com.co/", what_they_buy: "stainless steel sheet and plate", evidence_urls: ["https://www.wesco.com.co/default.asp?iID=GFMKLE"], source_query: "Colombia centro de servicios acero corte bobina lámina empresa", notes: "Service center with laser cutting, cut-to-size line, shearing, bending and sheet-film application." }),
  curated({ company_name: "CNC Laser de Colombia S.A.", country: "Colombia", city: "Bogotá", segment: segments.fabricator, website: "https://cnclasersa.com/", what_they_buy: "HR and CR sheet, galvanized sheet, stainless steel sheet, tube", general_email: "ventas@cnclasersa.com", phone: "+57 601 677 6060", evidence_urls: ["https://cnclasersa.com/servicios/"], source_query: "Colombia empresa corte laser lámina acero fabricación metalmecánica Bogotá", notes: "Laser cutting, CNC machining, welding, tube rolling and sheet forming." }),
];

const sourceRows = parseCsv(fs.readFileSync(sourcePath, "utf8"));
const candidatesByCountry = new Map();

for (const row of sourceRows) {
  if (!(row.country in existingQuotas)) continue;
  const score = relevanceScore(row);
  if (score < 6) continue;
  const segment = segmentFor(row.category);
  if (!segment) continue;
  const list = candidatesByCountry.get(row.country) ?? [];
  list.push({ row, score, segment });
  candidatesByCountry.set(row.country, list);
}

const selected = [];
const domains = new Set(webRows.map((row) => row.domain));

for (const [country, quota] of Object.entries(existingQuotas)) {
  const candidates = (candidatesByCountry.get(country) ?? []).sort(
    (a, b) => b.score - a.score || a.row.supplier_name.localeCompare(b.row.supplier_name),
  );
  let count = 0;
  for (const candidate of candidates) {
    if (count >= quota) break;
    const domain = clean(candidate.row.domain || domainFromUrl(candidate.row.website));
    if (!domain || domains.has(domain)) continue;
    domains.add(domain);
    selected.push({
      company_name: clean(candidate.row.supplier_name),
      country: clean(candidate.row.country),
      city: "",
      segment: candidate.segment,
      website: clean(candidate.row.website),
      domain,
      what_they_buy: productsFor(candidate.segment, candidate.row.category, candidate.row.evidence_note),
      size_signal: "",
      general_email: "",
      contact_name: "",
      contact_title: "",
      contact_email: "",
      phone: "",
      whatsapp: "",
      language: languageByCountry[country] || "en",
      evidence_urls: evidence(candidate.row.website, candidate.row.source_url),
      source_query: `existing public-source inventory filter: ${clean(candidate.row.source_name)}`,
      notes: `Buyer-product fit inferred from the published ${clean(candidate.row.category).toLowerCase()} capability; confirm current purchasing volume and specification before outreach. Public evidence retrieved ${clean(candidate.row.retrieved_date)}.`,
    });
    count += 1;
  }
}

const rows = [...webRows, ...selected]
  .filter((row) => row.company_name && row.domain && row.evidence_urls && Object.values(segments).includes(row.segment))
  .sort((a, b) => a.country.localeCompare(b.country) || a.company_name.localeCompare(b.company_name));

const csv = [
  headers.join(","),
  ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
].join("\n");

fs.writeFileSync(outputPath, `${csv}\n`, "utf8");

const countryCounts = Object.fromEntries(
  [...new Set(rows.map((row) => row.country))]
    .sort()
    .map((country) => [country, rows.filter((row) => row.country === country).length]),
);
console.log(JSON.stringify({ outputPath, rows: rows.length, countries: countryCounts }, null, 2));
