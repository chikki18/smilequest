import type { Metadata, Viewport } from "next";
import { Fraunces, Figtree } from "next/font/google";
import "./globals.css";
const display = Fraunces({ subsets: ["latin"], variable: "--font-display", axes: ["opsz"] });
const body = Figtree({ subsets: ["latin"], variable: "--font-body" });
export const metadata: Metadata = {
  title: "SmileQuest", description: "Your recovery, one expression at a time.",
  appleWebApp: { capable: true, title: "SmileQuest", statusBarStyle: "default" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, viewportFit: "cover", themeColor: [{ media: "(prefers-color-scheme: light)", color: "#F3F2FB" }, { media: "(prefers-color-scheme: dark)", color: "#14153F" }] };
export default function Root({ children }: { children: React.ReactNode }) {
  const init = `try{var t=localStorage.getItem("sq-theme")||(matchMedia("(prefers-color-scheme: light)").matches?"morning":"night");document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="night"}`;
  return <html lang="en" suppressHydrationWarning className={`${display.variable} ${body.variable}`}><head><script dangerouslySetInnerHTML={{ __html: init }} /></head><body className="min-h-dvh">{children}</body></html>;
}
