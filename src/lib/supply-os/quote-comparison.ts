export type ComparableSupplierQuote = {
  responseHash: string;
  price: string;
  currency: string;
  unitOfMeasure: string;
  deliveryDate: string;
};

export function displayedSupplierQuote<T extends ComparableSupplierQuote>(
  responses: T[],
  selectedResponseHash: string | null,
) {
  if (selectedResponseHash) {
    return responses.find((response) => response.responseHash === selectedResponseHash) ?? null;
  }
  return responses.at(-1) ?? null;
}

export function supplierQuoteSignals<T extends ComparableSupplierQuote>(rows: Array<{
  id: string;
  requestHash: string | null;
  response: T | null;
}>) {
  const quoted = rows.filter((row): row is typeof row & { response: T } => row.response !== null);
  const currencies = new Set(quoted.map((row) => row.response.currency));
  const units = new Set(quoted.map((row) => row.response.unitOfMeasure));
  const requestHashes = new Set(quoted.map((row) => row.requestHash));
  const comparableScope = units.size === 1 && requestHashes.size === 1 && !requestHashes.has(null);
  const bestPrice = comparableScope && currencies.size === 1
    ? quoted.reduce<(typeof quoted)[number] | null>((best, row) => (
        !best || Number(row.response.price) < Number(best.response.price) ? row : best
      ), null)
    : null;
  const earliest = comparableScope
    ? quoted.reduce<(typeof quoted)[number] | null>((best, row) => (
        !best || row.response.deliveryDate < best.response.deliveryDate ? row : best
      ), null)
    : null;
  return {
    bestPriceId: bestPrice?.id ?? null,
    earliestId: earliest?.id ?? null,
  };
}
