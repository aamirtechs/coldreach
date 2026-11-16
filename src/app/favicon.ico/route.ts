import { renderAppIcon } from "@/lib/iconImage";

export const dynamic = "force-static";

/**
 * Serves a real /favicon.ico (v1.35.1).
 *
 * Browsers that ignore the SVG and PNG link icons (and anything
 * that requests /favicon.ico directly) got a 404 before this
 * route existed, so the tab showed the generic globe. The ICO
 * wraps the same 48px PNG artwork the icon routes render: an ICO
 * with a PNG-compressed entry is valid on every modern Windows
 * and browser version. Built from text source like the other
 * icons, because the GitHub snapshot flow moves text files only.
 */
export async function GET() {
  const png = new Uint8Array(await renderAppIcon(48, "any").arrayBuffer());

  const headerSize = 6;
  const entrySize = 16;
  const ico = new Uint8Array(headerSize + entrySize + png.length);
  const view = new DataView(ico.buffer);
  // ICONDIR: reserved, type (1 = icon), image count.
  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, 1, true);
  // ICONDIRENTRY: 48x48, no palette, 1 plane, 32 bpp.
  ico[6] = 48;
  ico[7] = 48;
  ico[8] = 0;
  ico[9] = 0;
  view.setUint16(10, 1, true);
  view.setUint16(12, 32, true);
  view.setUint32(14, png.length, true);
  view.setUint32(18, headerSize + entrySize, true);
  ico.set(png, headerSize + entrySize);

  return new Response(ico, {
    headers: {
      "Content-Type": "image/x-icon",
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
