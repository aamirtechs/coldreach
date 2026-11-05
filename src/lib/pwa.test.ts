import { describe, expect, it } from "vitest";
import {
  pwaManifest,
  PWA_BACKGROUND_COLOR,
  PWA_THEME_COLOR,
  PWA_THEME_COLOR_DARK,
} from "./pwa";

describe("pwaManifest", () => {
  it("is an installable standalone app rooted at the signed in app", () => {
    expect(pwaManifest.name).toBe("ColdReach");
    expect(pwaManifest.short_name).toBe("ColdReach");
    expect(pwaManifest.display).toBe("standalone");
    expect(pwaManifest.start_url).toBe("/app");
    expect(pwaManifest.scope).toBe("/");
  });

  it("carries the icon sizes installability requires, plus a maskable icon", () => {
    const icons = pwaManifest.icons ?? [];
    const key = (icon: (typeof icons)[number]) => `${icon.sizes}:${icon.purpose}`;
    expect(icons.map(key)).toContain("192x192:any");
    expect(icons.map(key)).toContain("512x512:any");
    expect(icons.map(key)).toContain("512x512:maskable");
    for (const icon of icons) {
      expect(icon.src).toMatch(/^\/icons\/.+\.png$/);
      expect(icon.type).toBe("image/png");
    }
  });

  it("uses valid hex theme colors that match the site palette", () => {
    const hex = /^#[0-9a-f]{6}$/i;
    expect(pwaManifest.theme_color).toMatch(hex);
    expect(pwaManifest.background_color).toMatch(hex);
    expect(pwaManifest.theme_color).toBe(PWA_THEME_COLOR);
    expect(pwaManifest.background_color).toBe(PWA_BACKGROUND_COLOR);
    expect(PWA_THEME_COLOR_DARK).toMatch(hex);
  });
});
