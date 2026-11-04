import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { CommandPalette } from "@/components/CommandPalette";
import { Footer } from "@/components/Footer";
import { Loader } from "@/components/Loader";
import { Nav } from "@/components/Nav";
import "./globals.css";

const site =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: { default: "Sentinyx — every token talks", template: "%s · Sentinyx" },
  description: "Sentinyx finds instructions hidden in onchain text that AI agents read, and stops agents from obeying them.",
  openGraph: { siteName: "Sentinyx", type: "website" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = { viewportFit: "cover", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <Script id="sx-seen" strategy="beforeInteractive">
          {"try{if(sessionStorage.getItem('sx-seen'))document.documentElement.dataset.sx='seen'}catch(e){}"}
        </Script>
        <Loader />
        <a className="skip" href="#main">
          Skip to content
        </a>
        <Nav />
        {children}
        <Footer />
        <CommandPalette />
      </body>
    </html>
  );
}
