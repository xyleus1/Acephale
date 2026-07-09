// Human-readable rendering of WhatsApp protocol addresses. The pipeline
// stores counterparties as "whatsapp:<digits>" in EmailMessage.fromEmail /
// EmailAccount.email; these helpers keep those machine strings out of the UI.
// Pure module — safe to import from client components and test scripts.

export function isWhatsAppAddress(address: string | null | undefined): boolean {
  return Boolean(address?.startsWith("whatsapp:"));
}

// "whatsapp:905321112233" → "905321112233"; null when not a WhatsApp address.
export function whatsAppAddressDigits(address: string | null | undefined): string | null {
  if (!address || !isWhatsAppAddress(address)) return null;
  const digits = address.slice("whatsapp:".length).replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

// "905321112233" → "+90 532 111 22 33" (Turkish grouping); other countries
// get a readable generic grouping: "+962 798 185 729".
export function formatPhoneDigits(digits: string | null | undefined): string | null {
  if (!digits) return null;
  const d = digits.replace(/\D/g, "");
  if (d.length < 8) return null;
  if (d.startsWith("90") && d.length === 12) {
    return `+90 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10, 12)}`;
  }
  const rest = d.length > 3 ? d.slice(-Math.min(9, d.length - 2)) : d;
  const country = d.slice(0, d.length - rest.length);
  const groups = rest.match(/.{1,3}/g) ?? [rest];
  return `+${country}${country ? " " : ""}${groups.join(" ")}`;
}

// The one display rule for a WhatsApp counterparty: contact name when known,
// formatted phone otherwise, raw value only as a last resort.
export function whatsAppPartyLabel(
  address: string | null | undefined,
  name?: string | null,
): string {
  const trimmedName = name?.trim();
  if (trimmedName) return trimmedName;
  const formatted = formatPhoneDigits(whatsAppAddressDigits(address));
  if (formatted) return formatted;
  return address ?? "";
}

// Drop-in replacement for the ubiquitous `fromName ?? fromEmail` pattern:
// leaves email addresses untouched, humanizes whatsapp: addresses.
export function displayParty(fromEmail: string | null | undefined, fromName?: string | null): string {
  if (isWhatsAppAddress(fromEmail)) return whatsAppPartyLabel(fromEmail, fromName);
  return fromName?.trim() || (fromEmail ?? "");
}

// Label for the receiving WhatsApp account ("whatsapp:<phoneNumberId>").
// Meta phone_number_ids and some Green API instance ids are opaque tokens,
// not dialable numbers — never render those as a fake phone. MSISDNs are at
// most 15 digits but opaque ids typically run longer or fail formatting;
// anything beyond 13 digits is treated as opaque here.
export function whatsAppAccountLabel(accountEmail: string | null | undefined): string {
  if (!isWhatsAppAddress(accountEmail)) return accountEmail ?? "";
  const digits = whatsAppAddressDigits(accountEmail);
  if (!digits || digits.length > 13) return "WhatsApp Business";
  const formatted = formatPhoneDigits(digits);
  return formatted ? `WhatsApp · ${formatted}` : "WhatsApp Business";
}
