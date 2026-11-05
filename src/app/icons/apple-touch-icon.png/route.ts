import { renderAppIcon } from "@/lib/iconImage";

export const dynamic = "force-static";

export function GET() {
  return renderAppIcon(180, "apple");
}
