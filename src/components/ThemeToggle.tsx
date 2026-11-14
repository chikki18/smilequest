"use client";
import { useEffect, useState } from "react";
export function applyTheme(t: "night" | "morning") { document.documentElement.dataset.theme = t; try { localStorage.setItem("sq-theme", t); } catch { /* ignore */ } }
export default function ThemeToggle() {
  const [t, setT] = useState<"night" | "morning">("night");
  useEffect(() => { setT(document.documentElement.dataset.theme === "morning" ? "morning" : "night"); }, []);
  const pick = (v: "night" | "morning") => { setT(v); applyTheme(v); };
  const b = (v: "night" | "morning", label: string) => (
    <button type="button" role="radio" aria-checked={t === v} onClick={() => pick(v)} className={`min-h-[40px] rounded-full px-4 text-sm transition ${t === v ? "bg-teal text-white shadow-soft" : "text-navy/70"}`}>{label}</button>);
  return <div role="radiogroup" aria-label="Color mode" className="inline-flex rounded-full border border-navy/15 bg-paper p-1">{b("morning", "Morning")}{b("night", "Night")}</div>;
}
