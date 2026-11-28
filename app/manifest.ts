import type { MetadataRoute } from "next";
import { productName } from "@/lib/product";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/kiosk-shell",
    name: productName,
    short_name: productName,
    description: "Attendance for a learning center. Marks stay on this phone until they can be sent.",
    start_url: "/kiosk-shell",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#09090b",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
