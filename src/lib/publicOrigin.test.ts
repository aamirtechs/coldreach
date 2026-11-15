import { describe, expect, it } from "vitest";
import { publicOrigin } from "./publicOrigin";

describe("publicOrigin", () => {
  it("prefers the proxy's forwarded host and proto", () => {
    expect(
      publicOrigin({
        forwardedHost: "app.aamirtechs.com",
        forwardedProto: "https",
        host: "localhost:3000",
        appUrl: "https://app.aamirtechs.com",
        fallback: "http://localhost:3000",
      }),
    ).toBe("https://app.aamirtechs.com");
  });

  it("takes the first value of a comma-separated forwarded host", () => {
    expect(
      publicOrigin({
        forwardedHost: "app.aamirtechs.com, internal",
        forwardedProto: "https, http",
        fallback: "http://localhost:3000",
      }),
    ).toBe("https://app.aamirtechs.com");
  });

  it("falls back to APP_URL when only a localhost host is visible", () => {
    expect(
      publicOrigin({
        forwardedHost: null,
        forwardedProto: null,
        host: "localhost:3000",
        appUrl: "https://app.aamirtechs.com/",
        fallback: "http://localhost:3000",
      }),
    ).toBe("https://app.aamirtechs.com");
  });

  it("uses a real host header when there is no proxy and no APP_URL", () => {
    expect(
      publicOrigin({
        forwardedHost: null,
        forwardedProto: "http",
        host: "dev.example.com:3000",
        appUrl: null,
        fallback: "http://localhost:3000",
      }),
    ).toBe("http://dev.example.com:3000");
  });

  it("keeps the request origin in plain local development", () => {
    expect(
      publicOrigin({
        forwardedHost: null,
        forwardedProto: null,
        host: "localhost:3000",
        appUrl: null,
        fallback: "http://localhost:3000",
      }),
    ).toBe("http://localhost:3000");
  });
});
