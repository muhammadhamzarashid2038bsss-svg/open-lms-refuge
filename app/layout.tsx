import { ReloadAfterCache } from "@/components/reload-after-cache";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import { productName, productTagline } from "@/lib/product";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  applicationName: productName,
  title: productName,
  description: productTagline,
};

export const viewport: Viewport = {
  themeColor: "#09090b",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="relative min-h-full flex flex-col bg-white text-zinc-950">
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <ServiceWorkerRegistration />
        <ReloadAfterCache />
        {children}
      </body>
    </html>
  );
}
