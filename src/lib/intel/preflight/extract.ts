// Free-text load idea -> structured LoadIdea via GPT-5.6. The extraction is the
// ONLY AI step in the pre-flight; every finding comes from deterministic rules
// in src/lib/load-check.ts, and the operator can correct any extracted field
// and re-run without the model.

import Gpt56Client from "../../gpt56-client";
import { coerceLoadIdea, EMPTY_LOAD_IDEA, type LoadIdea } from "./engine";
import { COMMODITY_CATEGORY_VALUES, INTEL_EQUIPMENT_TYPES } from "../vocabulary";

const EQUIPMENT_VALUES = INTEL_EQUIPMENT_TYPES.map(([value]) => value);

const SYSTEM_PROMPT = `You extract structured freight-load fields from a broker's free-text load idea.

Output ONLY this JSON (no prose):
{
  "description": string|null,          // one-line restatement of the load
  "commodityCategory": ${COMMODITY_CATEGORY_VALUES.map((v) => `"${v}"`).join("|")}|null,
  "origin": string|null,               // US city/state as written, e.g. "Fremont, CA"
  "destination": string|null,
  "declaredValue": number|null,        // USD, digits only
  "weightLbs": number|null,
  "equipmentType": ${EQUIPMENT_VALUES.map((v) => `"${v}"`).join("|")}|null,
  "temperatureSensitive": boolean,
  "inboundInternational": boolean,     // true only if the text says the freight arrives from another country first
  "originCountry": string|null,        // country of the international leg, e.g. "China"
  "exportBound": boolean,              // true only if it continues to another country after the US leg
  "defenseOrSpace": boolean,           // defense, military, aerospace/space hardware
  "batteriesDamagedOrRecalled": boolean,
  "pickupDate": "YYYY-MM-DD"|null,
  "transitDays": number|null           // promised door-to-door days if stated
}

Rules: never invent values - null/false when the text doesn't say. "Batteries" alone = batteries_un3480; batteries inside devices/equipment = batteries_un3481. GPUs/servers/racks = servers_gpu. Weights like "20k lbs" = 20000.`;

export async function extractLoadIdea(text: string): Promise<{ idea: LoadIdea; note: string | null }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { idea: { ...EMPTY_LOAD_IDEA, description: text.slice(0, 200) }, note: "AI parse unavailable (no API key) - fill the fields manually." };
  }
  try {
    const client = new Gpt56Client({ apiKey });
    const result = await client.messages.create({
      model: "gpt-5.6",
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: text.slice(0, 4000) }],
    });
    const raw = result.content[0]?.type === "text" ? result.content[0].text : "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("no JSON in response");
    const idea = coerceLoadIdea(JSON.parse(match[0]), COMMODITY_CATEGORY_VALUES, EQUIPMENT_VALUES);
    return { idea, note: null };
  } catch {
    return {
      idea: { ...EMPTY_LOAD_IDEA, description: text.slice(0, 200) },
      note: "Couldn't auto-parse the idea - fill the fields manually and re-check.",
    };
  }
}
