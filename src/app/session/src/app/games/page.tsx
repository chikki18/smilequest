"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { loadContext, moveLabel, type Sess } from "@/lib/workflow";

const GAMES = [
  { href: "/play", name: "The Magical Expression Spellbook", mins: "3 to 5 min", blurb: "You’re an apprentice wizard. Hold a gentle movement to wake the forgotten lantern and light the forest.", art: "lantern" },
  { href: "/canvas", name: "Living Portrait & Canvas", mins: "As long as you like", blurb: "A calm studio. Your movements paint a watercolor garden or shape a clay vessel. No timers, no scores.", art: "palette" },
  { href: "/flyer", name: "Mirror Flight", mins: "3 to 10 min", blurb: "Glide through gaps and collect coins. Unlock new colors and animal friends as you go.", art: "bird" },
];
function Art({ k }: { k: string }) {
  return (<svg viewBox="0 0 120 70" className="h-full w-full" aria-hidden>
    {k === "lantern" && <><rect width="120" height="70" fill="#1b2a3a" /><circle cx="60" cy="34" r="30" fill="#f4d98e" opacity=".25" /><circle cx="60" cy="34" r="16" fill="#f4d98e" opacity=".5" /><rect x="52" y="24" width="16" height="20" rx="3" fill="#f6e3a6" /><path d="M0 70 Q30 52 60 62 T120 58 V70Z" fill="#0f1a28" /></>}
    {k === "palette" && <><rect width="120" height="70" fill="#f6e9d0" /><circle cx="38" cy="38" r="22" fill="#e8a0b4" opacity=".8" /><circle cx="66" cy="30" r="20" fill="#a9c8a0" opacity=".8" /><circle cx="84" cy="44" r="18" fill="#b7a7dc" opacity=".75" /></>}
    {k === "bird" && <><rect width="120" height="70" fill="#62c3ee" /><rect x="82" y="0" width="16" height="26" fill="#79c08c" stroke="#35604a" strokeWidth="2" /><rect x="82" y="46" width="16" height="24" fill="#79c08c" stroke="#35604a" strokeWidth="2" /><ellipse cx="38" cy="36" rx="14" ry="12" fill="#6bb3a8" stroke="#2b3340" strokeWidth="2" /><circle cx="43" cy="32" r="3" fill="#fff" /><path d="M50 36 L58 39 L50 42Z" fill="#f29e4c" /></>}
  </svg>);
}

export default function Games() {
  const [ok, setOk] = useState(false), [allowed, setAllowed] = useState<string[] | null>([]), [sess, setSess] = useState<Sess | null>(null);
  const [calibrated, setCalibrated] = useState<string[]>([]);
  useEffect(() => { (async () => {
    const { data: { user } } = await supabase().auth.getUser(); if (!user) { location.href = "/"; return; }
    const ctx = await loadContext(); if (!ctx.session) { location.href = "/session"; return; }
    setSess(ctx.session); setAllowed(ctx.allowed);
    const { data } = await supabase().from("calibration_profiles").select("summary").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const m = (data?.summary?.moves ?? {}) as Record<string, { detectable: boolean }>;
    setCalibrated(Object.keys(m).filter(k => m[k].detectable)); setOk(true);
  })(); }, []);
  if (!ok) return <main className="grid min-h-dvh place-items-center text-navy/60">Loading…</main>;
  const usable = (allowed ?? ["smile", "brow", "pucker", "close"]).filter(k => calibrated.includes(k));
  const need = (allowed ?? ["smile", "brow", "pucker", "close"]).filter(k => !calibrated.includes(k));
  return (
    <main className="mx-auto max-w-md px-6 pb-16 pt-[max(2rem,env(safe-area-inset-top))]">
      <h1 className="font-display text-3xl">Choose your game</h1>
      <p className="mt-2 text-sm text-navy/70">{sess?.mode === "explore" ? "Free play. This session isn’t counted as an exercise session." : "Your plan’s approved movements: " + (allowed ?? []).map(moveLabel).join(", ") + "."}</p>
      {need.length > 0 && <div className="mt-4 rounded-2xl bg-gold/20 p-4 text-sm"><b>Camera setup needed</b> for {need.map(moveLabel).join(", ")}. {usable.length ? "You can play now with the ones that are ready." : "Calibrate first so the games fit your own movements."}
        <a href="/calibrate" className="btn-primary mt-3 inline-flex min-h-[48px] w-full items-center justify-center">Set up camera</a></div>}
      <div className="mt-6 grid gap-5">{GAMES.map(g => (
        <section key={g.href} className="overflow-hidden rounded-3xl bg-paper shadow-soft">
          <div className="h-32"><Art k={g.art} /></div>
          <div className="p-5"><h2 className="font-display text-xl">{g.name}</h2><p className="mt-1 text-sm text-navy/70">{g.blurb}</p>
            <p className="mt-2 text-xs text-navy/60">Movements: {usable.length ? usable.map(moveLabel).join(", ") : "none ready yet"} · {g.mins}</p>
            <a href={usable.length ? g.href : "/calibrate"} className="btn-primary mt-4 inline-flex w-full items-center justify-center">{usable.length ? "Play" : "Set up camera first"}</a></div>
        </section>))}</div>
      <a href="/dashboard" className="btn-quiet mt-6 inline-flex w-full items-center justify-center">Back to dashboard</a>
    </main>);
}
