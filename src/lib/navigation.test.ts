import { describe, expect, it } from "vitest";
import {
  APP_NAV_ITEMS,
  MOBILE_MORE_ITEMS,
  MOBILE_PRIMARY_ITEMS,
  PLATFORM_ADMIN_NAV_ITEM,
} from "./navigation";

describe("app navigation", () => {
  it("keeps four primary destinations in the mobile bottom bar", () => {
    expect(MOBILE_PRIMARY_ITEMS.map((item) => item.href)).toEqual([
      "/app",
      "/app/campaigns",
      "/app/inbox",
      "/app/outbox",
    ]);
  });

  it("covers every sidebar destination between the bar and the More sheet", () => {
    const covered = [...MOBILE_PRIMARY_ITEMS, ...MOBILE_MORE_ITEMS].map((item) => item.href);
    expect(covered.sort()).toEqual(APP_NAV_ITEMS.map((item) => item.href).sort());
  });

  it("has no duplicates, and every destination stays inside the app", () => {
    const hrefs = [...APP_NAV_ITEMS, PLATFORM_ADMIN_NAV_ITEM].map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const href of hrefs) {
      expect(href.startsWith("/app")).toBe(true);
    }
  });
});
