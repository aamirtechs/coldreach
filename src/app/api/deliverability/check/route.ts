import { NextResponse } from "next/server";
import { apiError, requireSession } from "@/lib/api";
import { checkDomain } from "@/lib/deliverability/dnsService";

/**
 * Live DNS authentication check for one domain. All grading happens in
 * the pure evaluator (domain/dnsCheck.ts); this route only performs
 * the lookups and returns the report.
 */
export async function GET(request: Request) {
  const session = await requireSession("VIEWER");
  if ("error" in session) return session.error;
  const domain = new URL(request.url).searchParams.get("domain") ?? "";
  try {
    const report = await checkDomain(domain);
    return NextResponse.json({ report });
  } catch (error) {
    return apiError(error);
  }
}
