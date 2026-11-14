"use client";
import { useEffect, useState } from "react";
export function applyTheme(t: "night" | "morning") { document.documentElement.dataset.theme = t; try { localStorage.setItem("sq-theme", t); } catch { /* ignore */ } }
export default function ThemeToggle() {
  const [t, setT] = useState<"night" | "morning">("night");
  useEffect(() => { setT(document.documentElement.dataset.theme === "morning" ? "morning" : "night"); }, []);
  const next = t === "night" ? "morning" : "night";
  return (
    <button type="button" onClick={() => { setT(next); applyTheme(next); }} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}
      className="grid h-9 w-9 place-items-center rounded-full border border-navy/15 bg-paper text-teal transition active:scale-95">
      {t === "night"
        ? <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" /></svg>
        : <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" /></svg>}
    </button>);
}
