export type IntelLocation = {
  input: string | null;
  label: string;
  isUnitedStates: boolean;
  isGenericCountryOnly: boolean;
  confidence: "explicit_country" | "state_or_zip" | "known_city" | "non_us" | "unknown";
  stateCode: string | null;
  lat: number | null;
  lon: number | null;
  reason: string;
};

const US_STATE_POINTS: Record<string, { code: string; label: string; lat: number; lon: number }> = {
  AL: { code: "AL", label: "Alabama", lat: 32.8067, lon: -86.7911 },
  AK: { code: "AK", label: "Alaska", lat: 61.3707, lon: -152.4044 },
  AZ: { code: "AZ", label: "Arizona", lat: 33.7298, lon: -111.4312 },
  AR: { code: "AR", label: "Arkansas", lat: 34.9697, lon: -92.3731 },
  CA: { code: "CA", label: "California", lat: 36.1162, lon: -119.6816 },
  CO: { code: "CO", label: "Colorado", lat: 39.0598, lon: -105.3111 },
  CT: { code: "CT", label: "Connecticut", lat: 41.5978, lon: -72.7554 },
  DE: { code: "DE", label: "Delaware", lat: 39.3185, lon: -75.5071 },
  FL: { code: "FL", label: "Florida", lat: 27.7663, lon: -81.6868 },
  GA: { code: "GA", label: "Georgia", lat: 33.0406, lon: -83.6431 },
  HI: { code: "HI", label: "Hawaii", lat: 21.0943, lon: -157.4983 },
  ID: { code: "ID", label: "Idaho", lat: 44.2405, lon: -114.4788 },
  IL: { code: "IL", label: "Illinois", lat: 40.3495, lon: -88.9861 },
  IN: { code: "IN", label: "Indiana", lat: 39.8494, lon: -86.2583 },
  IA: { code: "IA", label: "Iowa", lat: 42.0115, lon: -93.2105 },
  KS: { code: "KS", label: "Kansas", lat: 38.5266, lon: -96.7265 },
  KY: { code: "KY", label: "Kentucky", lat: 37.6681, lon: -84.6701 },
  LA: { code: "LA", label: "Louisiana", lat: 31.1695, lon: -91.8678 },
  ME: { code: "ME", label: "Maine", lat: 44.6939, lon: -69.3819 },
  MD: { code: "MD", label: "Maryland", lat: 39.0639, lon: -76.8021 },
  MA: { code: "MA", label: "Massachusetts", lat: 42.2302, lon: -71.5301 },
  MI: { code: "MI", label: "Michigan", lat: 43.3266, lon: -84.5361 },
  MN: { code: "MN", label: "Minnesota", lat: 45.6945, lon: -93.9002 },
  MS: { code: "MS", label: "Mississippi", lat: 32.7416, lon: -89.6787 },
  MO: { code: "MO", label: "Missouri", lat: 38.4561, lon: -92.2884 },
  MT: { code: "MT", label: "Montana", lat: 46.9219, lon: -110.4544 },
  NE: { code: "NE", label: "Nebraska", lat: 41.1254, lon: -98.2681 },
  NV: { code: "NV", label: "Nevada", lat: 38.3135, lon: -117.0554 },
  NH: { code: "NH", label: "New Hampshire", lat: 43.4525, lon: -71.5639 },
  NJ: { code: "NJ", label: "New Jersey", lat: 40.2989, lon: -74.521 },
  NM: { code: "NM", label: "New Mexico", lat: 34.8405, lon: -106.2485 },
  NY: { code: "NY", label: "New York", lat: 42.1657, lon: -74.9481 },
  NC: { code: "NC", label: "North Carolina", lat: 35.6301, lon: -79.8064 },
  ND: { code: "ND", label: "North Dakota", lat: 47.5289, lon: -99.784 },
  OH: { code: "OH", label: "Ohio", lat: 40.3888, lon: -82.7649 },
  OK: { code: "OK", label: "Oklahoma", lat: 35.5653, lon: -96.9289 },
  OR: { code: "OR", label: "Oregon", lat: 44.572, lon: -122.0709 },
  PA: { code: "PA", label: "Pennsylvania", lat: 40.5908, lon: -77.2098 },
  RI: { code: "RI", label: "Rhode Island", lat: 41.6809, lon: -71.5118 },
  SC: { code: "SC", label: "South Carolina", lat: 33.8569, lon: -80.945 },
  SD: { code: "SD", label: "South Dakota", lat: 44.2998, lon: -99.4388 },
  TN: { code: "TN", label: "Tennessee", lat: 35.7478, lon: -86.6923 },
  TX: { code: "TX", label: "Texas", lat: 31.0545, lon: -97.5635 },
  UT: { code: "UT", label: "Utah", lat: 40.15, lon: -111.8624 },
  VT: { code: "VT", label: "Vermont", lat: 44.0459, lon: -72.7107 },
  VA: { code: "VA", label: "Virginia", lat: 37.7693, lon: -78.17 },
  WA: { code: "WA", label: "Washington", lat: 47.4009, lon: -121.4905 },
  WV: { code: "WV", label: "West Virginia", lat: 38.4912, lon: -80.9545 },
  WI: { code: "WI", label: "Wisconsin", lat: 44.2685, lon: -89.6165 },
  WY: { code: "WY", label: "Wyoming", lat: 42.756, lon: -107.3025 },
};

const US_STATE_NAMES = Object.fromEntries(
  Object.values(US_STATE_POINTS).map((state) => [state.label.toUpperCase(), state.code])
);

const US_CITY_POINTS: Record<string, { label: string; stateCode: string; lat: number; lon: number }> = {
  ATLANTA: { label: "Atlanta, GA", stateCode: "GA", lat: 33.749, lon: -84.388 },
  BALTIMORE: { label: "Baltimore, MD", stateCode: "MD", lat: 39.2904, lon: -76.6122 },
  BOSTON: { label: "Boston, MA", stateCode: "MA", lat: 42.3601, lon: -71.0589 },
  CHARLESTON: { label: "Charleston, SC", stateCode: "SC", lat: 32.7765, lon: -79.9311 },
  CHARLOTTE: { label: "Charlotte, NC", stateCode: "NC", lat: 35.2271, lon: -80.8431 },
  CHICAGO: { label: "Chicago, IL", stateCode: "IL", lat: 41.8781, lon: -87.6298 },
  COLUMBUS: { label: "Columbus, OH", stateCode: "OH", lat: 39.9612, lon: -82.9988 },
  DALLAS: { label: "Dallas, TX", stateCode: "TX", lat: 32.7767, lon: -96.797 },
  DENVER: { label: "Denver, CO", stateCode: "CO", lat: 39.7392, lon: -104.9903 },
  DETROIT: { label: "Detroit, MI", stateCode: "MI", lat: 42.3314, lon: -83.0458 },
  HOUSTON: { label: "Houston, TX", stateCode: "TX", lat: 29.7604, lon: -95.3698 },
  INDIANAPOLIS: { label: "Indianapolis, IN", stateCode: "IN", lat: 39.7684, lon: -86.1581 },
  JACKSONVILLE: { label: "Jacksonville, FL", stateCode: "FL", lat: 30.3322, lon: -81.6557 },
  "KANSAS CITY": { label: "Kansas City, MO", stateCode: "MO", lat: 39.0997, lon: -94.5786 },
  LAREDO: { label: "Laredo, TX", stateCode: "TX", lat: 27.5036, lon: -99.5076 },
  "LAS VEGAS": { label: "Las Vegas, NV", stateCode: "NV", lat: 36.1699, lon: -115.1398 },
  "LONG BEACH": { label: "Long Beach, CA", stateCode: "CA", lat: 33.7701, lon: -118.1937 },
  "LOS ANGELES": { label: "Los Angeles, CA", stateCode: "CA", lat: 34.0522, lon: -118.2437 },
  MEMPHIS: { label: "Memphis, TN", stateCode: "TN", lat: 35.1495, lon: -90.049 },
  MIAMI: { label: "Miami, FL", stateCode: "FL", lat: 25.7617, lon: -80.1918 },
  NASHVILLE: { label: "Nashville, TN", stateCode: "TN", lat: 36.1627, lon: -86.7816 },
  "NEW YORK": { label: "New York, NY", stateCode: "NY", lat: 40.7128, lon: -74.006 },
  NEWARK: { label: "Newark, NJ", stateCode: "NJ", lat: 40.7357, lon: -74.1724 },
  NORFOLK: { label: "Norfolk, VA", stateCode: "VA", lat: 36.8508, lon: -76.2859 },
  OAKLAND: { label: "Oakland, CA", stateCode: "CA", lat: 37.8044, lon: -122.2712 },
  PHOENIX: { label: "Phoenix, AZ", stateCode: "AZ", lat: 33.4484, lon: -112.074 },
  PORTLAND: { label: "Portland, OR", stateCode: "OR", lat: 45.5152, lon: -122.6784 },
  "SALT LAKE CITY": { label: "Salt Lake City, UT", stateCode: "UT", lat: 40.7608, lon: -111.891 },
  "SAN DIEGO": { label: "San Diego, CA", stateCode: "CA", lat: 32.7157, lon: -117.1611 },
  SAVANNAH: { label: "Savannah, GA", stateCode: "GA", lat: 32.0809, lon: -81.0912 },
  SEATTLE: { label: "Seattle, WA", stateCode: "WA", lat: 47.6062, lon: -122.3321 },
  TACOMA: { label: "Tacoma, WA", stateCode: "WA", lat: 47.2529, lon: -122.4443 },
};

const NON_US_MARKERS = [
  "TURKEY", "TURKIYE", "TÜRKIYE", "ISTANBUL", "KONYA", "MERSIN", "ALIAGA", "GIRESUN",
  "GERMANY", "HAMBURG", "BERLIN", "CHINA", "SHENZHEN", "SHENZEN", "SHANGHAI", "JIANGSU",
  "ITALY", "ANCONA", "PORTUGAL", "LISBON", "MEXICO", "GUADALAJARA", "BULGARIA", "VARNA",
  "DENMARK", "SKAGEN", "JORDAN", "AKABA", "SAUDI", "JEDDAH", "DJIBOUTI", "BRAZIL", "GEORGIA",
  "VENEZUELA", "PUERTO CABELLO", "CANADA", "TORONTO", "MONTREAL", "VANCOUVER",
];

function cleanLocation(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function normalizeLocation(value: string | null | undefined): string {
  return cleanLocation(value)?.toUpperCase().replace(/[.]/g, "").replace(/\s+/g, " ") ?? "";
}

function locationFromState(
  stateCode: string,
  input: string,
  confidence: IntelLocation["confidence"]
): IntelLocation {
  const state = US_STATE_POINTS[stateCode];
  return {
    input,
    label: input || state.label,
    isUnitedStates: true,
    isGenericCountryOnly: false,
    confidence,
    stateCode: state.code,
    lat: state.lat,
    lon: state.lon,
    reason: `Matched ${state.label}.`,
  };
}

export function classifyIntelLocation(value: string | null | undefined): IntelLocation {
  const input = cleanLocation(value);
  const normalized = normalizeLocation(value);
  if (!input || !normalized) {
    return {
      input: null,
      label: "Missing",
      isUnitedStates: false,
      isGenericCountryOnly: false,
      confidence: "unknown",
      stateCode: null,
      lat: null,
      lon: null,
      reason: "Missing city/state/ZIP.",
    };
  }

  if (/^(USA|US|UNITED STATES|UNITED STATES OF AMERICA)$/.test(normalized)) {
    return {
      input,
      label: input,
      isUnitedStates: true,
      isGenericCountryOnly: true,
      confidence: "explicit_country",
      stateCode: null,
      lat: 39.8283,
      lon: -98.5795,
      reason: "Country-only USA is not enough for rating; need city/state/ZIP.",
    };
  }

  if (
    NON_US_MARKERS.some((marker) =>
      new RegExp(`\\b${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(normalized)
    )
  ) {
    return {
      input,
      label: input,
      isUnitedStates: false,
      isGenericCountryOnly: false,
      confidence: "non_us",
      stateCode: null,
      lat: null,
      lon: null,
      reason: "Location matches a non-US geography.",
    };
  }

  const cityHit = Object.entries(US_CITY_POINTS).find(([city]) => new RegExp(`\\b${city}\\b`).test(normalized));
  if (cityHit) {
    const [, city] = cityHit;
    return {
      input,
      label: input,
      isUnitedStates: true,
      isGenericCountryOnly: false,
      confidence: "known_city",
      stateCode: city.stateCode,
      lat: city.lat,
      lon: city.lon,
      reason: `Matched ${city.label}.`,
    };
  }

  const stateCodeHit = Object.keys(US_STATE_POINTS).find((code) =>
    new RegExp(`(^|[,\\s])${code}($|[,\\s])`).test(normalized)
  );
  if (stateCodeHit) return locationFromState(stateCodeHit, input, "state_or_zip");

  const stateNameHit = Object.keys(US_STATE_NAMES).find((stateName) =>
    new RegExp(`\\b${stateName}\\b`).test(normalized)
  );
  if (stateNameHit) return locationFromState(US_STATE_NAMES[stateNameHit], input, "state_or_zip");

  if (/\b\d{5}(?:-\d{4})?\b/.test(normalized)) {
    return {
      input,
      label: input,
      isUnitedStates: true,
      isGenericCountryOnly: false,
      confidence: "state_or_zip",
      stateCode: null,
      lat: 39.8283,
      lon: -98.5795,
      reason: "Matched US ZIP format; map point is approximate until city/state is known.",
    };
  }

  return {
    input,
    label: input,
    isUnitedStates: false,
    isGenericCountryOnly: false,
    confidence: "unknown",
    stateCode: null,
    lat: null,
    lon: null,
    reason: "Need an explicit US city/state/ZIP.",
  };
}
