import { NextResponse } from "next/server";

/**
 * The dashboard diagnostic that lived here in v1.15.1 is retired.
 * It identified the root cause of the 2026-11-04 dashboard crash
 * (invalid IANA zones Europe/Tbilisi and Europe/Yerevan in the
 * lead timezone map; fixed in v1.15.2) and is disabled from
 * v1.15.2 onward. The file remains as a 404 tombstone because the
 * snapshot deploy path can update files but cannot delete them;
 * remove this route in the next delete-capable change.
 */
export async function GET() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
