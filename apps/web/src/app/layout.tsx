import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Geist, Geist_Mono, Pixelify_Sans } from "next/font/google";
import { preconnect } from "react-dom";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { env } from "@/lib/env";
import { SITE_DESCRIPTION, SITE_TITLE } from "@/lib/site";
import { X_HANDLE } from "@/lib/social";
import { THEME_SCRIPT } from "@/lib/theme-script";
import { THEME_GROUND_DARK } from "@/lib/theme-colors";
import { Providers } from "../providers";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
// The pixel face carries the landing's signature words, never body copy or numbers in the terminal.
const pixel = Pixelify_Sans({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-pixelify", display: "swap" });
const condensed = Barlow_Condensed({ subsets: ["latin"], weight: ["600", "700", "800"], style: ["normal", "italic"], variable: "--font-barlow-condensed", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { absolute: SITE_TITLE },
  description: SITE_DESCRIPTION,
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    siteName: "ZENOMARKETS",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    site: X_HANDLE,
    creator: X_HANDLE,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

export const viewport: Viewport = { themeColor: THEME_GROUND_DARK };

/// Open the connections to the chain RPC and the API while the page is still loading, so the first
/// read does not also pay for DNS and TLS (about two seconds cold, against about 0.3 s warm).
const origin = (url: string | undefined) => {
  try {
    return url ? new URL(url).origin : undefined;
  } catch {
    return undefined;
  }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  for (const target of new Set([origin(env.readRpcUrl), origin(env.apiUrl)])) {
    if (target) preconnect(target, { crossOrigin: "anonymous" });
  }
  return (
    // Dark by default. The theme script removes data-theme before hydration for a visitor who chose light, so React
    // must not flag the attribute as a mismatch.
    <html lang="en" data-theme="dark" suppressHydrationWarning className={`${geist.variable} ${pixel.variable} ${condensed.variable} ${geistMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
