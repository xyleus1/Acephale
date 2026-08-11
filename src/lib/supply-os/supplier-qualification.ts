function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isoDay(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const day = value.slice(0, 10);
  const parsed = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day
    ? null
    : day;
}

export function supplierQualificationValidOn(value: unknown, date: string) {
  const review = record(value);
  const reviewedOn = isoDay(review.reviewedAt);
  const validUntil = isoDay(review.validUntil);

  return review.outcome === "QUALIFIED"
    && typeof review.reviewHash === "string"
    && review.reviewHash.length > 0
    && reviewedOn !== null
    && reviewedOn <= date
    && validUntil !== null
    && validUntil >= date;
}

export function currentSupplierQualification(value: unknown, now = new Date()) {
  return supplierQualificationValidOn(value, now.toISOString().slice(0, 10));
}
