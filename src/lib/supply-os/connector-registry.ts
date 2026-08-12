import "server-only";

import type { SupplyConnectorAdapter } from "./connector-contract";
import { customRestV1Adapter } from "./connector-custom-rest";

const ADAPTERS = new Map<string, SupplyConnectorAdapter>([
  [customRestV1Adapter.key, customRestV1Adapter],
]);

export function getSupplyConnectorAdapter(key: string) {
  return ADAPTERS.get(key) ?? null;
}

export function listSupplyConnectorAdapters() {
  return [...ADAPTERS.values()].map(({ key, version }) => ({ key, version }));
}
