// Compatibility wrapper. The product used to call this an "opportunity score";
// the actual implementation is now the commercial decision assessment.
export {
  assessCommercialStrategy as calculateOpportunity,
  requiredRfqMissing,
  strategyTone as opportunityTone,
  type CommercialStrategy as OpportunityScore,
  type StrategyCarrierQuote as OpportunityCarrierQuote,
  type CommercialStrategyInput as OpportunityInput,
} from "./commercial-strategy";
