import { ImageResponse } from "next/og";

/**
 * Renders the ColdReach app icon as a real PNG.
 *
 * Why generated: the GitHub snapshot flow for this repo moves text
 * files only, so binary icon files cannot be committed. These
 * routes render the same artwork as src/app/icon.svg (indigo
 * gradient tile, white paper plane) with next/og at the sizes the
 * PWA manifest and Apple require. The routes are force-static, so
 * in production the PNGs are generated once at build time.
 */

const PLANE_PATH =
  "M26.8 5.2 6.4 13.4c-.95.38-.9 1.62.08 1.92l5.9 1.83 1.83 5.9c.3.98 1.54 1.03 1.92.08l2.5-6.24 4.42 4.55c.62.64 1.66.3 1.82-.58l2.7-15.7c.17-1-.84-1.78-1.77-1.36Z";
const PLANE_SHADE_PATH =
  "M18.63 16.9 26.8 5.2c.93-.42 1.94.36 1.77 1.36l-.36 2.1-9.58 8.24Z";

export type IconVariant = "any" | "maskable" | "apple";

export function renderAppIcon(size: number, variant: IconVariant): ImageResponse {
  // "any" icons keep the artwork's own rounded corners on a
  // transparent ground, like icon.svg. Maskable and Apple icons
  // must be full bleed: the platform applies its own mask, so the
  // gradient fills the square and the glyph sits smaller, inside
  // the maskable safe zone.
  const fullBleed = variant !== "any";
  const glyph = Math.round(size * (variant === "maskable" ? 0.62 : 0.8));
  const radius = fullBleed ? 0 : Math.round(size * 0.22);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #6366F1 0%, #4338CA 100%)",
          borderRadius: radius,
        }}
      >
        <svg width={glyph} height={glyph} viewBox="0 0 32 32">
          <path d={PLANE_PATH} fill="#ffffff" />
          <path d={PLANE_SHADE_PATH} fill="#C7D2FE" />
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}
