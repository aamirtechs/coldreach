import type { MetadataRoute } from "next";
import { pwaManifest } from "@/lib/pwa";

export default function manifest(): MetadataRoute.Manifest {
  return pwaManifest;
}
