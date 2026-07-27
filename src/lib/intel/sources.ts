export type IntelSourceAccess = "keyless" | "free_key" | "manual";

export type IntelSourceDefinition = {
  id: string;
  name: string;
  publisher: string;
  homepage: string;
  access: IntelSourceAccess;
  cadence: string;
  cacheSeconds: number;
  reachableFromVercel: boolean;
  notes: string;
};

export const INTEL_SOURCES = {
  usitc_hts: {
    id: "usitc_hts",
    name: "Harmonized Tariff Schedule",
    publisher: "U.S. International Trade Commission",
    homepage: "https://hts.usitc.gov/",
    access: "keyless",
    cadence: "Per HTS release",
    cacheSeconds: 7 * 24 * 60 * 60,
    reachableFromVercel: true,
    notes: "Per-code search is reachable. Bulk export is not relied on.",
  },
  cbp_cross: {
    id: "cbp_cross",
    name: "Customs Rulings Online Search System",
    publisher: "U.S. Customs and Border Protection",
    homepage: "https://rulings.cbp.gov/",
    access: "keyless",
    cadence: "Continuous",
    cacheSeconds: 7 * 24 * 60 * 60,
    reachableFromVercel: true,
    notes: "Citations require a subject-token match and skip revoked rulings.",
  },
  fmcsa_li: {
    id: "fmcsa_li",
    name: "Licensing and Insurance filings",
    publisher: "Federal Motor Carrier Safety Administration",
    homepage: "https://data.transportation.gov/resource/qh9u-swkp.json",
    access: "keyless",
    cadence: "Daily, monitor for staleness",
    cacheSeconds: 24 * 60 * 60,
    reachableFromVercel: true,
    notes: "Amounts are published in thousands. Cancellation dates need a near-term window check.",
  },
  fmcsa_census: {
    id: "fmcsa_census",
    name: "Motor Carrier Census",
    publisher: "Federal Motor Carrier Safety Administration",
    homepage: "https://data.transportation.gov/resource/az4n-8mr2.json",
    access: "keyless",
    cadence: "Monthly",
    cacheSeconds: 24 * 60 * 60,
    reachableFromVercel: true,
    notes: "Keyless Socrata access is throttled. An app token is optional.",
  },
  bls_truckload_ppi: {
    id: "bls_truckload_ppi",
    name: "Long-distance truckload Producer Price Index",
    publisher: "U.S. Bureau of Labor Statistics",
    homepage: "https://data.bls.gov/timeseries/PCU484121484121",
    access: "keyless",
    cadence: "Monthly",
    cacheSeconds: 6 * 60 * 60,
    reachableFromVercel: true,
    notes: "The keyless API has a low daily request limit, so caching is mandatory.",
  },
  eia_ca_diesel: {
    id: "eia_ca_diesel",
    name: "California on-highway diesel price",
    publisher: "U.S. Energy Information Administration",
    homepage: "https://www.eia.gov/dnav/pet/pet_pri_gnd_dcus_sca_w.htm",
    access: "free_key",
    cadence: "Weekly",
    cacheSeconds: 6 * 60 * 60,
    reachableFromVercel: true,
    notes: "The API key stays server-side and must never appear in citation links.",
  },
  census_trade: {
    id: "census_trade",
    name: "International Trade Imports API",
    publisher: "U.S. Census Bureau",
    homepage: "https://www.census.gov/data/developers/data-sets/international-trade.html",
    access: "free_key",
    cadence: "Monthly",
    cacheSeconds: 24 * 60 * 60,
    reachableFromVercel: true,
    notes: "Queries use a 25 second timeout. California state-of-destination and West Coast customs-district results are separate geographies. Districts 27 and 28 include Nevada-area ports. The legacy market tile uses all-mode GEN_VAL; the hardware report keeps vessel, containerized vessel, and air measures separate.",
  },
  census_trade_downloads: {
    id: "census_trade_downloads",
    name: "International Trade public download files",
    publisher: "U.S. Census Bureau",
    homepage: "https://www.census.gov/foreign-trade/data/dataproducts.html",
    access: "keyless",
    cadence: "Monthly",
    cacheSeconds: 30 * 24 * 60 * 60,
    reachableFromVercel: true,
    notes: "Keyless ZIP files used for durable report snapshots. State Imports HS6 represents state of ultimate destination. Port Imports HS6 represents port of unlading. Vessel, containerized vessel, and air measures remain separate.",
  },
  census_schedule_c: {
    id: "census_schedule_c",
    name: "Schedule C country and territory codes",
    publisher: "U.S. Census Bureau",
    homepage: "https://www.census.gov/foreign-trade/schedules/c/countrycodes.html",
    access: "keyless",
    cadence: "As updated",
    cacheSeconds: 30 * 24 * 60 * 60,
    reachableFromVercel: true,
    notes: "Maps four-digit Census country codes to country names. It does not identify suppliers, shipment origin ports, or company locations.",
  },
  cbp_manifest_public: {
    id: "cbp_manifest_public",
    name: "Vessel manifest public disclosure rules",
    publisher: "U.S. Customs and Border Protection",
    homepage: "https://www.ecfr.gov/current/title-19/part-103/section-103.31",
    access: "manual",
    cadence: "Review quarterly",
    cacheSeconds: 90 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes: "Defines public vessel manifest fields and confidentiality limits. It is not a shipment feed.",
  },
  importyeti: {
    id: "importyeti",
    name: "ImportYeti service terms",
    publisher: "ImportYeti",
    homepage: "https://www.importyeti.com/",
    access: "manual",
    cadence: "Unavailable without explicit commercial permission or license",
    cacheSeconds: 30 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes: "Unavailable for Derya commercial use under the public terms. Do not retrieve, manually copy, cite as company evidence, automate, or ingest ImportYeti data unless Derya obtains explicit written permission or a commercial license. The terms page may be cited only to document this restriction.",
  },
  importgenius: {
    id: "importgenius",
    name: "U.S. import bill of lading data",
    publisher: "ImportGenius",
    homepage: "https://www.importgenius.com/",
    access: "manual",
    cadence: "Not connected",
    cacheSeconds: 30 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes: "Paid provider. Intel has no account, export, API, or live integration.",
  },
  tradeatlas: {
    id: "tradeatlas",
    name: "TradeAtlas shipment database",
    publisher: "TradeAtlas",
    homepage: "https://www.tradeatlas.com/en",
    access: "manual",
    cadence: "Not connected",
    cacheSeconds: 30 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes: "Trial and paid provider. Intel has no account, export, API, or live integration.",
  },
  trademo: {
    id: "trademo",
    name: "Trademo global trade data",
    publisher: "Trademo",
    homepage: "https://www.trademo.com/",
    access: "manual",
    cadence: "Not connected",
    cacheSeconds: 30 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes: "Commercial provider with public previews. Intel has no account, export, API, or live integration.",
  },
  phmsa_lithium: {
    id: "phmsa_lithium",
    name: "Lithium battery transportation guidance",
    publisher: "Pipeline and Hazardous Materials Safety Administration",
    homepage: "https://www.phmsa.dot.gov/lithiumbatteries",
    access: "manual",
    cadence: "Review quarterly",
    cacheSeconds: 90 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes: "Human-reviewed rule basis. No server fetch is used in V1.",
  },
  phmsa_hazmat: {
    id: "phmsa_hazmat",
    name: "Hazardous materials transport regulations and interpretations",
    publisher: "Pipeline and Hazardous Materials Safety Administration",
    homepage:
      "https://www.phmsa.dot.gov/standards-rulemaking/hazmat/hazardous-materials-information-center",
    access: "manual",
    cadence: "Review quarterly",
    cacheSeconds: 90 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes:
      "Feature-triggered transport screen for regulated materials in equipment. Classification, exceptions, packaging, communication, and carrier acceptance remain shipment-specific.",
  },
  nrc_imports: {
    id: "nrc_imports",
    name: "Nuclear equipment and radioactive material import licensing",
    publisher: "U.S. Nuclear Regulatory Commission",
    homepage: "https://www.nrc.gov/about-nrc/ip/export-import/license-types",
    access: "manual",
    cadence: "Review before each applicable shipment",
    cacheSeconds: 24 * 60 * 60,
    reachableFromVercel: false,
    notes:
      "Feature-triggered licensing guidance. Material, quantity, form, consignee authorization, license type, exceptions, and notifications remain shipment-specific.",
  },
  state_ddtc: {
    id: "state_ddtc",
    name: "Defense Trade Controls and the U.S. Munitions List",
    publisher: "U.S. Department of State",
    homepage: "https://www.pmddtc.state.gov/ddtc_public/ddtc_public?id=ddtc_kb_article_page&sys_id=24d528fddbfc930044f9ff621f961987",
    access: "manual",
    cadence: "Review quarterly",
    cacheSeconds: 90 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes: "Human-reviewed rule basis. Defense classification requires specialist review.",
  },
  bis_export_controls: {
    id: "bis_export_controls",
    name: "Export Administration Regulations",
    publisher: "Bureau of Industry and Security",
    homepage: "https://www.bis.gov/regulations/ear",
    access: "manual",
    cadence: "Review monthly",
    cacheSeconds: 30 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes: "Human-reviewed rule basis. Classification and licensing remain operator-gated.",
  },
  census_aes: {
    id: "census_aes",
    name: "Automated Export System guidance",
    publisher: "U.S. Census Bureau",
    homepage: "https://www.census.gov/foreign-trade/aes/index.html",
    access: "manual",
    cadence: "Review quarterly",
    cacheSeconds: 90 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes: "Human-reviewed filing guidance. No server fetch is used in V1.",
  },
  cbp_import_security: {
    id: "cbp_import_security",
    name: "Importer Security Filing and cargo examination guidance",
    publisher: "U.S. Customs and Border Protection",
    homepage: "https://www.cbp.gov/border-security/ports-entry/cargo-security/importer-security-filing-102",
    access: "manual",
    cadence: "Review quarterly",
    cacheSeconds: 90 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes: "Human-reviewed import rule basis. No server fetch is used in V1.",
  },
  cbp_importing_guide: {
    id: "cbp_importing_guide",
    name: "Importing into the United States guidance",
    publisher: "U.S. Customs and Border Protection",
    homepage: "https://www.cbp.gov/trade/basic-import-export",
    access: "manual",
    cadence: "Review quarterly",
    cacheSeconds: 90 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes:
      "Operating guidance and handbook references. The commercial importer handbook was last revised in 2006 and does not replace current regulations, tariff schedules, or agency actions.",
  },
  cbp_forced_labor: {
    id: "cbp_forced_labor",
    name: "Forced labor and UFLPA importer guidance",
    publisher: "U.S. Customs and Border Protection",
    homepage: "https://www.cbp.gov/trade/forced-labor",
    access: "manual",
    cadence: "Review weekly",
    cacheSeconds: 7 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes:
      "Importer guidance and enforcement references. A source screen is not a determination that a shipment is admissible.",
  },
  ecfr_customs: {
    id: "ecfr_customs",
    name: "Customs regulations in Title 19",
    publisher: "Office of the Federal Register",
    homepage: "https://www.ecfr.gov/current/title-19/chapter-I",
    access: "manual",
    cadence: "Review monthly",
    cacheSeconds: 30 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes:
      "Continuously updated electronic regulations. The eCFR is authoritative but unofficial and must be paired with an effective-date review.",
  },
  ecfr_federal_regulations: {
    id: "ecfr_federal_regulations",
    name: "Electronic Code of Federal Regulations",
    publisher: "Office of the Federal Register",
    homepage: "https://www.ecfr.gov/current",
    access: "manual",
    cadence: "Review monthly",
    cacheSeconds: 30 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes:
      "Continuously updated federal regulations outside Title 19. The eCFR is authoritative but unofficial and must be checked for the relevant effective date.",
  },
  ustr_china_tariffs: {
    id: "ustr_china_tariffs",
    name: "China Section 301 tariff actions",
    publisher: "Office of the U.S. Trade Representative",
    homepage: "https://ustr.gov/issue-areas/enforcement/section-301-investigations/tariff-actions",
    access: "manual",
    cadence: "Review monthly",
    cacheSeconds: 30 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes:
      "Official action and exclusion history. Applicability requires exact country of origin, HTS classification, entry date, and exclusion text.",
  },
  federal_register_tariff_actions: {
    id: "federal_register_tariff_actions",
    name: "Federal Register tariff and import actions",
    publisher: "Office of the Federal Register",
    homepage: "https://www.federalregister.gov/presidential-documents",
    access: "manual",
    cadence: "Review weekly",
    cacheSeconds: 7 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes:
      "Official action metadata and links to the govinfo legal edition. Effective dates, exceptions, interactions, and later modifications must be reviewed before applying an action.",
  },
  epa_imports: {
    id: "epa_imports",
    name: "EPA import requirements for products and equipment",
    publisher: "U.S. Environmental Protection Agency",
    homepage: "https://www.epa.gov/importing-vehicles-and-engines",
    access: "manual",
    cadence: "Review quarterly",
    cacheSeconds: 90 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes:
      "Feature-triggered import guidance for engines, equipment, vehicles, regulated substances, pesticides, and pesticidal devices. Exact product and declaration facts remain operator-gated.",
  },
  epa_refrigerants: {
    id: "epa_refrigerants",
    name: "Refrigerant product and equipment controls",
    publisher: "U.S. Environmental Protection Agency",
    homepage: "https://www.epa.gov/hfcs/technology-transitions-program",
    access: "manual",
    cadence: "Review monthly",
    cacheSeconds: 30 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes:
      "Feature-triggered HFC, ozone-depleting-substance, equipment, component, labeling, and reporting authority. Finished charged equipment and bulk refrigerant require separate determinations.",
  },
  doe_efficiency: {
    id: "doe_efficiency",
    name: "Energy conservation standards for importers",
    publisher: "U.S. Department of Energy",
    homepage: "https://www.energy.gov/gc/conservation-standards-enforcement-importer-qas",
    access: "manual",
    cadence: "Review quarterly",
    cacheSeconds: 90 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes:
      "Importer guidance for covered consumer products and commercial or industrial equipment. Coverage, test procedures, standards, and certification are product-specific.",
  },
  aphis_wood_packaging: {
    id: "aphis_wood_packaging",
    name: "Wood packaging material import requirements",
    publisher: "USDA Animal and Plant Health Inspection Service",
    homepage: "https://www.aphis.usda.gov/plant-imports/wood-packaging-material/import",
    access: "manual",
    cadence: "Review quarterly",
    cacheSeconds: 90 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes:
      "Official ISPM 15 operating guidance for regulated solid wood packaging entering or transiting the United States.",
  },
  trade_adcvd: {
    id: "trade_adcvd",
    name: "Antidumping and countervailing duty proceedings",
    publisher: "U.S. Department of Commerce",
    homepage: "https://www.trade.gov/us-antidumping-and-countervailing-duties-home-page",
    access: "manual",
    cadence: "Review before every landed-cost quote",
    cacheSeconds: 24 * 60 * 60,
    reachableFromVercel: false,
    notes:
      "Order scope is product-specific and may not follow an HTS code alone. A scope review is required before relying on a duty estimate.",
  },
  dhs_uflpa: {
    id: "dhs_uflpa",
    name: "UFLPA Entity List",
    publisher: "U.S. Department of Homeland Security",
    homepage: "https://www.dhs.gov/uflpa-entity-list",
    access: "manual",
    cadence: "Review weekly",
    cacheSeconds: 7 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes: "The official DHS list is the citation authority. No OpenSanctions commercial use is assumed.",
  },
  fcc_equipment_authorization: {
    id: "fcc_equipment_authorization",
    name: "Radio frequency device importation guidance",
    publisher: "Federal Communications Commission",
    homepage: "https://www.fcc.gov/oet/ea/importation-radio-frequency-devices-capable-causing-harmful-interference",
    access: "manual",
    cadence: "Review quarterly",
    cacheSeconds: 90 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes: "Reference link only. FCC application hosts are not a Vercel dependency.",
  },
  fda_device_imports: {
    id: "fda_device_imports",
    name: "Medical device and radiation-emitting product imports",
    publisher: "U.S. Food and Drug Administration",
    homepage: "https://www.fda.gov/medical-devices/importing-and-exporting-medical-devices/importing-medical-devices-and-radiation-emitting-electronic-products-us",
    access: "manual",
    cadence: "Review quarterly",
    cacheSeconds: 90 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes:
      "Product-specific import guidance. FDA requirements depend on intended use, device classification, establishment, listing, authorization, labeling, and entry data.",
  },
  cpsc_certificates: {
    id: "cpsc_certificates",
    name: "Consumer product certificates and eFiling",
    publisher: "U.S. Consumer Product Safety Commission",
    homepage: "https://www.cpsc.gov/Business--Manufacturing/Business-Education/Business-Guidance/Certificates",
    access: "manual",
    cadence: "Review monthly",
    cacheSeconds: 30 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes:
      "Applies only to consumer products subject to CPSC certification. General imported-product eFiling became effective July 8, 2026.",
  },
  fmcsa_safety_regulations: {
    id: "fmcsa_safety_regulations",
    name: "Motor carrier safety regulations",
    publisher: "Federal Motor Carrier Safety Administration",
    homepage: "https://www.fmcsa.dot.gov/regulations",
    access: "manual",
    cadence: "Review quarterly",
    cacheSeconds: 90 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes: "Human-reviewed basis for weight, driver hours, and operating rules.",
  },
  fmcsa_broker_registration: {
    id: "fmcsa_broker_registration",
    name: "Broker registration requirements",
    publisher: "Federal Motor Carrier Safety Administration",
    homepage: "https://www.fmcsa.dot.gov/registration/broker-registration",
    access: "manual",
    cadence: "Review quarterly",
    cacheSeconds: 90 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes: "Human-reviewed operating-authority rule basis.",
  },
  overhaul_cargo_theft: {
    id: "overhaul_cargo_theft",
    name: "United States cargo theft reports",
    publisher: "Overhaul",
    homepage: "https://over-haul.com/us-cargo-theft-report",
    access: "manual",
    cadence: "Quarterly",
    cacheSeconds: 90 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes: "Manual report reference. Figures describe Overhaul-recorded incidents, not a census.",
  },
  carb_tru: {
    id: "carb_tru",
    name: "Transport Refrigeration Unit program",
    publisher: "California Air Resources Board",
    homepage: "https://ww2.arb.ca.gov/our-work/programs/transport-refrigeration-unit",
    access: "manual",
    cadence: "Review quarterly",
    cacheSeconds: 90 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes: "Human-reviewed California equipment rule basis.",
  },
  california_ab5: {
    id: "california_ab5",
    name: "Worker classification guidance",
    publisher: "State of California Department of Industrial Relations",
    homepage: "https://www.dir.ca.gov/dlse/faq_independentcontractor.htm",
    access: "manual",
    cadence: "Review quarterly",
    cacheSeconds: 90 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes: "Human-reviewed California classification rule basis.",
  },
  cargonet_july_fourth: {
    id: "cargonet_july_fourth",
    name: "July 4 cargo theft advisory",
    publisher: "Verisk CargoNet",
    homepage: "https://www.cargonet.com/news-and-events/cargonet-in-the-media/july-4th-2026/",
    access: "manual",
    cadence: "Annual",
    cacheSeconds: 365 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes: "Five-year holiday-period analysis. Treat as CargoNet's reported incident sample, not a national census.",
  },
  cargonet_thanksgiving: {
    id: "cargonet_thanksgiving",
    name: "Thanksgiving cargo theft advisory",
    publisher: "Verisk CargoNet",
    homepage: "https://www.cargonet.com/news-and-events/cargonet-in-the-media/thanksgiving2025/",
    access: "manual",
    cadence: "Annual",
    cacheSeconds: 365 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes: "Five-year Thanksgiving-period analysis. Treat as CargoNet's reported incident sample, not a national census.",
  },
  cargonet_winter_holidays: {
    id: "cargonet_winter_holidays",
    name: "Christmas and New Year cargo theft advisory",
    publisher: "Verisk CargoNet",
    homepage: "https://www.cargonet.com/news-and-events/cargonet-in-the-media/winter-holiday-trends-2025/",
    access: "manual",
    cadence: "Annual",
    cacheSeconds: 365 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes: "Five-year winter-holiday analysis. Treat as CargoNet's reported incident sample, not a national census.",
  },
  cargonet_friday_theft: {
    id: "cargonet_friday_theft",
    name: "Friday full-truckload theft analysis",
    publisher: "Verisk CargoNet",
    homepage: "https://www.cargonet.com/49850d/siteassets/images/pdf/cargonet-covid-19-impact-on-cargo-theft-activity-04222020.pdf",
    access: "manual",
    cadence: "Historical reference",
    cacheSeconds: 365 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes: "Dated April 2020 sample that found a Friday concentration associated with equipment parked through weekends. Do not present it as a current national rate.",
  },
  fbi_cargo_theft: {
    id: "fbi_cargo_theft",
    name: "Cargo theft threat and prevention guidance",
    publisher: "Federal Bureau of Investigation",
    homepage: "https://www.fbi.gov/investigate/transnational-organized-crime/cargo-theft",
    access: "manual",
    cadence: "Review annually",
    cacheSeconds: 365 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes: "Current mitigation guidance for unattended loads and secured staging; it does not establish Friday timing.",
  },
  ti_capital_equipment_shipping: {
    id: "ti_capital_equipment_shipping",
    name: "TI capital equipment crating manual",
    publisher: "Texas Instruments",
    homepage: "https://www.ti.com/lit/cr/szzq336/szzq336.pdf",
    access: "manual",
    cadence: "Review annually",
    cacheSeconds: 365 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes: "TI receiving-facility requirements for supplier shipments. Air ride applies to TI semiconductor equipment moved more than 50 km; this is not a universal OEM rule.",
  },
  fedex_freight_packaging: {
    id: "fedex_freight_packaging",
    name: "Freight packing guide",
    publisher: "FedEx",
    homepage: "https://www.fedex.com/en-us/shipping/freight/resources/packing-guide.html",
    access: "manual",
    cadence: "Review annually",
    cacheSeconds: 365 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes: "Carrier guidance for crating or enclosing sensitive electronics; it is not a categorical prohibition on open-deck transport.",
  },
  rl_liftgate: {
    id: "rl_liftgate",
    name: "Liftgate service requirements",
    publisher: "R+L Carriers",
    homepage: "https://www2.rlcarriers.com/freight/shipping-services/liftgate",
    access: "manual",
    cadence: "Review annually",
    cacheSeconds: 365 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes: "Carrier-specific evidence that no-dock delivery and liftgate service must be identified before dispatch.",
  },
  nws_desert_heat: {
    id: "nws_desert_heat",
    name: "Heat and HeatRisk guidance",
    publisher: "National Weather Service",
    homepage: "https://www.weather.gov/safety/heat",
    access: "manual",
    cadence: "Review annually",
    cacheSeconds: 365 * 24 * 60 * 60,
    reachableFromVercel: false,
    notes: "Supports checking location-specific heat conditions, not a claimed route, trailer-interior, or product temperature.",
  },
} as const satisfies Record<string, IntelSourceDefinition>;

export type IntelSourceId = keyof typeof INTEL_SOURCES;

export type IntelSourceUse = {
  sourceId: IntelSourceId;
  sourceUrl: string;
  displayName?: string;
  asOf: string | null;
  fetchedAt: string | null;
  reviewedAt: string | null;
  integritySha256?: string | null;
};

export type ResolvedIntelSourceUse = IntelSourceUse & IntelSourceDefinition;

export const INTEL_SOURCE_HOSTS: Record<IntelSourceId, readonly string[]> = {
  usitc_hts: ["hts.usitc.gov", "www.usitc.gov"],
  cbp_cross: ["rulings.cbp.gov"],
  fmcsa_li: ["data.transportation.gov", "li-public.fmcsa.dot.gov"],
  fmcsa_census: ["data.transportation.gov"],
  bls_truckload_ppi: ["api.bls.gov", "data.bls.gov"],
  eia_ca_diesel: ["api.eia.gov", "www.eia.gov"],
  census_trade: ["api.census.gov", "www.census.gov"],
  census_trade_downloads: ["www.census.gov"],
  census_schedule_c: ["www.census.gov"],
  cbp_manifest_public: ["www.ecfr.gov", "www.help.cbp.gov"],
  importyeti: ["www.importyeti.com", "importyeti.com"],
  importgenius: ["www.importgenius.com", "w3.importgenius.com", "fr.importgenius.com", "importgenius.com"],
  tradeatlas: ["www.tradeatlas.com", "tradeatlas.com", "app.tradeatlas.com"],
  trademo: ["www.trademo.com", "trademo.com"],
  phmsa_lithium: ["www.phmsa.dot.gov"],
  phmsa_hazmat: ["www.phmsa.dot.gov"],
  nrc_imports: ["www.nrc.gov"],
  state_ddtc: ["www.pmddtc.state.gov"],
  bis_export_controls: ["www.bis.gov"],
  census_aes: ["www.census.gov"],
  cbp_import_security: ["www.cbp.gov", "www.help.cbp.gov"],
  cbp_importing_guide: ["www.cbp.gov", "cbp.gov", "www.help.cbp.gov"],
  cbp_forced_labor: ["www.cbp.gov", "www.help.cbp.gov"],
  ecfr_customs: ["www.ecfr.gov"],
  ecfr_federal_regulations: ["www.ecfr.gov"],
  ustr_china_tariffs: ["ustr.gov", "www.ustr.gov", "www.govinfo.gov"],
  federal_register_tariff_actions: [
    "www.federalregister.gov",
    "www.govinfo.gov",
  ],
  epa_imports: ["www.epa.gov"],
  epa_refrigerants: ["www.epa.gov", "www.ecfr.gov", "www.govinfo.gov"],
  doe_efficiency: ["www.energy.gov"],
  aphis_wood_packaging: ["www.aphis.usda.gov"],
  trade_adcvd: ["www.trade.gov", "trade.gov", "access.trade.gov", "legacy.trade.gov"],
  dhs_uflpa: ["www.dhs.gov"],
  fcc_equipment_authorization: [
    "www.fcc.gov",
    "www.ecfr.gov",
    "www.govinfo.gov",
  ],
  fda_device_imports: ["www.fda.gov", "www.ecfr.gov"],
  cpsc_certificates: ["www.cpsc.gov", "www.ecfr.gov", "www.federalregister.gov"],
  fmcsa_safety_regulations: ["www.fmcsa.dot.gov"],
  fmcsa_broker_registration: ["www.fmcsa.dot.gov"],
  overhaul_cargo_theft: ["over-haul.com", "www.over-haul.com"],
  carb_tru: ["ww2.arb.ca.gov"],
  california_ab5: ["www.dir.ca.gov"],
  cargonet_july_fourth: ["www.cargonet.com"],
  cargonet_thanksgiving: ["www.cargonet.com"],
  cargonet_winter_holidays: ["www.cargonet.com"],
  cargonet_friday_theft: ["www.cargonet.com"],
  fbi_cargo_theft: ["www.fbi.gov"],
  ti_capital_equipment_shipping: ["www.ti.com"],
  fedex_freight_packaging: ["www.fedex.com"],
  rl_liftgate: ["www2.rlcarriers.com"],
  nws_desert_heat: ["www.weather.gov"],
};

const SECRET_QUERY_KEY = /^(?:api[_-]?key|key|token|access[_-]?token|webkey|client[_-]?secret|secret|signature|sig|credential|password)$/i;

export function isSecretFreeSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      [...url.searchParams.keys()].every((key) => !SECRET_QUERY_KEY.test(key))
    );
  } catch {
    return false;
  }
}

export function getIntelSource(sourceId: IntelSourceId): IntelSourceDefinition {
  const source = (INTEL_SOURCES as Record<string, IntelSourceDefinition>)[sourceId];
  if (!source) throw new Error(`Unknown Intel source: ${sourceId}`);
  return source;
}

export function resolveIntelSourceUse(use: IntelSourceUse): ResolvedIntelSourceUse {
  if (!isSecretFreeSourceUrl(use.sourceUrl)) {
    throw new Error(`Intel source ${use.sourceId} has an invalid or secret-bearing citation URL`);
  }
  const url = new URL(use.sourceUrl);
  if (!INTEL_SOURCE_HOSTS[use.sourceId].includes(url.hostname.toLowerCase())) {
    throw new Error(`Intel source ${use.sourceId} cannot cite host ${url.hostname}`);
  }
  return { ...getIntelSource(use.sourceId), ...use };
}

export function dedupeIntelSourceUses(uses: readonly IntelSourceUse[]): IntelSourceUse[] {
  const seen = new Set<string>();
  const result: IntelSourceUse[] = [];
  for (const use of uses) {
    const key = `${use.sourceId}|${use.sourceUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(use);
  }
  return result;
}

export function sourceCacheAgeSeconds(use: IntelSourceUse, now: Date = new Date()): number | null {
  if (!use.fetchedAt) return null;
  const fetchedAt = new Date(use.fetchedAt);
  if (Number.isNaN(fetchedAt.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - fetchedAt.getTime()) / 1000));
}

export function formatCacheAge(use: IntelSourceUse, now: Date = new Date()): string {
  const seconds = sourceCacheAgeSeconds(use, now);
  if (seconds == null) return "not cached";
  if (seconds < 60) return "under 1 minute old";
  if (seconds < 60 * 60) return `${Math.floor(seconds / 60)}m old`;
  if (seconds < 24 * 60 * 60) return `${Math.floor(seconds / (60 * 60))}h old`;
  return `${Math.floor(seconds / (24 * 60 * 60))}d old`;
}

export function formatReviewAge(use: IntelSourceUse, now: Date = new Date()): string {
  if (!use.reviewedAt) return "review date unavailable";
  return formatCacheAge({ ...use, fetchedAt: use.reviewedAt }, now).replace(/ old$/, " since review");
}

export function formatSourcesFooter(uses: readonly IntelSourceUse[]): string {
  const sources = dedupeIntelSourceUses(uses).map(resolveIntelSourceUse);
  if (sources.length === 0) return "SOURCES\nNo external source-backed facts were used.";
  return [
    "SOURCES",
    ...sources.map((source, index) => {
      const asOf = source.asOf ?? "not published";
      const observedAt = source.fetchedAt
        ? `fetched ${source.fetchedAt}`
        : `reviewed ${source.reviewedAt ?? "date unavailable"}`;
      return `[${index + 1}] ${source.displayName ?? source.name}, ${source.publisher} | as of ${asOf} | ${observedAt} | ${source.sourceUrl}`;
    }),
  ].join("\n");
}

export const INTEL_RULES_REVIEWED_AT = "2026-07-21T00:00:00.000Z";

export function reviewedSourceUse(
  sourceId: IntelSourceId,
  sourceUrl: string = getIntelSource(sourceId).homepage,
  asOf: string | null = null
): IntelSourceUse {
  return { sourceId, sourceUrl, asOf, fetchedAt: null, reviewedAt: INTEL_RULES_REVIEWED_AT };
}

export function manualSourceUse(
  sourceId: IntelSourceId,
  sourceUrl: string,
  reviewedAt: string,
  asOf: string | null = null
): IntelSourceUse {
  return { sourceId, sourceUrl, asOf, fetchedAt: null, reviewedAt };
}
