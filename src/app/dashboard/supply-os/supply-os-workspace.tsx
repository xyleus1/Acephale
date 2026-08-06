"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icon";
import {
  WORLD_MAP_LAND_PATHS,
  WORLD_MAP_VIEWBOX,
} from "@/lib/market-intelligence/world-map-asset";
import {
  originCountryForMovement,
  procurementProfileForMovement,
  resolveMovementAssessment,
  resolveMovementOwnedRecord,
} from "@/lib/supply-os-command-model";
import styles from "./supply-os-workspace.module.css";

type ViewId = "command" | "network" | "suppliers" | "procurement" | "execution" | "control";
type MapMode = "operations" | "risk" | "cost" | "customs";
type TimeRange = "24h" | "7d" | "30d";
type AuthorityMode = "observe" | "assist" | "coordinate" | "execute";
type PermissionKey = "supplier" | "forwarder" | "broker" | "pickup" | "updates";
type NetworkLayerKey = "suppliers" | "ports" | "routes" | "risk" | "milestones" | "density";
type Tone = "critical" | "watch" | "stable" | "neutral";

type TimelineEvent = {
  label: string;
  detail: string;
  time: string;
  state: "complete" | "current" | "pending" | "blocked";
  source: string;
};

type Movement = {
  id: string;
  po: string;
  supplier: string;
  cargo: string;
  route: string;
  routeNodes: string[];
  eta: string;
  etd: string;
  cost: string;
  costDelta: string;
  status: string;
  tone: Tone;
  mode: string;
  owner: string;
  incoterm: string;
  container: string;
  hsCode: string;
  riskScore: number;
  confidence: number;
  buffer: string;
  nextDecision: string;
  signals: Array<{ label: string; value: string; tone: Tone }>;
  evidence: Array<{ source: string; age: string; confidence: string }>;
  timeline: TimelineEvent[];
};

type Supplier = {
  id: string;
  name: string;
  location: string;
  product: string;
  role: string;
  tier: string;
  score: number;
  risk: "Low" | "Medium" | "High";
  response: string;
  ready: string;
  documents: string;
  price: string;
  share: string;
  capacity: string;
  leadTime: string;
  facility: string;
  gateway: string;
  audit: string;
  note: string;
};

type Quote = {
  id: string;
  movementId: string;
  partner: string;
  source: string;
  route: string;
  price: number;
  delta: string;
  transit: string;
  reliability: string;
  fit: number;
  freeDays: string;
  emissions: string;
  valid: string;
  flag: string;
};

type NetworkNode = {
  id: string;
  label: string;
  detail: string;
  lat: number;
  lng: number;
  kind: "supplier" | "port" | "destination" | "crossing";
  tone: Tone;
  metric: string;
  region: string;
  major?: boolean;
  labelSide?: "left" | "right";
  labelDx?: number;
  labelDy?: number;
};

type ExceptionItem = {
  id: string;
  code: string;
  severity: "critical" | "watch" | "info";
  title: string;
  summary: string;
  impact: string;
  owner: string;
  age: string;
  movementId: string;
  sources: number;
};

const VIEWS: Array<{ id: ViewId; label: string; count?: string }> = [
  { id: "command", label: "Command" },
  { id: "network", label: "Network map" },
  { id: "suppliers", label: "Supplier intelligence" },
  { id: "procurement", label: "Procurement", count: "4" },
  { id: "execution", label: "Execution" },
  { id: "control", label: "Authority" },
];

const NETWORK_NODES: NetworkNode[] = [
  { id: "dongguan", label: "Dongguan", detail: "Kepler Precision", lat: 23.02, lng: 113.75, kind: "supplier", tone: "watch", metric: "72% category share", region: "South China", major: true, labelSide: "left", labelDx: -12, labelDy: -12 },
  { id: "penang", label: "Penang", detail: "NovaForge", lat: 5.41, lng: 100.34, kind: "supplier", tone: "stable", metric: "95% on time", region: "Southeast Asia", major: true, labelSide: "left", labelDx: -11, labelDy: -8 },
  { id: "monterrey", label: "Monterrey", detail: "Sierra Metalworks", lat: 25.69, lng: -100.32, kind: "supplier", tone: "watch", metric: "Invoice revision", region: "North America", major: true, labelSide: "right", labelDx: 11, labelDy: 17 },
  { id: "reno", label: "Reno", detail: "ForgeWest", lat: 39.53, lng: -119.81, kind: "supplier", tone: "stable", metric: "24h dispatch", region: "North America", major: true, labelSide: "right", labelDx: 10, labelDy: -10 },
  { id: "suzhou", label: "Suzhou", detail: "Qingdao Motion", lat: 31.3, lng: 120.58, kind: "supplier", tone: "watch", metric: "Rate up 8.4%", region: "East China", major: true, labelSide: "left", labelDx: -10, labelDy: -14 },
  { id: "rotterdam-supplier", label: "Rotterdam Resin", detail: "Helios Polymers", lat: 51.95, lng: 4.19, kind: "supplier", tone: "stable", metric: "Allocation secured", region: "Northern Europe", major: true, labelSide: "left", labelDx: -10, labelDy: -12 },
  { id: "yantian", label: "Yantian", detail: "Origin gateway", lat: 22.58, lng: 114.27, kind: "port", tone: "watch", metric: "Dwell +0.7d", region: "South China", major: true, labelSide: "right", labelDx: 12, labelDy: 15 },
  { id: "shanghai", label: "Shanghai", detail: "Origin gateway", lat: 31.23, lng: 121.47, kind: "port", tone: "watch", metric: "Reliability 71%", region: "East China", major: true, labelSide: "right", labelDx: 11, labelDy: 14 },
  { id: "ningbo", label: "Ningbo", detail: "Alternate gateway", lat: 29.87, lng: 121.54, kind: "port", tone: "stable", metric: "Capacity available", region: "East China" },
  { id: "busan", label: "Busan", detail: "Transshipment", lat: 35.18, lng: 129.08, kind: "port", tone: "stable", metric: "Dwell 1.4d", region: "Korea" },
  { id: "singapore", label: "Singapore", detail: "Transshipment", lat: 1.29, lng: 103.85, kind: "port", tone: "stable", metric: "Dwell 1.9d", region: "Southeast Asia", major: true, labelSide: "right", labelDx: 10, labelDy: 15 },
  { id: "long-beach", label: "Long Beach", detail: "Receiving gateway", lat: 33.75, lng: -118.2, kind: "port", tone: "critical", metric: "Dwell +1.8d", region: "US West Coast", major: true, labelSide: "left", labelDx: -11, labelDy: 16 },
  { id: "oakland", label: "Oakland", detail: "Alternate gateway", lat: 37.8, lng: -122.27, kind: "port", tone: "stable", metric: "Space open", region: "US West Coast" },
  { id: "houston", label: "Houston", detail: "Receiving gateway", lat: 29.73, lng: -95.27, kind: "port", tone: "stable", metric: "Dwell 2.1d", region: "US Gulf", major: true, labelSide: "right", labelDx: 10, labelDy: 16 },
  { id: "savannah", label: "Savannah", detail: "Alternate gateway", lat: 32.08, lng: -81.09, kind: "port", tone: "stable", metric: "Rail fluid", region: "US East Coast" },
  { id: "rotterdam", label: "Rotterdam", detail: "European gateway", lat: 51.92, lng: 4.48, kind: "port", tone: "stable", metric: "Dwell 1.2d", region: "Northern Europe", major: true, labelSide: "right", labelDx: 10, labelDy: -8 },
  { id: "hamburg", label: "Hamburg", detail: "European gateway", lat: 53.55, lng: 9.99, kind: "port", tone: "watch", metric: "Labor watch", region: "Northern Europe" },
  { id: "antwerp", label: "Antwerp", detail: "European gateway", lat: 51.26, lng: 4.4, kind: "port", tone: "stable", metric: "Dwell 1.6d", region: "Northern Europe" },
  { id: "laredo", label: "Laredo", detail: "Customs crossing", lat: 27.51, lng: -99.5, kind: "crossing", tone: "watch", metric: "Packet incomplete", region: "US-Mexico", major: true, labelSide: "left", labelDx: -10, labelDy: -11 },
  { id: "suez", label: "Suez", detail: "Chokepoint", lat: 29.97, lng: 32.55, kind: "crossing", tone: "watch", metric: "War-risk +9%", region: "Red Sea", major: true, labelSide: "right", labelDx: 10, labelDy: 15 },
  { id: "panama", label: "Panama", detail: "Chokepoint", lat: 9.08, lng: -79.68, kind: "crossing", tone: "stable", metric: "Draft normal", region: "Central America", major: true, labelSide: "left", labelDx: -10, labelDy: 14 },
  { id: "malacca", label: "Malacca", detail: "Chokepoint", lat: 2.5, lng: 101.4, kind: "crossing", tone: "stable", metric: "Traffic normal", region: "Southeast Asia" },
  { id: "austin", label: "Austin", detail: "Final delivery", lat: 30.27, lng: -97.74, kind: "destination", tone: "stable", metric: "Launch site", region: "Texas", major: true, labelSide: "right", labelDx: 10, labelDy: -9 },
  { id: "phoenix", label: "Phoenix", detail: "Assembly site", lat: 33.45, lng: -112.07, kind: "destination", tone: "stable", metric: "4 orders", region: "Arizona" },
  { id: "chicago", label: "Chicago", detail: "Distribution center", lat: 41.88, lng: -87.63, kind: "destination", tone: "stable", metric: "2 orders", region: "Midwest" },
];

const MOVEMENTS: Movement[] = [
  {
    id: "po-1048",
    po: "PO-1048",
    supplier: "Kepler Precision",
    cargo: "12,000 CNC aluminum enclosures",
    route: "Dongguan / Yantian / Long Beach / Austin",
    routeNodes: ["dongguan", "yantian", "long-beach", "austin"],
    eta: "09 Sep, 16:00 CT",
    etd: "18 Aug, 22:00 CST",
    cost: "$7,780",
    costDelta: "+14.2% lane trend",
    status: "Broker hold",
    tone: "critical",
    mode: "Ocean FCL / 40HC",
    owner: "Mert Turna",
    incoterm: "FOB Yantian",
    container: "TLLU 483201-7",
    hsCode: "7616.99 review",
    riskScore: 73,
    confidence: 82,
    buffer: "4.2 days",
    nextDecision: "Confirm HTS treatment or release the broker-held booking before 14:00 PT.",
    signals: [
      { label: "Document packet", value: "6 of 7", tone: "critical" },
      { label: "Port dwell forecast", value: "+1.8d", tone: "watch" },
      { label: "Launch buffer", value: "4.2d", tone: "watch" },
      { label: "Rate position", value: "P62", tone: "neutral" },
    ],
    evidence: [
      { source: "Commercial invoice v4", age: "18m", confidence: "Direct" },
      { source: "Broker classification note", age: "42m", confidence: "Direct" },
      { source: "Modeled Long Beach dwell", age: "2h", confidence: "0.78" },
      { source: "Forwarder quote set", age: "3h", confidence: "4 sources" },
    ],
    timeline: [
      { label: "Supply confirmed", detail: "12,000 units released", time: "12 Aug 09:14", state: "complete", source: "Supplier email" },
      { label: "Documents", detail: "6 of 7 accepted", time: "13 Aug 11:42", state: "current", source: "Document packet" },
      { label: "Broker review", detail: "HTS 7616.99 treatment open", time: "Due 14:00 PT", state: "blocked", source: "Broker note" },
      { label: "Ocean booking", detail: "Space held, release pending", time: "Cutoff 18 Aug", state: "pending", source: "Forwarder quote" },
      { label: "Final delivery", detail: "Austin launch site", time: "09 Sep", state: "pending", source: "Scenario plan" },
    ],
  },
  {
    id: "po-1052",
    po: "PO-1052",
    supplier: "NovaForge Manufacturing",
    cargo: "8,400 sensor housings",
    route: "Penang / Singapore / Long Beach",
    routeNodes: ["penang", "singapore", "long-beach"],
    eta: "14 Sep, 10:00 PT",
    etd: "21 Aug, 18:00 MYT",
    cost: "$8,210",
    costDelta: "+2.1% to target",
    status: "On plan",
    tone: "stable",
    mode: "Ocean LCL",
    owner: "Oguzhan Turna",
    incoterm: "FCA Penang",
    container: "Consolidation LCL-552",
    hsCode: "7616.99 confirmed",
    riskScore: 24,
    confidence: 91,
    buffer: "8.6 days",
    nextDecision: "No intervention. Recheck vessel allocation after origin pickup.",
    signals: [
      { label: "Document packet", value: "Complete", tone: "stable" },
      { label: "Port dwell forecast", value: "1.9d", tone: "stable" },
      { label: "Launch buffer", value: "8.6d", tone: "stable" },
      { label: "Rate position", value: "P48", tone: "neutral" },
    ],
    evidence: [
      { source: "Supplier booking confirmation", age: "1h", confidence: "Direct" },
      { source: "Export document packet", age: "5h", confidence: "Direct" },
      { source: "Singapore dwell model", age: "2h", confidence: "0.86" },
    ],
    timeline: [
      { label: "Supplier confirmed", detail: "Capacity reserved", time: "12 Aug 08:20", state: "complete", source: "Supplier email" },
      { label: "Export documents", detail: "Packet complete", time: "13 Aug 14:08", state: "complete", source: "Document packet" },
      { label: "Origin pickup", detail: "Truck booked", time: "18 Aug 09:00", state: "current", source: "Forwarder plan" },
      { label: "Ocean movement", detail: "Via Singapore", time: "21 Aug", state: "pending", source: "Carrier schedule" },
      { label: "Receiving", detail: "Long Beach CFS", time: "14 Sep", state: "pending", source: "Scenario plan" },
    ],
  },
  {
    id: "po-1037",
    po: "PO-1037",
    supplier: "Sierra Metalworks",
    cargo: "3,200 battery brackets",
    route: "Monterrey / Laredo / Austin",
    routeNodes: ["monterrey", "laredo", "austin"],
    eta: "23 Aug, 14:00 CT",
    etd: "21 Aug, 06:00 CST",
    cost: "$3,460",
    costDelta: "+5.4% to target",
    status: "Documents open",
    tone: "watch",
    mode: "Truck FTL",
    owner: "Mert Turna",
    incoterm: "DAP Austin",
    container: "Trailer pending",
    hsCode: "8708.99 confirmed",
    riskScore: 51,
    confidence: 77,
    buffer: "2.8 days",
    nextDecision: "Obtain the corrected commercial invoice before the Laredo broker cutoff.",
    signals: [
      { label: "Commercial invoice", value: "Revision", tone: "watch" },
      { label: "Border slot", value: "Held", tone: "stable" },
      { label: "Production", value: "Ready", tone: "stable" },
      { label: "Delivery buffer", value: "2.8d", tone: "watch" },
    ],
    evidence: [
      { source: "Packing list", age: "32m", confidence: "Direct" },
      { source: "Invoice revision request", age: "1h", confidence: "Direct" },
      { source: "Laredo crossing slot", age: "4h", confidence: "Direct" },
    ],
    timeline: [
      { label: "Production", detail: "Cargo ready", time: "13 Aug 15:12", state: "complete", source: "Supplier email" },
      { label: "Commercial invoice", detail: "Revision requested", time: "Due 16:00 CT", state: "current", source: "Broker request" },
      { label: "Broker packet", detail: "Waiting for invoice", time: "Cutoff 20 Aug", state: "blocked", source: "Customs desk" },
      { label: "Border crossing", detail: "Laredo slot held", time: "22 Aug", state: "pending", source: "Carrier plan" },
      { label: "Final delivery", detail: "Austin", time: "23 Aug", state: "pending", source: "Scenario plan" },
    ],
  },
  {
    id: "po-1061",
    po: "PO-1061",
    supplier: "ForgeWest Components",
    cargo: "900 launch-critical enclosures",
    route: "Reno / Austin",
    routeNodes: ["reno", "austin"],
    eta: "17 Aug, 08:00 CT",
    etd: "14 Aug, 17:00 PT",
    cost: "$5,930",
    costDelta: "+28.4% emergency",
    status: "Alternate ready",
    tone: "neutral",
    mode: "Truck LTL",
    owner: "Mert Turna",
    incoterm: "DAP Austin",
    container: "LTL PRO pending",
    hsCode: "Domestic",
    riskScore: 18,
    confidence: 88,
    buffer: "12.4 days",
    nextDecision: "Use only if PO-1048 loses more than three days of launch buffer.",
    signals: [
      { label: "Capacity", value: "900 units", tone: "stable" },
      { label: "Dispatch", value: "24h", tone: "stable" },
      { label: "Premium", value: "+28.4%", tone: "watch" },
      { label: "Quality", value: "Accepted", tone: "stable" },
    ],
    evidence: [
      { source: "Capacity confirmation", age: "48m", confidence: "Direct" },
      { source: "Prior lot inspection", age: "21d", confidence: "Verified" },
      { source: "LTL budget quote", age: "2h", confidence: "Direct" },
    ],
    timeline: [
      { label: "Capacity check", detail: "900 units available", time: "13 Aug 08:14", state: "complete", source: "Supplier email" },
      { label: "Quality evidence", detail: "Prior lot accepted", time: "13 Aug 08:20", state: "complete", source: "Inspection record" },
      { label: "Price approval", detail: "+28.4% emergency premium", time: "Open", state: "current", source: "Scenario plan" },
      { label: "Pickup", detail: "Can dispatch in 24h", time: "On approval", state: "pending", source: "Supplier note" },
      { label: "Final delivery", detail: "Austin", time: "17 Aug", state: "pending", source: "Scenario plan" },
    ],
  },
  {
    id: "po-1064",
    po: "PO-1064",
    supplier: "Qingdao Motion Systems",
    cargo: "2,600 servo motor assemblies",
    route: "Suzhou / Shanghai / Oakland / Austin",
    routeNodes: ["suzhou", "shanghai", "oakland", "austin"],
    eta: "19 Sep, 12:00 CT",
    etd: "24 Aug, 20:00 CST",
    cost: "$9,180",
    costDelta: "+8.4% to history",
    status: "Rate watch",
    tone: "watch",
    mode: "Ocean FCL / 20GP",
    owner: "Oguzhan Turna",
    incoterm: "FOB Shanghai",
    container: "20GP pending",
    hsCode: "8501.52 confirmed",
    riskScore: 46,
    confidence: 79,
    buffer: "6.1 days",
    nextDecision: "Hold the Oakland option while the forwarder reprices Long Beach.",
    signals: [
      { label: "Rate change", value: "+8.4%", tone: "watch" },
      { label: "Gateway option", value: "Oakland", tone: "stable" },
      { label: "Documents", value: "5 of 5", tone: "stable" },
      { label: "Schedule", value: "2 options", tone: "neutral" },
    ],
    evidence: [
      { source: "Carrier schedule pair", age: "2h", confidence: "2 sources" },
      { source: "Supplier export packet", age: "7h", confidence: "Direct" },
      { source: "Lane rate history", age: "1d", confidence: "18 quotes" },
    ],
    timeline: [
      { label: "Production allocation", detail: "2,600 units allocated", time: "12 Aug", state: "complete", source: "Supplier email" },
      { label: "Export packet", detail: "Complete", time: "13 Aug", state: "complete", source: "Document packet" },
      { label: "Routing decision", detail: "Oakland vs Long Beach", time: "Due 15 Aug", state: "current", source: "Quote set" },
      { label: "Ocean booking", detail: "Two sailings held", time: "24 Aug", state: "pending", source: "Forwarder plan" },
      { label: "Final delivery", detail: "Austin", time: "19 Sep", state: "pending", source: "Scenario plan" },
    ],
  },
  {
    id: "po-1029",
    po: "PO-1029",
    supplier: "Helios Polymers",
    cargo: "18 metric tons flame-retardant resin",
    route: "Rotterdam / Houston / Austin",
    routeNodes: ["rotterdam-supplier", "rotterdam", "houston", "austin"],
    eta: "28 Aug, 09:00 CT",
    etd: "14 Aug, 12:00 CET",
    cost: "$6,640",
    costDelta: "-3.2% to history",
    status: "On plan",
    tone: "stable",
    mode: "Ocean FCL / 20GP",
    owner: "Mert Turna",
    incoterm: "CFR Houston",
    container: "MSCU 209518-4",
    hsCode: "3907.99 confirmed",
    riskScore: 21,
    confidence: 90,
    buffer: "9.3 days",
    nextDecision: "No intervention. Monitor Houston discharge and rail handoff.",
    signals: [
      { label: "Allocation", value: "Secured", tone: "stable" },
      { label: "DG status", value: "Non-DG", tone: "stable" },
      { label: "Port dwell", value: "2.1d", tone: "stable" },
      { label: "Rate position", value: "P41", tone: "stable" },
    ],
    evidence: [
      { source: "Carrier booking", age: "35m", confidence: "Direct" },
      { source: "SDS and product declaration", age: "6h", confidence: "Verified" },
      { source: "Houston dwell model", age: "2h", confidence: "0.84" },
    ],
    timeline: [
      { label: "Allocation", detail: "18 MT released", time: "10 Aug", state: "complete", source: "Supplier record" },
      { label: "Compliance", detail: "SDS accepted", time: "11 Aug", state: "complete", source: "Document packet" },
      { label: "Vessel departure", detail: "Booking confirmed", time: "14 Aug", state: "current", source: "Carrier booking" },
      { label: "Houston discharge", detail: "Terminal slot modeled", time: "26 Aug", state: "pending", source: "Scenario plan" },
      { label: "Final delivery", detail: "Austin", time: "28 Aug", state: "pending", source: "Scenario plan" },
    ],
  },
];

const EXCEPTIONS: ExceptionItem[] = [
  { id: "ex-101", code: "CUS-14", severity: "critical", title: "Classification blocks booking release", summary: "PO-1048 has one unresolved HTS treatment in the broker packet.", impact: "4.2 days of launch buffer remain", owner: "Mert", age: "18m", movementId: "po-1048", sources: 4 },
  { id: "ex-102", code: "DOC-07", severity: "watch", title: "Invoice revision due before border cutoff", summary: "Sierra Metalworks must correct consignee and valuation fields.", impact: "Laredo slot expires in 31h", owner: "Mert", age: "1h", movementId: "po-1037", sources: 3 },
  { id: "ex-103", code: "RATE-22", severity: "watch", title: "Shanghai rate moved above lane band", summary: "The current quote is 8.4% above the trailing approved rate set.", impact: "$710 modeled exposure", owner: "Oguzhan", age: "2h", movementId: "po-1064", sources: 18 },
  { id: "ex-104", code: "PORT-09", severity: "info", title: "Long Beach dwell forecast increased", summary: "Modeled terminal dwell moved from 2.4 to 4.2 days.", impact: "Two inbound movements exposed", owner: "System", age: "2h", movementId: "po-1052", sources: 2 },
];

const SUPPLIERS: Supplier[] = [
  { id: "kepler", name: "Kepler Precision", location: "Dongguan, China", product: "CNC aluminum enclosures", role: "Current supplier", tier: "Tier 1", score: 78, risk: "Medium", response: "3h 18m", ready: "88% on time", documents: "94% complete", price: "+6.2% vs last PO", share: "72%", capacity: "18k units / month", leadTime: "24 days", facility: "ISO 9001, 18 machines", gateway: "Yantian, 54 km", audit: "18 Jun 2026", note: "Strong production record. Concentration and open classification work make this the highest current exposure." },
  { id: "novaforge", name: "NovaForge Manufacturing", location: "Penang, Malaysia", product: "CNC aluminum enclosures", role: "Qualified alternate", tier: "Tier 1 alternate", score: 91, risk: "Low", response: "1h 42m", ready: "95% on time", documents: "98% complete", price: "+2.1% vs target", share: "18%", capacity: "12k units / month", leadTime: "21 days", facility: "ISO 9001, IATF line", gateway: "Penang Port, 22 km", audit: "02 Jul 2026", note: "Best resilience option for the enclosure family. Higher unit price is offset by cleaner documents and lower country concentration." },
  { id: "sierra", name: "Sierra Metalworks", location: "Monterrey, Mexico", product: "Machined assemblies", role: "Nearshore candidate", tier: "Qualification", score: 74, risk: "Medium", response: "6h 05m", ready: "No history", documents: "Sample approved", price: "+11.8% vs target", share: "0%", capacity: "7k units / month", leadTime: "12 days", facility: "ISO 9001, 9 machines", gateway: "Laredo, 226 km", audit: "Remote review", note: "Nearshore option removes ocean dependency. Customs document discipline still needs validation through two live orders." },
  { id: "forgewest", name: "ForgeWest Components", location: "Reno, United States", product: "Low-volume enclosures", role: "Emergency source", tier: "Buffer", score: 81, risk: "Low", response: "48m", ready: "92% on time", documents: "Domestic", price: "+28.4% vs target", share: "4%", capacity: "2k units / month", leadTime: "5 days", facility: "AS9100 partner cell", gateway: "Domestic truck", audit: "11 May 2026", note: "Useful capacity buffer for launch-critical quantities. The cost structure does not support primary-source volume." },
  { id: "qingdao", name: "Qingdao Motion Systems", location: "Suzhou, China", product: "Servo motor assemblies", role: "Current supplier", tier: "Tier 1", score: 83, risk: "Medium", response: "2h 11m", ready: "91% on time", documents: "97% complete", price: "+8.4% vs history", share: "64%", capacity: "8k units / month", leadTime: "29 days", facility: "ISO 9001, UL program", gateway: "Shanghai, 108 km", audit: "04 Apr 2026", note: "Good quality and export evidence. Single-gateway dependence and recent rate movement need a second routing option." },
  { id: "helios", name: "Helios Polymers", location: "Rotterdam, Netherlands", product: "Flame-retardant resin", role: "Current supplier", tier: "Tier 1", score: 88, risk: "Low", response: "1h 06m", ready: "96% on time", documents: "100% complete", price: "-3.2% vs history", share: "52%", capacity: "90 MT / month", leadTime: "16 days", facility: "REACH and ISO 14001", gateway: "Rotterdam, 14 km", audit: "29 Jun 2026", note: "Stable supply and complete compliance evidence. A second resin source is still needed for allocation risk." },
];

const QUOTES: Quote[] = [
  { id: "blueharbor", movementId: "po-1048", partner: "BlueHarbor Logistics", source: "Derya network", route: "Yantian / Long Beach / Austin", price: 7780, delta: "+4.1% vs P50", transit: "22-25d", reliability: "93%", fit: 92, freeDays: "5 + 4", emissions: "3.8 tCO2e", valid: "2d 4h", flag: "Recommended" },
  { id: "apex", movementId: "po-1048", partner: "Apex Global", source: "Atlas forwarder", route: "Yantian / Long Beach / Austin", price: 8050, delta: "+7.7% vs P50", transit: "23-27d", reliability: "96%", fit: 88, freeDays: "7 + 5", emissions: "3.9 tCO2e", valid: "1d 9h", flag: "Most reliable" },
  { id: "northstar", movementId: "po-1048", partner: "Northstar Freight", source: "Derya network", route: "Yantian / Houston / Austin", price: 8460, delta: "+13.2% vs P50", transit: "30-34d", reliability: "90%", fit: 71, freeDays: "6 + 4", emissions: "4.4 tCO2e", valid: "3d 1h", flag: "Port alternate" },
  { id: "atlasair", movementId: "po-1048", partner: "Atlas Air Desk", source: "Atlas forwarder", route: "Shenzhen / DFW / Austin", price: 28940, delta: "+287% vs P50", transit: "4-6d", reliability: "97%", fit: 58, freeDays: "n/a", emissions: "22.7 tCO2e", valid: "18h", flag: "Recovery only" },
  { id: "pacific-oakland", movementId: "po-1064", partner: "Pacific Bridge Logistics", source: "Derya network", route: "Shanghai / Oakland / Austin", price: 8390, delta: "-0.9% vs P50", transit: "24-27d", reliability: "91%", fit: 94, freeDays: "6 + 4", emissions: "4.1 tCO2e", valid: "22h", flag: "Recommended" },
  { id: "apex-oakland", movementId: "po-1064", partner: "Apex Global", source: "Atlas forwarder", route: "Shanghai / Oakland / Austin", price: 8620, delta: "+1.8% vs P50", transit: "23-26d", reliability: "93%", fit: 90, freeDays: "7 + 5", emissions: "4.2 tCO2e", valid: "1d 6h", flag: "Most reliable" },
  { id: "blueharbor-lb", movementId: "po-1064", partner: "BlueHarbor Logistics", source: "Derya network", route: "Shanghai / Long Beach / Austin", price: 8780, delta: "+3.7% vs P50", transit: "22-28d", reliability: "86%", fit: 77, freeDays: "5 + 4", emissions: "4.0 tCO2e", valid: "2d 2h", flag: "Gateway alternate" },
  { id: "atlasair-servo", movementId: "po-1064", partner: "Atlas Air Desk", source: "Atlas forwarder", route: "Shanghai / DFW / Austin", price: 31200, delta: "+268% vs P50", transit: "4-6d", reliability: "97%", fit: 55, freeDays: "n/a", emissions: "24.1 tCO2e", valid: "16h", flag: "Recovery only" },
];

function defaultAssessmentFor(movement: Movement): ExceptionItem {
  return {
    id: `plan-${movement.id}`,
    code: movement.tone === "stable" ? "PLAN-OK" : "PLAN-WATCH",
    severity: movement.tone === "critical" ? "critical" : movement.tone === "watch" ? "watch" : "info",
    title: movement.status,
    summary: movement.nextDecision,
    impact: `${movement.buffer} modeled buffer`,
    owner: movement.owner,
    age: "Current",
    movementId: movement.id,
    sources: movement.evidence.length,
  };
}

const PERMISSIONS: Array<{ key: PermissionKey; label: string; detail: string; guard: string }> = [
  { key: "supplier", label: "Supplier follow-up", detail: "Request missing facts, documents, and cargo-ready dates.", guard: "No commercial commitment" },
  { key: "forwarder", label: "Forwarder RFQs", detail: "Contact approved forwarders and normalize responses.", guard: "Approved partner list only" },
  { key: "broker", label: "Customs preparation", detail: "Assemble evidence and draft classification questions.", guard: "Broker files and approves" },
  { key: "pickup", label: "Pickup scheduling", detail: "Reserve a pickup after plan and spend approval.", guard: "Human spend approval" },
  { key: "updates", label: "Stakeholder updates", detail: "Draft and send milestone updates on approved channels.", guard: "Approved recipients only" },
];

const NETWORK_EVENTS = [
  { time: "08:42", tone: "critical" as Tone, code: "CUS-14", title: "Broker packet stopped", detail: "PO-1048 / HTS treatment unresolved", source: "Broker note" },
  { time: "08:31", tone: "watch" as Tone, code: "PORT-09", title: "Dwell forecast changed", detail: "Long Beach / +1.8 days", source: "Modeled port feed" },
  { time: "08:12", tone: "stable" as Tone, code: "DOC-02", title: "Export packet accepted", detail: "PO-1052 / 7 documents", source: "Document review" },
  { time: "07:54", tone: "watch" as Tone, code: "RATE-22", title: "Quote outside lane band", detail: "Shanghai / Oakland / +8.4%", source: "18 quote observations" },
  { time: "07:21", tone: "stable" as Tone, code: "SUP-06", title: "Capacity reconfirmed", detail: "ForgeWest / 900 units / 24h", source: "Supplier email" },
];

function project(lat: number, lng: number) {
  return {
    x: ((lng + 180) / 360) * 1000,
    y: ((90 - lat) / 180) * 500,
  };
}

function nodeById(id: string) {
  return NETWORK_NODES.find((node) => node.id === id) ?? NETWORK_NODES[0];
}

function point(id: string) {
  const node = nodeById(id);
  return project(node.lat, node.lng);
}

function landPath(fromId: string, toId: string, bend = 0) {
  const from = point(fromId);
  const to = point(toId);
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2 - bend;
  return `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} Q ${midX.toFixed(1)} ${midY.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}

function movementPaths(id: string) {
  const yantian = point("yantian");
  const shanghai = point("shanghai");
  const singapore = point("singapore");
  const longBeach = point("long-beach");
  const oakland = point("oakland");
  if (id === "po-1048") return [landPath("dongguan", "yantian"), `M ${yantian.x} ${yantian.y} Q 930 104 998 188`, `M 2 188 Q 72 126 ${longBeach.x} ${longBeach.y}`, landPath("long-beach", "austin", 18)];
  if (id === "po-1052") return [landPath("penang", "singapore"), `M ${singapore.x} ${singapore.y} Q 935 205 998 232`, `M 2 232 Q 88 160 ${longBeach.x} ${longBeach.y}`];
  if (id === "po-1037") return [landPath("monterrey", "laredo", 10), landPath("laredo", "austin", 6)];
  if (id === "po-1061") return [landPath("reno", "austin", 28)];
  if (id === "po-1064") return [landPath("suzhou", "shanghai"), `M ${shanghai.x} ${shanghai.y} Q 938 94 998 175`, `M 2 175 Q 64 122 ${oakland.x} ${oakland.y}`, landPath("oakland", "austin", 23)];
  return [landPath("rotterdam-supplier", "rotterdam"), landPath("rotterdam", "houston", 64), landPath("houston", "austin", 8)];
}

function toneLabel(tone: Tone) {
  if (tone === "critical") return "Critical";
  if (tone === "watch") return "Watch";
  if (tone === "stable") return "Stable";
  return "Reference";
}

function MapWorkspace({
  mapMode,
  setMapMode,
  selectedMovementId,
  setSelectedMovementId,
  selectedNodeId,
  setSelectedNodeId,
  layers,
  setLayers,
  expanded = false,
}: {
  mapMode: MapMode;
  setMapMode: (mode: MapMode) => void;
  selectedMovementId: string;
  setSelectedMovementId: (id: string) => void;
  selectedNodeId: string;
  setSelectedNodeId: (id: string) => void;
  layers: Record<NetworkLayerKey, boolean>;
  setLayers: (layers: Record<NetworkLayerKey, boolean>) => void;
  expanded?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [zoom, setZoom] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRange>("7d");
  const normalizedSearch = search.trim().toLowerCase();
  const selectedNode = nodeById(selectedNodeId);
  const focus = project(selectedNode.lat, selectedNode.lng);
  const zoomedWidth = 1000 / zoom;
  const zoomedHeight = 500 / zoom;
  const focusX = Math.max(0, Math.min(1000 - zoomedWidth, focus.x - zoomedWidth / 2));
  const focusY = Math.max(0, Math.min(500 - zoomedHeight, focus.y - zoomedHeight / 2));
  const viewBox = zoom === 1 ? WORLD_MAP_VIEWBOX : `${focusX.toFixed(1)} ${focusY.toFixed(1)} ${zoomedWidth.toFixed(1)} ${zoomedHeight.toFixed(1)}`;
  const searchResults = normalizedSearch.length < 2 ? [] : [
    ...MOVEMENTS.map((movement) => ({ id: movement.id, type: "movement" as const, label: `${movement.po} / ${movement.supplier}`, detail: movement.route })),
    ...NETWORK_NODES.map((node) => ({ id: node.id, type: "node" as const, label: node.label, detail: `${node.detail} / ${node.metric}` })),
  ].filter((item) => `${item.label} ${item.detail}`.toLowerCase().includes(normalizedSearch)).slice(0, 7);
  const visibleNodes = NETWORK_NODES.filter((node) => {
    if (node.kind === "supplier") return layers.suppliers;
    if (node.kind === "port" || node.kind === "crossing") return layers.ports;
    return true;
  });
  const filterEntries: Array<{ key: NetworkLayerKey; label: string; count: string }> = [
    { key: "suppliers", label: "Supplier facilities", count: "6" },
    { key: "ports", label: "Ports and crossings", count: "16" },
    { key: "routes", label: "Planned movements", count: "6" },
    { key: "milestones", label: "Movement positions", count: "12" },
    { key: "risk", label: "Risk areas", count: "4" },
    { key: "density", label: "Modeled lane density", count: "5" },
  ];

  return (
    <figure className={styles.mapWorkspace} data-mode={mapMode} data-expanded={expanded}>
      <div className={styles.mapTopbar}>
        <div className={styles.networkSearch}>
          <Icon name="search" size={14} />
          <label htmlFor={expanded ? "network-search-expanded" : "network-search-command"}>Search network</label>
          <input
            id={expanded ? "network-search-expanded" : "network-search-command"}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="PO, supplier, port, container"
          />
          <kbd>⌘ K</kbd>
          {searchResults.length > 0 ? (
            <div className={styles.searchResults}>
              {searchResults.map((result) => (
                <button
                  key={`${result.type}-${result.id}`}
                  type="button"
                  onClick={() => {
                    if (result.type === "movement") {
                      setSelectedMovementId(result.id);
                      const movement = MOVEMENTS.find((item) => item.id === result.id) ?? MOVEMENTS[0];
                      setSelectedNodeId(movement.routeNodes[1] ?? movement.routeNodes[0]);
                    } else {
                      setSelectedNodeId(result.id);
                    }
                    setZoom(1.45);
                    setSearch("");
                  }}
                >
                  <span>{result.type}</span>
                  <strong>{result.label}</strong>
                  <small>{result.detail}</small>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className={styles.mapModeTabs} aria-label="Analysis mode">
          {(["operations", "risk", "cost", "customs"] as MapMode[]).map((mode) => (
            <button key={mode} type="button" data-active={mapMode === mode} onClick={() => setMapMode(mode)}>{mode}</button>
          ))}
        </div>
        <div className={styles.timeRange} aria-label="Time range">
          {(["24h", "7d", "30d"] as TimeRange[]).map((range) => <button type="button" key={range} data-active={timeRange === range} onClick={() => setTimeRange(range)}>{range}</button>)}
        </div>
        <button type="button" className={styles.layerButton} data-active={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>
          <Icon name="layers" size={13} /> Layers <span>{filterEntries.filter((entry) => layers[entry.key]).length}</span>
        </button>
      </div>

      <svg viewBox={viewBox} role="img" aria-label="Modeled supply network with suppliers, ports, routes, customs crossings, and risk areas">
        <rect width="1000" height="500" className={styles.mapOcean} />
        <g className={styles.mapGrid}>
          {[62.5, 125, 187.5, 250, 312.5, 375, 437.5].map((y) => <path key={`lat-${y}`} d={`M 0 ${y} H 1000`} />)}
          {[125, 250, 375, 500, 625, 750, 875].map((x) => <path key={`lng-${x}`} d={`M ${x} 0 V 500`} />)}
        </g>
        <g className={styles.mapLand}>{WORLD_MAP_LAND_PATHS.map((pathValue, index) => <path key={`land-${index}`} d={pathValue} />)}</g>

        {layers.density ? (
          <g className={styles.tradeDensity} aria-label="Modeled lane density">
            <path d={landPath("rotterdam", "suez", 20)} />
            <path d={landPath("suez", "singapore", -18)} />
            <path d={landPath("singapore", "shanghai", 12)} />
            <path d={landPath("houston", "panama", 18)} />
            <path d={landPath("panama", "long-beach", -25)} />
            <path d={landPath("rotterdam", "savannah", 55)} />
            <path d={landPath("busan", "singapore", -20)} />
          </g>
        ) : null}

        {layers.risk ? (
          <g className={styles.riskZones}>
            <g data-tone="critical"><ellipse cx={point("long-beach").x} cy={point("long-beach").y} rx="38" ry="24" /><text x={point("long-beach").x - 34} y={point("long-beach").y - 28}>DWELL +1.8D</text></g>
            <g data-tone="watch"><ellipse cx={point("yantian").x} cy={point("yantian").y} rx="30" ry="21" /><text x={point("yantian").x - 28} y={point("yantian").y - 25}>ORIGIN WATCH</text></g>
            <g data-tone="watch"><ellipse cx={point("suez").x} cy={point("suez").y} rx="27" ry="17" /><text x={point("suez").x - 23} y={point("suez").y - 21}>WAR RISK</text></g>
            <g data-tone="watch"><ellipse cx={point("laredo").x} cy={point("laredo").y} rx="23" ry="16" /><text x={point("laredo").x - 20} y={point("laredo").y - 20}>DOC HOLD</text></g>
          </g>
        ) : null}

        {mapMode === "customs" ? (
          <g className={styles.customsZones}>
            <path d="M 150 110 V 275" />
            <path d="M 225 115 V 280" />
            <circle cx={point("laredo").x} cy={point("laredo").y} r="18" />
            <circle cx={point("long-beach").x} cy={point("long-beach").y} r="18" />
          </g>
        ) : null}

        {layers.routes ? (
          <g className={styles.movementRoutes}>
            {MOVEMENTS.map((movement) => (
              <g
                key={movement.id}
                role="button"
                tabIndex={0}
                data-tone={movement.tone}
                data-selected={movement.id === selectedMovementId}
                onClick={() => {
                  setSelectedMovementId(movement.id);
                  setSelectedNodeId(movement.routeNodes[1] ?? movement.routeNodes[0]);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    setSelectedMovementId(movement.id);
                    setSelectedNodeId(movement.routeNodes[1] ?? movement.routeNodes[0]);
                  }
                }}
              >
                <title>{`${movement.po}: ${movement.route}`}</title>
                {movementPaths(movement.id).map((pathValue, index) => <path key={`${movement.id}-${index}`} d={pathValue} />)}
              </g>
            ))}
          </g>
        ) : null}

        {layers.milestones ? (
          <g className={styles.movementMarkers}>
            <polygon data-tone="critical" data-selected={selectedMovementId === "po-1048"} points="0,-6 11,0 0,6 3,0" transform="translate(962 180) rotate(14)" />
            <polygon data-tone="stable" data-selected={selectedMovementId === "po-1052"} points="0,-5 10,0 0,5 3,0" transform="translate(949 225) rotate(12)" />
            <polygon data-tone="watch" data-selected={selectedMovementId === "po-1064"} points="0,-5 10,0 0,5 3,0" transform="translate(48 165) rotate(-18)" />
            <polygon data-tone="stable" data-selected={selectedMovementId === "po-1029"} points="0,-5 10,0 0,5 3,0" transform="translate(352 168) rotate(-10)" />
          </g>
        ) : null}

        <g className={styles.networkNodes}>
          {visibleNodes.map((node) => {
            const position = project(node.lat, node.lng);
            const selected = node.id === selectedNodeId;
            const left = node.labelSide === "left";
            return (
              <g
                key={node.id}
                role="button"
                tabIndex={0}
                data-kind={node.kind}
                data-tone={node.tone}
                data-selected={selected}
                onClick={() => { setSelectedNodeId(node.id); setZoom(Math.max(zoom, 1.25)); }}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedNodeId(node.id); }}
              >
                <title>{`${node.label}: ${node.detail}, ${node.metric}`}</title>
                <circle className={styles.nodeHalo} cx={position.x} cy={position.y} r={selected ? 15 : 10} />
                {node.kind === "supplier" ? <polygon points={`${position.x},${position.y - 6} ${position.x + 6},${position.y + 5} ${position.x - 6},${position.y + 5}`} /> : <circle cx={position.x} cy={position.y} r={node.kind === "destination" ? 5.5 : 4.5} />}
                {(node.major || selected) ? (
                  <text x={position.x + (node.labelDx ?? (left ? -10 : 10))} y={position.y + (node.labelDy ?? -8)} textAnchor={left ? "end" : "start"}>{node.label}</text>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>

      <div className={styles.mapLegend}>
        <span><i data-legend="supplier" />Supplier</span>
        <span><i data-legend="port" />Port</span>
        <span><i data-legend="movement" />Movement</span>
        <span><i data-legend="risk" />Exposure</span>
      </div>

      {filtersOpen ? (
        <aside className={styles.layerPanel}>
          <header><div><span>Display controls</span><strong>Network layers</strong></div><button type="button" onClick={() => setFiltersOpen(false)}><Icon name="x" size={14} /></button></header>
          <div className={styles.layerList}>
            {filterEntries.map((entry) => (
              <label key={entry.key}>
                <input type="checkbox" checked={layers[entry.key]} onChange={() => setLayers({ ...layers, [entry.key]: !layers[entry.key] })} />
                <i />
                <strong>{entry.label}</strong>
                <small>{entry.count}</small>
              </label>
            ))}
          </div>
          <footer><span>Display state</span><strong>{filterEntries.filter((entry) => layers[entry.key]).length} of {filterEntries.length} layers active</strong></footer>
        </aside>
      ) : null}

      <div className={styles.mapNodePlate}>
        <span>{selectedNode.kind} / {selectedNode.region}</span>
        <strong>{selectedNode.label}</strong>
        <small>{selectedNode.detail}</small>
        <div><i data-tone={selectedNode.tone} />{selectedNode.metric}</div>
      </div>

      <div className={styles.mapZoom}>
        <button type="button" aria-label="Zoom in" onClick={() => setZoom(Math.min(2.2, zoom + 0.2))}>+</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label="Zoom out" onClick={() => setZoom(Math.max(1, zoom - 0.2))}>-</button>
      </div>

      <figcaption>
        <span>Natural Earth geography / modeled operational layer</span>
        <strong>No live AIS, GPS, carrier, customs, or port feed is connected</strong>
        <span>Cursor: {selectedNode.lat.toFixed(2)}, {selectedNode.lng.toFixed(2)}</span>
      </figcaption>
    </figure>
  );
}

export function SupplyOsWorkspace() {
  const [view, setView] = useState<ViewId>("command");
  const [mapMode, setMapMode] = useState<MapMode>("operations");
  const [selectedMovementId, setSelectedMovementId] = useState("po-1048");
  const [selectedNodeId, setSelectedNodeId] = useState("long-beach");
  const [selectedExceptionId, setSelectedExceptionId] = useState("ex-101");
  const [selectedSupplierId, setSelectedSupplierId] = useState("kepler");
  const [selectedQuoteId, setSelectedQuoteId] = useState("blueharbor");
  const [approvedQuoteId, setApprovedQuoteId] = useState<string | null>(null);
  const [reviewedExceptions, setReviewedExceptions] = useState<string[]>([]);
  const [networkLayers, setNetworkLayers] = useState<Record<NetworkLayerKey, boolean>>({ suppliers: true, ports: true, routes: true, risk: true, milestones: true, density: true });
  const [mode, setMode] = useState<AuthorityMode>("coordinate");
  const [permissions, setPermissions] = useState<Record<PermissionKey, boolean>>({ supplier: true, forwarder: true, broker: true, pickup: false, updates: false });
  const [scenario, setScenario] = useState("Protect the September launch. Keep landed logistics below $8,500 per container and preserve one qualified alternate for every critical part family.");
  const [scenarioState, setScenarioState] = useState("Current model");
  const selectedMovement = useMemo(() => MOVEMENTS.find((item) => item.id === selectedMovementId) ?? MOVEMENTS[0], [selectedMovementId]);
  const selectedException = useMemo(
    () => resolveMovementAssessment(selectedMovement.id, selectedExceptionId, EXCEPTIONS) ?? defaultAssessmentFor(selectedMovement),
    [selectedExceptionId, selectedMovement],
  );

  function selectException(item: ExceptionItem) {
    setSelectedExceptionId(item.id);
    setSelectedMovementId(item.movementId);
    const movement = MOVEMENTS.find((candidate) => candidate.id === item.movementId) ?? MOVEMENTS[0];
    setSelectedNodeId(movement.routeNodes[1] ?? movement.routeNodes[0]);
  }

  return (
    <div className={`${styles.workspace} supply-os-workspace`}>
      <header className={styles.workspaceHeader}>
        <div className={styles.titleBlock}>
          <span>Atlas Robotics / Global inbound</span>
          <div><h1>Supply Command</h1><span className={styles.classification}>Modeled workspace</span></div>
          <p>One operating picture for suppliers, freight, customs, cost, and delivery risk.</p>
        </div>
        <div className={styles.systemState}>
          <div><span>Network state</span><strong><i data-tone="watch" /> 4 exceptions</strong></div>
          <div><span>Data coverage</span><strong>91%</strong></div>
          <div><span>Last model run</span><strong>08:42 PT</strong></div>
          <button type="button" onClick={() => setScenarioState("Briefing ready")}><Icon name="file-check" size={14} />{scenarioState === "Briefing ready" ? "Briefing ready" : "Generate briefing"}</button>
        </div>
      </header>

      <nav className={styles.workspaceNav} aria-label="Supply Command sections">
        {VIEWS.map((item) => (
          <button key={item.id} type="button" data-active={view === item.id} aria-current={view === item.id ? "page" : undefined} onClick={() => setView(item.id)}>
            {item.label}{item.count ? <span>{item.count}</span> : null}
          </button>
        ))}
        <div className={styles.navState}><i />Decision support only</div>
      </nav>

      {view === "command" ? (
        <CommandView
          scenario={scenario}
          setScenario={setScenario}
          scenarioState={scenarioState}
          setScenarioState={setScenarioState}
          mapMode={mapMode}
          setMapMode={setMapMode}
          selectedMovement={selectedMovement}
          setSelectedMovementId={setSelectedMovementId}
          selectedNodeId={selectedNodeId}
          setSelectedNodeId={setSelectedNodeId}
          selectedException={selectedException}
          selectException={selectException}
          reviewedExceptions={reviewedExceptions}
          setReviewedExceptions={setReviewedExceptions}
          networkLayers={networkLayers}
          setNetworkLayers={setNetworkLayers}
          setView={setView}
        />
      ) : null}
      {view === "network" ? (
        <NetworkView
          mapMode={mapMode}
          setMapMode={setMapMode}
          selectedMovement={selectedMovement}
          setSelectedMovementId={setSelectedMovementId}
          selectedNodeId={selectedNodeId}
          setSelectedNodeId={setSelectedNodeId}
          networkLayers={networkLayers}
          setNetworkLayers={setNetworkLayers}
        />
      ) : null}
      {view === "suppliers" ? <SuppliersView selectedSupplierId={selectedSupplierId} setSelectedSupplierId={setSelectedSupplierId} setSelectedMovementId={setSelectedMovementId} setView={setView} /> : null}
      {view === "procurement" ? <ProcurementView selectedMovement={selectedMovement} selectedQuoteId={selectedQuoteId} setSelectedQuoteId={setSelectedQuoteId} approvedQuoteId={approvedQuoteId} setApprovedQuoteId={setApprovedQuoteId} /> : null}
      {view === "execution" ? <ExecutionView selectedMovement={selectedMovement} setSelectedMovementId={setSelectedMovementId} approvedQuoteId={approvedQuoteId} setView={setView} /> : null}
      {view === "control" ? <ControlView mode={mode} setMode={setMode} permissions={permissions} setPermissions={setPermissions} /> : null}

      <footer className={styles.workspaceFooter}>
        <span><i /> Prototype environment</span>
        <p>All records on this page are fictional. Controls update local review state only. No messages, bookings, filings, posts, or external writes occur.</p>
        <span>Policy DS-04 / human approval required</span>
      </footer>
    </div>
  );
}

function CommandView({
  scenario,
  setScenario,
  scenarioState,
  setScenarioState,
  mapMode,
  setMapMode,
  selectedMovement,
  setSelectedMovementId,
  selectedNodeId,
  setSelectedNodeId,
  selectedException,
  selectException,
  reviewedExceptions,
  setReviewedExceptions,
  networkLayers,
  setNetworkLayers,
  setView,
}: {
  scenario: string;
  setScenario: (value: string) => void;
  scenarioState: string;
  setScenarioState: (value: string) => void;
  mapMode: MapMode;
  setMapMode: (mode: MapMode) => void;
  selectedMovement: Movement;
  setSelectedMovementId: (id: string) => void;
  selectedNodeId: string;
  setSelectedNodeId: (id: string) => void;
  selectedException: ExceptionItem;
  selectException: (item: ExceptionItem) => void;
  reviewedExceptions: string[];
  setReviewedExceptions: (ids: string[]) => void;
  networkLayers: Record<NetworkLayerKey, boolean>;
  setNetworkLayers: (layers: Record<NetworkLayerKey, boolean>) => void;
  setView: (view: ViewId) => void;
}) {
  return (
    <div className={styles.commandView}>
      <section className={styles.scenarioBar}>
        <div><Icon name="sliders" size={14} /><span>Decision objective</span></div>
        <label htmlFor="supply-command-objective">Decision objective</label>
        <input id="supply-command-objective" value={scenario} onChange={(event) => { setScenario(event.target.value); setScenarioState("Unsaved changes"); }} />
        <button type="button" data-state={scenarioState === "Unsaved changes" ? "ready" : "idle"} onClick={() => setScenarioState("Model updated 08:47 PT")}>
          <Icon name="activity" size={14} />{scenarioState === "Unsaved changes" ? "Recompute" : scenarioState}
        </button>
      </section>

      <section className={styles.stateStrip} aria-label="Network status summary">
        <div data-tone="critical"><span>Critical</span><strong>1</strong><small>Blocks execution</small></div>
        <div data-tone="watch"><span>Attention</span><strong>3</strong><small>Decision due today</small></div>
        <div data-tone="stable"><span>On plan</span><strong>8</strong><small>Within approved buffer</small></div>
        <div data-tone="neutral"><span>Active value</span><strong>$412k</strong><small>Goods in scope</small></div>
        <div data-tone="neutral"><span>Modeled landed cost</span><strong>$51.3k</strong><small>Across 6 plans</small></div>
        <div data-tone="neutral"><span>Next cutoff</span><strong>5h 18m</strong><small>Broker release</small></div>
      </section>

      <div className={styles.commandLayout}>
        <aside className={styles.exceptionRail}>
          <header><div><span>Priority queue</span><strong>4 exceptions</strong></div><small>Ranked by operational impact</small></header>
          <div className={styles.exceptionList}>
            {EXCEPTIONS.map((item) => (
              <button key={item.id} type="button" data-active={item.id === selectedException.id} data-severity={item.severity} data-reviewed={reviewedExceptions.includes(item.id)} onClick={() => selectException(item)}>
                <span className={styles.exceptionCode}><i />{item.code}<small>{item.age}</small></span>
                <strong>{item.title}</strong>
                <p>{item.summary}</p>
                <footer><span>{item.impact}</span><span>{item.owner}</span></footer>
              </button>
            ))}
          </div>
          <section className={styles.watchList}>
            <header><span>Saved watches</span><button type="button" disabled title="Watch creation is not connected in this prototype"><Icon name="plus" size={12} /> Add</button></header>
            <button type="button" onClick={() => { setMapMode("risk"); setSelectedNodeId("yantian"); }}><span>China concentration</span><strong>72%</strong><i data-tone="watch" /></button>
            <button type="button" onClick={() => selectException(EXCEPTIONS.find((item) => item.code === "PORT-09") ?? EXCEPTIONS[0])}><span>West Coast gateways</span><strong>2 orders</strong><i data-tone="critical" /></button>
            <button type="button" onClick={() => selectException(EXCEPTIONS[0])}><span>Critical parts buffer</span><strong>4.2d</strong><i data-tone="watch" /></button>
            <button type="button" onClick={() => setView("suppliers")}><span>Supplier document quality</span><strong>94%</strong><i data-tone="stable" /></button>
          </section>
        </aside>

        <main className={styles.commandMap}>
          <MapWorkspace
            mapMode={mapMode}
            setMapMode={setMapMode}
            selectedMovementId={selectedMovement.id}
            setSelectedMovementId={setSelectedMovementId}
            selectedNodeId={selectedNodeId}
            setSelectedNodeId={setSelectedNodeId}
            layers={networkLayers}
            setLayers={setNetworkLayers}
          />
        </main>

        <aside className={styles.intelligenceRail}>
          <header className={styles.dossierHeader}>
            <div><span>Movement dossier</span><strong>{selectedMovement.po}</strong><small>{selectedMovement.container}</small></div>
            <div className={styles.riskScore} data-tone={selectedMovement.tone}><strong>{selectedMovement.riskScore}</strong><span>risk</span></div>
          </header>
          <div className={styles.dossierStatus} data-tone={selectedMovement.tone}>
            <div><i /><span>{selectedMovement.status}</span></div>
            <small>{selectedMovement.confidence}% assessment confidence</small>
          </div>
          <section className={styles.dossierIdentity}>
            <h2>{selectedMovement.supplier}</h2>
            <p>{selectedMovement.cargo}</p>
            <dl>
              <div><dt>Route</dt><dd>{selectedMovement.route}</dd></div>
              <div><dt>ETA</dt><dd>{selectedMovement.eta}</dd></div>
              <div><dt>Mode</dt><dd>{selectedMovement.mode}</dd></div>
              <div><dt>Plan cost</dt><dd>{selectedMovement.cost}</dd></div>
              <div><dt>Incoterm</dt><dd>{selectedMovement.incoterm}</dd></div>
              <div><dt>Owner</dt><dd>{selectedMovement.owner}</dd></div>
            </dl>
          </section>
          <section className={styles.assessmentBlock}>
            <header><span>Current assessment</span><small>{selectedException.sources} evidence sources</small></header>
            <h3>{selectedException.title}</h3>
            <p>{selectedException.summary}</p>
            <div><span>Operational impact</span><strong>{selectedException.impact}</strong></div>
          </section>
          <section className={styles.signalMatrix}>
            {selectedMovement.signals.map((signal) => <div key={signal.label} data-tone={signal.tone}><span>{signal.label}</span><strong>{signal.value}</strong></div>)}
          </section>
          <section className={styles.nextAction}>
            <span>Recommended next action</span>
            <p>{selectedMovement.nextDecision}</p>
            <div>
              <button type="button" onClick={() => setView(selectedMovement.id === "po-1048" || selectedMovement.id === "po-1064" ? "procurement" : "execution")}>Open decision <Icon name="arrow-right" size={13} /></button>
              <button type="button" onClick={() => setReviewedExceptions(reviewedExceptions.includes(selectedException.id) ? reviewedExceptions.filter((id) => id !== selectedException.id) : [...reviewedExceptions, selectedException.id])}>
                {reviewedExceptions.includes(selectedException.id) ? "Reviewed" : "Mark reviewed"}
              </button>
            </div>
          </section>
          <details className={styles.evidenceLedger}>
            <summary>Evidence ledger <span>{selectedMovement.evidence.length}</span></summary>
            {selectedMovement.evidence.map((item) => <div key={item.source}><i /><span><strong>{item.source}</strong><small>{item.age} ago</small></span><em>{item.confidence}</em></div>)}
          </details>
        </aside>
      </div>

      <section className={styles.eventConsole}>
        <header><div><span>Network event stream</span><strong>What changed since 07:00 PT</strong></div><button type="button" onClick={() => setView("execution")}>Open execution log <Icon name="arrow-right" size={12} /></button></header>
        <div>
          {NETWORK_EVENTS.map((event) => (
            <button key={`${event.time}-${event.code}`} type="button" onClick={() => {
              const exception = EXCEPTIONS.find((item) => item.code === event.code);
              if (exception) selectException(exception);
            }}>
              <time>{event.time}</time><i data-tone={event.tone} /><span><small>{event.code}</small><strong>{event.title}</strong><em>{event.detail}</em></span><b>{event.source}</b>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function NetworkView({ mapMode, setMapMode, selectedMovement, setSelectedMovementId, selectedNodeId, setSelectedNodeId, networkLayers, setNetworkLayers }: {
  mapMode: MapMode;
  setMapMode: (mode: MapMode) => void;
  selectedMovement: Movement;
  setSelectedMovementId: (id: string) => void;
  selectedNodeId: string;
  setSelectedNodeId: (id: string) => void;
  networkLayers: Record<NetworkLayerKey, boolean>;
  setNetworkLayers: (layers: Record<NetworkLayerKey, boolean>) => void;
}) {
  const selectedNode = nodeById(selectedNodeId);
  return (
    <div className={styles.viewPanel}>
      <header className={styles.viewHeader}><div><span>Network intelligence</span><h2>Global supply graph</h2><p>Trace dependencies from supplier facility through gateways, customs, and receiving sites.</p></div><div><span>25 nodes</span><span>6 active plans</span><span>4 exposed areas</span></div></header>
      <div className={styles.networkLayout}>
        <aside className={styles.networkIndex}>
          <header><span>Tracked movements</span><strong>6 in scope</strong></header>
          {MOVEMENTS.map((movement) => (
            <button type="button" key={movement.id} data-active={movement.id === selectedMovement.id} data-tone={movement.tone} onClick={() => { setSelectedMovementId(movement.id); setSelectedNodeId(movement.routeNodes[1] ?? movement.routeNodes[0]); }}>
              <span><i />{movement.po}<small>{movement.status}</small></span><strong>{movement.supplier}</strong><p>{movement.route}</p><footer><span>{movement.eta}</span><span>{movement.riskScore} risk</span></footer>
            </button>
          ))}
        </aside>
        <main className={styles.expandedMap}>
          <MapWorkspace mapMode={mapMode} setMapMode={setMapMode} selectedMovementId={selectedMovement.id} setSelectedMovementId={setSelectedMovementId} selectedNodeId={selectedNodeId} setSelectedNodeId={setSelectedNodeId} layers={networkLayers} setLayers={setNetworkLayers} expanded />
        </main>
        <aside className={styles.nodeDossier}>
          <header><span>{selectedNode.kind} dossier</span><strong>{selectedNode.label}</strong><small>{selectedNode.region}</small></header>
          <div className={styles.nodeState} data-tone={selectedNode.tone}><i /><span>{toneLabel(selectedNode.tone)}</span><strong>{selectedNode.metric}</strong></div>
          <dl>
            <div><dt>Network role</dt><dd>{selectedNode.detail}</dd></div>
            <div><dt>Coordinates</dt><dd>{selectedNode.lat.toFixed(2)}, {selectedNode.lng.toFixed(2)}</dd></div>
            <div><dt>Orders exposed</dt><dd>{selectedNode.id === "long-beach" ? "2 active / $188k" : selectedNode.kind === "supplier" ? "1 active" : "1 modeled"}</dd></div>
            <div><dt>Primary signal</dt><dd>{selectedNode.metric}</dd></div>
          </dl>
          <section><span>Observed indicators</span><div><strong>Schedule reliability</strong><em>{selectedNode.tone === "critical" ? "68%" : "89%"}</em></div><div><strong>Median dwell</strong><em>{selectedNode.kind === "port" ? "2.4 days" : "n/a"}</em></div><div><strong>Evidence freshness</strong><em>2 hours</em></div></section>
          <section><span>Connected entities</span>{MOVEMENTS.filter((movement) => movement.routeNodes.includes(selectedNode.id)).map((movement) => <button type="button" key={movement.id} onClick={() => setSelectedMovementId(movement.id)}><strong>{movement.po}</strong><small>{movement.supplier}</small><Icon name="chevron-right" size={12} /></button>)}</section>
          <footer><strong>Source note</strong><p>This dossier combines fictional shipment records and modeled node conditions. It is not a live port or vessel feed.</p></footer>
        </aside>
      </div>
    </div>
  );
}

function SuppliersView({ selectedSupplierId, setSelectedSupplierId, setSelectedMovementId, setView }: { selectedSupplierId: string; setSelectedSupplierId: (id: string) => void; setSelectedMovementId: (id: string) => void; setView: (view: ViewId) => void }) {
  const supplier = SUPPLIERS.find((item) => item.id === selectedSupplierId) ?? SUPPLIERS[0];
  return (
    <div className={styles.viewPanel}>
      <header className={styles.viewHeader}><div><span>Supplier intelligence</span><h2>Source network</h2><p>Dependency, performance, documentation, capacity, and gateway exposure in one record.</p></div><div><span>6 qualified</span><span>2 alternates</span><span>72% max concentration</span></div></header>
      <section className={styles.metricRail}>
        <div><span>Critical part families</span><strong>3</strong><small>1 lacks a second qualified source</small></div>
        <div><span>Weighted on-time rate</span><strong>92.1%</strong><small>+1.8 points this quarter</small></div>
        <div><span>Document acceptance</span><strong>96.3%</strong><small>14 reviewed packets</small></div>
        <div><span>Capacity coverage</span><strong>1.42x</strong><small>Approved demand plan</small></div>
      </section>
      <div className={styles.dataLayout}>
        <section className={styles.dataTablePanel}>
          <header><div><span>Supplier registry</span><strong>6 records</strong></div><button type="button" disabled title="Export is not connected in this prototype"><Icon name="download" size={13} /> Export view</button></header>
          <div className={styles.dataTableScroll}>
            <table>
              <thead><tr><th>Supplier</th><th>Tier</th><th>Category</th><th>Share</th><th>On time</th><th>Docs</th><th>Risk</th><th>Score</th></tr></thead>
              <tbody>{SUPPLIERS.map((item) => (
                <tr key={item.id} data-active={item.id === supplier.id} onClick={() => setSelectedSupplierId(item.id)}>
                  <td><button type="button"><strong>{item.name}</strong><small>{item.location}</small></button></td><td>{item.tier}</td><td>{item.product}</td><td><strong>{item.share}</strong></td><td>{item.ready}</td><td>{item.documents}</td><td><span className={styles.riskLabel} data-risk={item.risk.toLowerCase()}>{item.risk}</span></td><td><strong>{item.score}</strong></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
        <aside className={styles.recordDossier}>
          <header><div><span>{supplier.role} / {supplier.tier}</span><h2>{supplier.name}</h2><p>{supplier.location}</p></div><div className={styles.recordScore} data-risk={supplier.risk.toLowerCase()}><strong>{supplier.score}</strong><span>score</span></div></header>
          <section className={styles.recordAssessment}><span>Assessment</span><p>{supplier.note}</p></section>
          <div className={styles.riskQuadrants}>
            <div data-tone={Number.parseInt(supplier.share) > 60 ? "critical" : "stable"}><span>Dependency</span><strong>{supplier.share}</strong><small>category share</small></div>
            <div data-tone={supplier.risk === "Low" ? "stable" : "watch"}><span>Country and lane</span><strong>{supplier.risk}</strong><small>{supplier.gateway}</small></div>
            <div data-tone="stable"><span>Capacity</span><strong>{supplier.capacity}</strong><small>{supplier.leadTime} lead time</small></div>
            <div data-tone={supplier.documents.includes("100") || supplier.documents.includes("98") ? "stable" : "watch"}><span>Evidence</span><strong>{supplier.documents}</strong><small>Last audit {supplier.audit}</small></div>
          </div>
          <dl className={styles.recordFacts}>
            <div><dt>Product</dt><dd>{supplier.product}</dd></div><div><dt>Facility</dt><dd>{supplier.facility}</dd></div><div><dt>Gateway</dt><dd>{supplier.gateway}</dd></div><div><dt>Response median</dt><dd>{supplier.response}</dd></div><div><dt>Price signal</dt><dd>{supplier.price}</dd></div><div><dt>Last audit</dt><dd>{supplier.audit}</dd></div>
          </dl>
          <section className={styles.dependencyPlan}><header><span>Resilience action</span><strong>{supplier.id === "kepler" ? "Qualify NovaForge to 35%" : "Maintain monitored allocation"}</strong></header><p>{supplier.id === "kepler" ? "A 20% qualification order cuts single-factory exposure below 55% without changing the September launch plan." : "No immediate corrective action is modeled. Keep evidence and capacity checks current."}</p><button type="button" onClick={() => { setSelectedMovementId(supplier.id === "qingdao" ? "po-1064" : "po-1048"); setView("procurement"); }}>Open sourcing decision <Icon name="arrow-right" size={12} /></button></section>
        </aside>
      </div>
    </div>
  );
}

function ProcurementView({ selectedMovement, selectedQuoteId, setSelectedQuoteId, approvedQuoteId, setApprovedQuoteId }: { selectedMovement: Movement; selectedQuoteId: string; setSelectedQuoteId: (id: string) => void; approvedQuoteId: string | null; setApprovedQuoteId: (id: string) => void }) {
  const profile = procurementProfileForMovement(selectedMovement.id);
  const quotes = QUOTES.filter((item) => item.movementId === selectedMovement.id);
  const quote = quotes.find((item) => item.id === selectedQuoteId) ?? quotes[0] ?? null;

  if (!profile || !quote) {
    return (
      <div className={styles.viewPanel}>
        <header className={styles.viewHeader}><div><span>Procurement / {selectedMovement.po}</span><h2>No normalized quote set</h2><p>This movement has no modeled transport decision. Add an RFQ set before approving a plan.</p></div><div><span>0 normalized</span><span>No approval state</span><span>{selectedMovement.status}</span></div></header>
        <section className={styles.procurementEmpty}><Icon name="inbox" size={18} /><span>Quote workspace unavailable</span><strong>{selectedMovement.route}</strong><p>No rates, schedules, or forwarder responses are modeled for this movement. Nothing can be approved from this view.</p></section>
      </div>
    );
  }

  const approved = approvedQuoteId === quote.id;
  return (
    <div className={styles.viewPanel}>
      <header className={styles.viewHeader}><div><span>Procurement / {selectedMovement.po}</span><h2>Transport decision</h2><p>Normalized offers against lane history, reliability, free time, cost, and delivery buffer.</p></div><div><span>{quotes.length} normalized</span><span>{profile.expiry}</span><span>{profile.p50} lane</span></div></header>
      <section className={styles.marketBand}>
        <div className={styles.marketBandTitle}><span>Lane market position</span><strong>{profile.lane}</strong><small>{profile.observationWindow}</small></div>
        <div className={styles.bandChart}><span style={{ left: "8%" }}><i />{profile.p10}</span><span style={{ left: "42%" }}><i />{profile.p50}</span><span style={{ left: "72%" }}><i />{profile.p75}</span><b style={{ left: profile.selectedPosition }}><i />{profile.selectedMarker}</b></div>
        <div className={styles.marketBandStats}><div><span>Week change</span><strong>{profile.weekChange}</strong></div><div><span>Reliability band</span><strong>{profile.reliabilityBand}</strong></div><div><span>Schedule options</span><strong>{profile.scheduleOptions}</strong></div></div>
      </section>
      <div className={styles.procurementLayout}>
        <section className={styles.dataTablePanel}>
          <header><div><span>Quote comparison</span><strong>All-in normalized cost</strong></div><button type="button" disabled title="Export is not connected in this prototype"><Icon name="download" size={13} /> Export comparison</button></header>
          <div className={styles.dataTableScroll}><table><thead><tr><th>Partner</th><th>Fit</th><th>All-in</th><th>Lane delta</th><th>Transit</th><th>Reliability</th><th>Free time</th><th>Emissions</th><th>Valid</th></tr></thead><tbody>{quotes.map((item) => <tr key={item.id} data-active={item.id === quote.id} onClick={() => setSelectedQuoteId(item.id)}><td><button type="button"><strong>{item.partner}</strong><small>{item.source}</small></button></td><td><span className={styles.fitScore} data-fit={item.fit >= 85 ? "high" : "medium"}>{item.fit}</span></td><td><strong>${item.price.toLocaleString()}</strong></td><td>{item.delta}</td><td>{item.transit}</td><td>{item.reliability}</td><td>{item.freeDays}</td><td>{item.emissions}</td><td>{item.valid}</td></tr>)}</tbody></table></div>
        </section>
        <aside className={styles.quoteDecision}>
          <header><span>Selected offer</span><h2>{quote.partner}</h2><p>{quote.route}</p></header>
          <div className={styles.quoteFit}><div><strong>{quote.fit}</strong><span>decision fit</span></div><span>{quote.flag}</span></div>
          <dl><div><dt>All-in cost</dt><dd>${quote.price.toLocaleString()}</dd></div><div><dt>Lane position</dt><dd>{quote.delta}</dd></div><div><dt>Transit</dt><dd>{quote.transit}</dd></div><div><dt>Reliability</dt><dd>{quote.reliability}</dd></div><div><dt>Demurrage / detention</dt><dd>{quote.freeDays} days</dd></div><div><dt>Modeled emissions</dt><dd>{quote.emissions}</dd></div></dl>
          <section><span>Decision rationale</span><ul>{profile.rationale.map((item) => <li key={item}>{item}</li>)}</ul></section>
          <footer><p>Approval changes prototype state only. It does not contact or book the partner.</p><button type="button" disabled={approved} onClick={() => setApprovedQuoteId(quote.id)}>{approved ? "Plan approved locally" : "Approve modeled plan"}</button></footer>
        </aside>
      </div>
    </div>
  );
}

function ExecutionView({ selectedMovement, setSelectedMovementId, approvedQuoteId, setView }: { selectedMovement: Movement; setSelectedMovementId: (id: string) => void; approvedQuoteId: string | null; setView: (view: ViewId) => void }) {
  const approvedQuote = resolveMovementOwnedRecord(selectedMovement.id, approvedQuoteId, QUOTES);
  return (
    <div className={styles.viewPanel}>
      <header className={styles.viewHeader}><div><span>Execution record</span><h2>{selectedMovement.po} / {selectedMovement.supplier}</h2><p>Chronology, evidence, approvals, custody, and the next operational handoff.</p></div><div><span>{selectedMovement.status}</span><span>{selectedMovement.owner}</span><span>{selectedMovement.eta}</span></div></header>
      <nav className={styles.movementSelector} aria-label="Select movement">{MOVEMENTS.map((movement) => <button type="button" key={movement.id} data-active={movement.id === selectedMovement.id} data-tone={movement.tone} onClick={() => setSelectedMovementId(movement.id)}><i /><span>{movement.po}</span><strong>{movement.supplier}</strong><small>{movement.status}</small></button>)}</nav>
      <div className={styles.executionLayout}>
        <section className={styles.executionTimeline}>
          <header><div><span>Operational chronology</span><strong>Five controlled handoffs</strong></div><small>All times local to event</small></header>
          <div>{selectedMovement.timeline.map((event, index) => <article key={event.label} data-state={event.state}><div className={styles.timelineRail}><span>{index + 1}</span><i /></div><div className={styles.timelineBody}><header><div><span>{event.state}</span><strong>{event.label}</strong></div><time>{event.time}</time></header><p>{event.detail}</p><footer><Icon name="file" size={12} />{event.source}</footer></div></article>)}</div>
        </section>
        <aside className={styles.executionSide}>
          <section className={styles.actionGate} data-state={approvedQuote ? "ready" : "blocked"}><header><div><span>Execution gate</span><strong>{approvedQuote ? "Plan ready for booking review" : "Transport approval required"}</strong></div><i /></header><p>{approvedQuote ? `${approvedQuote.partner} is selected locally. The broker hold still prevents release.` : "No transport plan is approved. No forwarder or carrier has been contacted from this workspace."}</p>{!approvedQuote ? <button type="button" onClick={() => setView("procurement")}>Review procurement <Icon name="arrow-right" size={12} /></button> : null}</section>
          <section className={styles.custodyPanel}><header><span>Chain of custody</span><strong>{selectedMovement.container}</strong></header><div><span>Supplier</span><strong>{selectedMovement.supplier}</strong><small>Origin release</small></div><div><span>Forwarder</span><strong>{approvedQuote?.partner ?? "Not assigned"}</strong><small>Transport custody</small></div><div><span>Broker</span><strong>Pacific Entry Services</strong><small>Classification and entry</small></div><div><span>Consignee</span><strong>Atlas Robotics</strong><small>Austin launch site</small></div></section>
          <section className={styles.customsPacket}><header><span>Customs packet</span><strong>{selectedMovement.hsCode}</strong></header><ul><li data-state="ready"><Icon name="check" size={12} />Commercial invoice <span>Accepted</span></li><li data-state="ready"><Icon name="check" size={12} />Packing list <span>Accepted</span></li><li data-state="ready"><Icon name="check" size={12} />Country of origin <span>{originCountryForMovement(selectedMovement.id)}</span></li><li data-state={selectedMovement.id === "po-1048" ? "blocked" : "ready"}><Icon name={selectedMovement.id === "po-1048" ? "alert" : "check"} size={12} />Classification review <span>{selectedMovement.id === "po-1048" ? "Open" : "Confirmed"}</span></li></ul></section>
          <details className={styles.evidenceLedger} open><summary>Evidence and provenance <span>{selectedMovement.evidence.length}</span></summary>{selectedMovement.evidence.map((item) => <div key={item.source}><i /><span><strong>{item.source}</strong><small>{item.age} ago</small></span><em>{item.confidence}</em></div>)}</details>
        </aside>
      </div>
    </div>
  );
}

function ControlView({ mode, setMode, permissions, setPermissions }: { mode: AuthorityMode; setMode: (mode: AuthorityMode) => void; permissions: Record<PermissionKey, boolean>; setPermissions: (permissions: Record<PermissionKey, boolean>) => void }) {
  const modes: Array<{ id: AuthorityMode; label: string; detail: string; boundary: string }> = [
    { id: "observe", label: "Observe", detail: "Track work and identify exceptions.", boundary: "No drafts or outreach" },
    { id: "assist", label: "Assist", detail: "Prepare drafts and comparison work.", boundary: "A person sends everything" },
    { id: "coordinate", label: "Coordinate", detail: "Follow up inside approved partner lists.", boundary: "Stop before commitment" },
    { id: "execute", label: "Execute", detail: "Act inside approved spend and risk limits.", boundary: "High-risk gates remain human" },
  ];
  const integrations = [
    ["Supplier email", "Modeled", "Documents and cargo-ready updates"],
    ["Forwarder network", "Modeled", "RFQs, schedules, and quote normalization"],
    ["Customs broker", "Not connected", "Classification and filing review"],
    ["Carrier tracking", "Not connected", "Milestones, AIS, and container events"],
    ["ERP / procurement", "Not connected", "PO, SKU, demand, and landed cost"],
  ];
  return (
    <div className={styles.viewPanel}>
      <header className={styles.viewHeader}><div><span>Authority and controls</span><h2>Operating policy</h2><p>Define what Derya may observe, prepare, coordinate, and execute for this customer.</p></div><div><span>Policy DS-04</span><span>5 action classes</span><span>Human approval active</span></div></header>
      <section className={styles.authorityModes}>{modes.map((item) => <button type="button" key={item.id} data-active={mode === item.id} onClick={() => setMode(item.id)}><span>{item.id}</span><strong>{item.label}</strong><p>{item.detail}</p><small>{item.boundary}</small></button>)}</section>
      <div className={styles.controlLayout}>
        <section className={styles.policyMatrix}>
          <header><div><span>Action policy matrix</span><strong>Customer workspace defaults</strong></div><small>Changes update prototype state only</small></header>
          <div className={styles.policyTable}><div className={styles.policyHead}><span>Action class</span><span>Observe</span><span>Draft</span><span>Coordinate</span><span>Commit</span><span>Guard</span></div>{PERMISSIONS.map((item) => <div className={styles.policyRow} key={item.key}><span><strong>{item.label}</strong><small>{item.detail}</small></span><i data-on /><i data-on={mode !== "observe"} /><i data-on={permissions[item.key] && (mode === "coordinate" || mode === "execute")} /><label><input type="checkbox" checked={permissions[item.key] && mode === "execute"} onChange={() => setPermissions({ ...permissions, [item.key]: !permissions[item.key] })} disabled={mode !== "execute"} /><b /></label><em>{item.guard}</em></div>)}</div>
        </section>
        <aside className={styles.controlSide}>
          <section className={styles.integrationPanel}><header><span>Data connections</span><strong>Coverage state</strong></header>{integrations.map(([name, state, detail]) => <div key={name} data-state={state === "Not connected" ? "off" : "modeled"}><i /><span><strong>{name}</strong><small>{detail}</small></span><em>{state}</em></div>)}</section>
          <section className={styles.auditPanel}><header><span>Policy audit</span><strong>Recent local changes</strong></header><div><time>08:47</time><span><strong>Scenario recomputed</strong><small>Decision objective updated</small></span></div><div><time>08:44</time><span><strong>Exception reviewed</strong><small>CUS-14 / local state</small></span></div><div><time>08:42</time><span><strong>Workspace opened</strong><small>Modeled dataset loaded</small></span></div></section>
        </aside>
      </div>
    </div>
  );
}
