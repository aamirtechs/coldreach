import type { LeadFields } from "./personalize";

/**
 * Per-lead timezone resolution (v1.5.0).
 *
 * Campaigns carry one timezone and sending window, but a campaign's
 * leads can span many countries. This module resolves a lead's own
 * timezone from the fields captured at import, so the scheduler can
 * observe the campaign window in the lead's local time: a lead in
 * Texas is emailed on a Texas morning, a lead in London on a London
 * morning, inside the same campaign and sequence.
 *
 * Resolution order:
 *   1. An explicit `timezone` field on the lead (validated as an
 *      IANA name), for imports that know the exact zone.
 *   2. A United States `state` field (code or full name), mapped to
 *      the state's primary zone, when the country is the US.
 *   3. The lead's `country` field, by name or ISO code, mapped to a
 *      business reference zone for that country.
 *   4. Null, meaning "no local zone known"; callers fall back to the
 *      campaign timezone, which is exactly the pre-v1.5.0 behaviour.
 *
 * Multi-zone countries resolve to one reference zone, chosen so a
 * 09:00 window opening lands inside business hours across as much
 * of the country as possible: the United States uses America/Chicago
 * (09:00 Central is 10:00 Eastern and 07:00 Pacific), Canada uses
 * America/Toronto, and Australia uses Australia/Sydney.
 */

const COUNTRY_TIMEZONES: Record<string, string> = {
  // North and South America
  US: "America/Chicago",
  CA: "America/Toronto",
  MX: "America/Mexico_City",
  GT: "America/Guatemala",
  BZ: "America/Belize",
  HN: "America/Tegucigalpa",
  SV: "America/El_Salvador",
  NI: "America/Managua",
  CR: "America/Costa_Rica",
  PA: "America/Panama",
  CU: "America/Havana",
  DO: "America/Santo_Domingo",
  PR: "America/Puerto_Rico",
  JM: "America/Jamaica",
  TT: "America/Port_of_Spain",
  BS: "America/Nassau",
  HT: "America/Port-au-Prince",
  BQ: "America/Kralendijk",
  BR: "America/Sao_Paulo",
  AR: "America/Argentina/Buenos_Aires",
  CL: "America/Santiago",
  CO: "America/Bogota",
  PE: "America/Lima",
  VE: "America/Caracas",
  EC: "America/Guayaquil",
  BO: "America/La_Paz",
  PY: "America/Asuncion",
  UY: "America/Montevideo",
  GY: "America/Guyana",
  SR: "America/Paramaribo",
  // Europe
  GB: "Europe/London",
  IE: "Europe/Dublin",
  FR: "Europe/Paris",
  DE: "Europe/Berlin",
  NL: "Europe/Amsterdam",
  BE: "Europe/Brussels",
  LU: "Europe/Luxembourg",
  CH: "Europe/Zurich",
  AT: "Europe/Vienna",
  IT: "Europe/Rome",
  ES: "Europe/Madrid",
  PT: "Europe/Lisbon",
  GR: "Europe/Athens",
  DK: "Europe/Copenhagen",
  SE: "Europe/Stockholm",
  NO: "Europe/Oslo",
  FI: "Europe/Helsinki",
  IS: "Atlantic/Reykjavik",
  PL: "Europe/Warsaw",
  CZ: "Europe/Prague",
  SK: "Europe/Bratislava",
  SI: "Europe/Ljubljana",
  HR: "Europe/Zagreb",
  HU: "Europe/Budapest",
  RO: "Europe/Bucharest",
  BG: "Europe/Sofia",
  RS: "Europe/Belgrade",
  BA: "Europe/Sarajevo",
  ME: "Europe/Podgorica",
  MK: "Europe/Skopje",
  AL: "Europe/Tirane",
  EE: "Europe/Tallinn",
  LV: "Europe/Riga",
  LT: "Europe/Vilnius",
  UA: "Europe/Kyiv",
  BY: "Europe/Minsk",
  RU: "Europe/Moscow",
  TR: "Europe/Istanbul",
  CY: "Europe/Nicosia",
  MT: "Europe/Malta",
  GE: "Europe/Tbilisi",
  AM: "Europe/Yerevan",
  AZ: "Asia/Baku",
  MD: "Europe/Chisinau",
  // Middle East and Asia
  AE: "Asia/Dubai",
  SA: "Asia/Riyadh",
  QA: "Asia/Qatar",
  KW: "Asia/Kuwait",
  BH: "Asia/Bahrain",
  OM: "Asia/Muscat",
  IL: "Asia/Jerusalem",
  JO: "Asia/Amman",
  LB: "Asia/Beirut",
  IQ: "Asia/Baghdad",
  IR: "Asia/Tehran",
  SY: "Asia/Damascus",
  AF: "Asia/Kabul",
  PK: "Asia/Karachi",
  IN: "Asia/Kolkata",
  BD: "Asia/Dhaka",
  LK: "Asia/Colombo",
  NP: "Asia/Kathmandu",
  MM: "Asia/Yangon",
  TH: "Asia/Bangkok",
  VN: "Asia/Ho_Chi_Minh",
  KH: "Asia/Phnom_Penh",
  LA: "Asia/Vientiane",
  MY: "Asia/Kuala_Lumpur",
  SG: "Asia/Singapore",
  BN: "Asia/Brunei",
  ID: "Asia/Jakarta",
  PH: "Asia/Manila",
  CN: "Asia/Shanghai",
  HK: "Asia/Hong_Kong",
  TW: "Asia/Taipei",
  MO: "Asia/Macau",
  JP: "Asia/Tokyo",
  KR: "Asia/Seoul",
  KP: "Asia/Pyongyang",
  MN: "Asia/Ulaanbaatar",
  KZ: "Asia/Almaty",
  UZ: "Asia/Tashkent",
  TJ: "Asia/Dushanbe",
  KG: "Asia/Bishkek",
  TM: "Asia/Ashgabat",
  // Oceania
  AU: "Australia/Sydney",
  NZ: "Pacific/Auckland",
  FJ: "Pacific/Fiji",
  PG: "Pacific/Port_Moresby",
  // Africa
  ZA: "Africa/Johannesburg",
  NG: "Africa/Lagos",
  KE: "Africa/Nairobi",
  GH: "Africa/Accra",
  EG: "Africa/Cairo",
  MA: "Africa/Casablanca",
  TZ: "Africa/Dar_es_Salaam",
  UG: "Africa/Kampala",
  ET: "Africa/Addis_Ababa",
  BW: "Africa/Gaborone",
  NA: "Africa/Windhoek",
  ZW: "Africa/Harare",
  MZ: "Africa/Maputo",
  MU: "Indian/Mauritius",
  TN: "Africa/Tunis",
  DZ: "Africa/Algiers",
  AO: "Africa/Luanda",
  CM: "Africa/Douala",
  CI: "Africa/Abidjan",
  SN: "Africa/Dakar",
  ZM: "Africa/Lusaka",
  RW: "Africa/Kigali",
  SD: "Africa/Khartoum",
};

/** Country names (uppercased, punctuation stripped) to ISO codes. */
const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  "UNITED STATES": "US",
  "UNITED STATES OF AMERICA": "US",
  USA: "US",
  AMERICA: "US",
  UK: "GB",
  "UNITED KINGDOM": "GB",
  "GREAT BRITAIN": "GB",
  BRITAIN: "GB",
  ENGLAND: "GB",
  SCOTLAND: "GB",
  WALES: "GB",
  "NORTHERN IRELAND": "GB",
  "UNITED ARAB EMIRATES": "AE",
  UAE: "AE",
  "SOUTH KOREA": "KR",
  "NORTH KOREA": "KP",
  RUSSIA: "RU",
  "RUSSIAN FEDERATION": "RU",
  VIETNAM: "VN",
  "VIET NAM": "VN",
  IRAN: "IR",
  SYRIA: "SY",
  BOLIVIA: "BO",
  VENEZUELA: "VE",
  TANZANIA: "TZ",
  MOLDOVA: "MD",
  LAOS: "LA",
  "CZECH REPUBLIC": "CZ",
  CZECHIA: "CZ",
  HOLLAND: "NL",
  "IVORY COAST": "CI",
  "COTE D IVOIRE": "CI",
  "BOSNIA AND HERZEGOVINA": "BA",
  "NORTH MACEDONIA": "MK",
  MACEDONIA: "MK",
  // Plain names for every mapped country, so full-name imports work.
  CANADA: "CA",
  MEXICO: "MX",
  GUATEMALA: "GT",
  BELIZE: "BZ",
  HONDURAS: "HN",
  "EL SALVADOR": "SV",
  NICARAGUA: "NI",
  "COSTA RICA": "CR",
  PANAMA: "PA",
  CUBA: "CU",
  "DOMINICAN REPUBLIC": "DO",
  "PUERTO RICO": "PR",
  JAMAICA: "JM",
  "TRINIDAD AND TOBAGO": "TT",
  BAHAMAS: "BS",
  "THE BAHAMAS": "BS",
  HAITI: "HT",
  BONAIRE: "BQ",
  BRAZIL: "BR",
  ARGENTINA: "AR",
  CHILE: "CL",
  COLOMBIA: "CO",
  PERU: "PE",
  ECUADOR: "EC",
  PARAGUAY: "PY",
  URUGUAY: "UY",
  GUYANA: "GY",
  SURINAME: "SR",
  IRELAND: "IE",
  FRANCE: "FR",
  GERMANY: "DE",
  NETHERLANDS: "NL",
  BELGIUM: "BE",
  LUXEMBOURG: "LU",
  SWITZERLAND: "CH",
  AUSTRIA: "AT",
  ITALY: "IT",
  SPAIN: "ES",
  PORTUGAL: "PT",
  GREECE: "GR",
  DENMARK: "DK",
  SWEDEN: "SE",
  NORWAY: "NO",
  FINLAND: "FI",
  ICELAND: "IS",
  POLAND: "PL",
  SLOVAKIA: "SK",
  SLOVENIA: "SI",
  CROATIA: "HR",
  HUNGARY: "HU",
  ROMANIA: "RO",
  BULGARIA: "BG",
  SERBIA: "RS",
  MONTENEGRO: "ME",
  ALBANIA: "AL",
  ESTONIA: "EE",
  LATVIA: "LV",
  LITHUANIA: "LT",
  UKRAINE: "UA",
  BELARUS: "BY",
  TURKEY: "TR",
  TURKIYE: "TR",
  CYPRUS: "CY",
  MALTA: "MT",
  GEORGIA: "GE",
  ARMENIA: "AM",
  AZERBAIJAN: "AZ",
  "SAUDI ARABIA": "SA",
  QATAR: "QA",
  KUWAIT: "KW",
  BAHRAIN: "BH",
  OMAN: "OM",
  ISRAEL: "IL",
  JORDAN: "JO",
  LEBANON: "LB",
  IRAQ: "IQ",
  PAKISTAN: "PK",
  INDIA: "IN",
  BANGLADESH: "BD",
  "SRI LANKA": "LK",
  NEPAL: "NP",
  MYANMAR: "MM",
  BURMA: "MM",
  THAILAND: "TH",
  CAMBODIA: "KH",
  MALAYSIA: "MY",
  SINGAPORE: "SG",
  BRUNEI: "BN",
  INDONESIA: "ID",
  PHILIPPINES: "PH",
  CHINA: "CN",
  "HONG KONG": "HK",
  TAIWAN: "TW",
  MACAU: "MO",
  MACAO: "MO",
  JAPAN: "JP",
  MONGOLIA: "MN",
  KAZAKHSTAN: "KZ",
  UZBEKISTAN: "UZ",
  TAJIKISTAN: "TJ",
  KYRGYZSTAN: "KG",
  TURKMENISTAN: "TM",
  AFGHANISTAN: "AF",
  AUSTRALIA: "AU",
  "NEW ZEALAND": "NZ",
  FIJI: "FJ",
  "PAPUA NEW GUINEA": "PG",
  "SOUTH AFRICA": "ZA",
  NIGERIA: "NG",
  KENYA: "KE",
  GHANA: "GH",
  EGYPT: "EG",
  MOROCCO: "MA",
  UGANDA: "UG",
  ETHIOPIA: "ET",
  BOTSWANA: "BW",
  NAMIBIA: "NA",
  ZIMBABWE: "ZW",
  MOZAMBIQUE: "MZ",
  MAURITIUS: "MU",
  TUNISIA: "TN",
  ALGERIA: "DZ",
  ANGOLA: "AO",
  CAMEROON: "CM",
  SENEGAL: "SN",
  ZAMBIA: "ZM",
  RWANDA: "RW",
  SUDAN: "SD",
};

/** US state name (uppercased) to its two-letter code. */
const US_STATE_NAME_TO_CODE: Record<string, string> = {
  ALABAMA: "AL",
  ALASKA: "AK",
  ARIZONA: "AZ",
  ARKANSAS: "AR",
  CALIFORNIA: "CA",
  COLORADO: "CO",
  CONNECTICUT: "CT",
  DELAWARE: "DE",
  "DISTRICT OF COLUMBIA": "DC",
  FLORIDA: "FL",
  GEORGIA: "GA",
  HAWAII: "HI",
  IDAHO: "ID",
  ILLINOIS: "IL",
  INDIANA: "IN",
  IOWA: "IA",
  KANSAS: "KS",
  KENTUCKY: "KY",
  LOUISIANA: "LA",
  MAINE: "ME",
  MARYLAND: "MD",
  MASSACHUSETTS: "MA",
  MICHIGAN: "MI",
  MINNESOTA: "MN",
  MISSISSIPPI: "MS",
  MISSOURI: "MO",
  MONTANA: "MT",
  NEBRASKA: "NE",
  NEVADA: "NV",
  "NEW HAMPSHIRE": "NH",
  "NEW JERSEY": "NJ",
  "NEW MEXICO": "NM",
  "NEW YORK": "NY",
  "NORTH CAROLINA": "NC",
  "NORTH DAKOTA": "ND",
  OHIO: "OH",
  OKLAHOMA: "OK",
  OREGON: "OR",
  PENNSYLVANIA: "PA",
  "RHODE ISLAND": "RI",
  "SOUTH CAROLINA": "SC",
  "SOUTH DAKOTA": "SD",
  TENNESSEE: "TN",
  TEXAS: "TX",
  UTAH: "UT",
  VERMONT: "VT",
  VIRGINIA: "VA",
  WASHINGTON: "WA",
  "WEST VIRGINIA": "WV",
  WISCONSIN: "WI",
  WYOMING: "WY",
};

/** Primary IANA zone per US state (the zone covering most of its population). */
const US_STATE_TIMEZONES: Record<string, string> = {
  AL: "America/Chicago",
  AK: "America/Anchorage",
  AZ: "America/Phoenix",
  AR: "America/Chicago",
  CA: "America/Los_Angeles",
  CO: "America/Denver",
  CT: "America/New_York",
  DE: "America/New_York",
  DC: "America/New_York",
  FL: "America/New_York",
  GA: "America/New_York",
  HI: "Pacific/Honolulu",
  ID: "America/Boise",
  IL: "America/Chicago",
  IN: "America/Indiana/Indianapolis",
  IA: "America/Chicago",
  KS: "America/Chicago",
  KY: "America/Kentucky/Louisville",
  LA: "America/Chicago",
  ME: "America/New_York",
  MD: "America/New_York",
  MA: "America/New_York",
  MI: "America/Detroit",
  MN: "America/Chicago",
  MS: "America/Chicago",
  MO: "America/Chicago",
  MT: "America/Denver",
  NE: "America/Chicago",
  NV: "America/Los_Angeles",
  NH: "America/New_York",
  NJ: "America/New_York",
  NM: "America/Denver",
  NY: "America/New_York",
  NC: "America/New_York",
  ND: "America/Chicago",
  OH: "America/New_York",
  OK: "America/Chicago",
  OR: "America/Los_Angeles",
  PA: "America/New_York",
  RI: "America/New_York",
  SC: "America/New_York",
  SD: "America/Chicago",
  TN: "America/Chicago",
  TX: "America/Chicago",
  UT: "America/Denver",
  VT: "America/New_York",
  VA: "America/New_York",
  WA: "America/Los_Angeles",
  WV: "America/New_York",
  WI: "America/Chicago",
  WY: "America/Denver",
};

function normalizeKey(value: string): string {
  return value.trim().toUpperCase().replace(/\./g, "").replace(/\s+/g, " ");
}

/** Field lookup that tolerates the casing an import happened to use. */
function getField(fields: LeadFields, name: string): string | null {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(fields)) {
    if (key.toLowerCase() === wanted && value !== null && value !== undefined) {
      const text = String(value).trim();
      if (text.length > 0) {
        return text;
      }
    }
  }
  return null;
}

/** True when the runtime recognises the value as an IANA timezone. */
export function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Resolve a country field value (name or ISO code) to an ISO code. */
export function countryCodeFor(value: string): string | null {
  const normalized = normalizeKey(value);
  if (/^[A-Z]{2}$/.test(normalized) && COUNTRY_TIMEZONES[normalized]) {
    return normalized;
  }
  return COUNTRY_NAME_TO_CODE[normalized] ?? null;
}

/**
 * The lead's own IANA timezone, or null when nothing on the lead
 * resolves. See the module comment for the resolution order.
 */
export function resolveLeadTimezone(fields: LeadFields | null | undefined): string | null {
  if (!fields || typeof fields !== "object") {
    return null;
  }

  const explicit = getField(fields, "timezone") ?? getField(fields, "tz");
  if (explicit && isValidTimezone(explicit)) {
    return explicit;
  }

  const countryRaw = getField(fields, "country");
  const countryCode = countryRaw ? countryCodeFor(countryRaw) : null;

  if (countryCode === "US") {
    const stateRaw = getField(fields, "state");
    if (stateRaw) {
      const normalized = normalizeKey(stateRaw);
      const code = /^[A-Z]{2}$/.test(normalized) ? normalized : US_STATE_NAME_TO_CODE[normalized];
      const zone = code ? US_STATE_TIMEZONES[code] : undefined;
      if (zone) {
        return zone;
      }
    }
  }

  if (countryCode) {
    return COUNTRY_TIMEZONES[countryCode] ?? null;
  }
  return null;
}
