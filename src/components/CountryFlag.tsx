/**
 * Country flag icon (v1.17.0).
 *
 * Renders the flag-icons SVG for an ISO country code. Flag emoji
 * cannot be used for this: Windows renders regional-indicator emoji
 * as the two plain letters (a US flag shows as the text "US"), which
 * is what Amir reported on the dashboard. The flag-icons set is the
 * standard bundled SVG country flag library; Font Awesome, which
 * Amir suggested, ships no per-country flags, only a generic flag.
 * The stylesheet is imported once in the root layout.
 */
export function CountryFlag({
  code,
  className = "",
}: {
  /** ISO 3166-1 alpha-2 code, for example "US". */
  code: string | null | undefined;
  className?: string;
}) {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) {
    return null;
  }
  const normalized = code.toLowerCase();
  return (
    <span
      aria-hidden="true"
      className={`fi fi-${normalized} ${className}`}
      style={{ borderRadius: "2px", boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.08)" }}
    />
  );
}
