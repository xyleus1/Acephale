// Sourcing request ids are stored as uuid columns, so a malformed id would
// otherwise surface as a database error instead of a request error.
const ORDER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function procurementOrderIdError(orderId: string) {
  if (!orderId) return "orderId is required.";
  if (!ORDER_ID_PATTERN.test(orderId)) return "orderId must be a sourcing request id.";
  return null;
}
