import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { publicOrigin } from "@/lib/publicOrigin";

const SESSION_COOKIE = "coldreach_session";

async function hasValidSession(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const secret = process.env.SESSION_SECRET;
  if (!token || !secret) {
    return false;
  }
  try {
    await jwtVerify(token, new TextEncoder().encode(secret));
    return true;
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const valid = await hasValidSession(request);

  // Redirects must use the public origin, not request.nextUrl: behind
  // the production proxy, nextUrl points at localhost:3000 (v1.32.0).
  const origin = publicOrigin({
    forwardedHost: request.headers.get("x-forwarded-host"),
    forwardedProto: request.headers.get("x-forwarded-proto"),
    host: request.headers.get("host"),
    appUrl: process.env.APP_URL,
    fallback: request.nextUrl.origin,
  });

  if (pathname.startsWith("/app") && !valid) {
    const url = new URL("/login", origin);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if ((pathname === "/login" || pathname === "/signup") && valid) {
    return NextResponse.redirect(new URL("/app", origin));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/login", "/signup"],
};
