export const OUTREACH_INTRO_MAX_CHARS = 280;

export const OUTREACH_INTRO_COMMON_WORDS = new Set([
  "a", "about", "across", "after", "all", "an", "and", "area", "are", "around",
  "as", "at", "based", "be", "been", "being", "bring", "bringing", "but", "by",
  "cafe", "cafes", "can", "coffee", "come", "customers", "desserts", "do",
  "for", "from", "frozen", "help", "hello", "here", "hi", "how", "in",
  "independent", "is", "it", "local", "near", "of", "offer", "on", "or",
  "our", "range", "serve", "serving", "some", "spot", "team", "that", "the",
  "their", "there", "this", "to", "under", "up", "warm", "we", "well", "with",
  "work", "working", "would", "you", "your", "lovely", "welcoming", "scene",
  "represented",
]);

export const OUTREACH_INTRO_SYSTEM_PROMPT = `You write the opening one or two sentences of a B2B sales email to a small business, so the email feels written specifically for that business.

You receive EVIDENCE: a JSON object with what is verifiably known about the business (name, town, county, segment, website, public signals found on their site, Google rating and review count). You also receive PITCH: one sentence on what the sender offers, for tone only.

Return strict JSON only: {"intro": string, "used": [list of evidence keys you relied on]}.

Rules:
- Use only facts present in EVIDENCE. Never guess the menu, history, owner, awards, opening hours, or anything not given. If the evidence is thin, write one plain sentence about their town or type of business and nothing more.
- Do not restate their business name if the greeting already uses it; refer to "your cafe", "your counter", "your team" or the town instead.
- Mention at most one concrete detail (for example a strong review count, a dessert or brunch signal from their site, or the town). Do not list several signals.
- Do not mention Google, ratings sites, "I noticed", "I saw", "I came across", "I was browsing", "I hope this finds you well", or that you researched them.
- Do not mention the sender's product, prices, or offers; the email body does that.
- Plain British English, warm but businesslike, no exclamation marks, no emojis, no questions.
- Maximum two sentences and 280 characters in total. Never use the em dash character.
- If you cannot write something specific and true, return {"intro": "", "used": []}.`;
