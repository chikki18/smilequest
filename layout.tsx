import type { Metadata, Viewport } from "next";
import { Fraunces, Figtree } from "next/font/google";
import "./globals.css";
const display = Fraunces({ subsets: ["latin"], variable: "--font-display", axes: ["opsz"] });
const body = Figtree({ subsets: ["latin"], variable: "--font-body" });
export const metadata: Metadata = { title: "SmileQuest", description: "Your recovery, one expression at a time." };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#FAF6EE" };
export default function Root({ children }: { children: React.ReactNode }) {
  return <html lang="en" className={`${display.variable} ${body.variable}`}><body className="min-h-dvh">{children}</body></html>;
}
