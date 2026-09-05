import { createContext, useContext } from "react";

export const SupplyOsHeaderSlotContext = createContext<HTMLDivElement | null>(null);

export function useSupplyOsHeaderSlot() {
  return useContext(SupplyOsHeaderSlotContext);
}
