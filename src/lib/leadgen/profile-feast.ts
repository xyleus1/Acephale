import type { LeadGenProfile, LeadGenSegment } from "./profile";

const FEAST_SEGMENTS: readonly LeadGenSegment[] = [
  {
    key: "coffee_shop",
    label: "Independent coffee shops and espresso bars",
    keywords: ["coffee shop", "independent coffee shop", "specialty coffee", "espresso bar"],
    weight: 1.0,
  },
  {
    key: "cafe",
    label: "Cafes and brunch cafes",
    keywords: ["cafe", "brunch cafe", "breakfast cafe"],
    weight: 1.0,
  },
  {
    key: "bakery_cafe",
    label: "Bakery cafes, artisan bakeries and patisseries",
    keywords: ["bakery cafe", "artisan bakery", "patisserie"],
    weight: 0.9,
  },
  {
    key: "tea_room",
    label: "Tea rooms and coffee houses",
    keywords: ["tea room", "afternoon tea", "coffee house"],
    weight: 0.8,
  },
  {
    key: "dessert_bar",
    label: "Dessert cafes, dessert bars and cake shops",
    keywords: ["dessert cafe", "dessert bar", "cake shop"],
    weight: 0.8,
  },
];

const FEAST_REGIONS = [
  "Kent",
  "East Sussex",
  "West Sussex",
  "Brighton and Hove",
  "Surrey",
  "Hampshire",
  "Isle of Wight",
  "Dorset",
  "Devon",
  "Cornwall",
  "Somerset",
  "Bristol",
  "Wiltshire",
  "Berkshire",
  "Oxfordshire",
  "Buckinghamshire",
  "Gloucestershire",
  "Essex",
  "Hertfordshire",
] as const;

const FEAST_POSITIVE_SIGNALS = [
  "coffee",
  "espresso",
  "barista",
  "latte",
  "flat white",
  "cafe",
  "coffee shop",
  "brunch",
  "breakfast",
  "cake",
  "cakes",
  "pastry",
  "pastries",
  "patisserie",
  "cheesecake",
  "brownie",
  "bakery",
  "dessert",
  "desserts",
  "tea room",
  "afternoon tea",
  "sandwiches",
  "toasties",
  "scones",
  "cookies",
  "muffins",
] as const;

const FEAST_NEGATIVE_SIGNALS = [
  "recruitment",
  "franchise opportunity",
  "coffee machine supplier",
  "equipment supplier",
  "wholesale roaster only",
  "catering equipment",
  "coffee pods",
  "vending",
  "estate agent",
  "hotel group",
  "cinema",
  "petrol station",
] as const;

const FEAST_HARD_EXCLUSIONS = [
  "Costa",
  "Starbucks",
  "Caffe Nero",
  "Pret a Manger",
  "Greggs",
  "Coffee#1",
  "Black Sheep Coffee",
  "Esquires",
  "Muffin Break",
  "Boston Tea Party",
  "Wetherspoon",
  "Costa Coffee",
] as const;

export const FEAST_PROFILE: LeadGenProfile = {
  slug: "feast",
  customerName: "Feast",
  offering:
    "Frozen patisserie supply from Feast (Ozgorkey Group): cheesecakes, layer cakes, tarts, muffins, cookies, savoury pastries, counter-front desserts and portioned sweets for coffee shops, cafes, bakery cafes and tea rooms. Thaw and serve, consistent portions, long frozen shelf life.",
  segments: FEAST_SEGMENTS,
  regions: FEAST_REGIONS,
  directorySeeds: [],
  positiveSignals: FEAST_POSITIVE_SIGNALS,
  negativeSignals: FEAST_NEGATIVE_SIGNALS,
  hardExclusions: FEAST_HARD_EXCLUSIONS,
  queryLocales: ["en"],
};
