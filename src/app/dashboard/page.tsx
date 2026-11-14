"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { PATIENT_TEST_MODE } from "@/lib/config";
import ThemeToggle from "@/components/ThemeToggle";
import { GAME_NAMES, exerciseReady, loadContext, moveLabel, type Plan, type Sess } from "@/lib/workflow";

type Row = { id: string; mode: string; status: string; started_at: string; game: string | null; duration_seconds: number | null };
function FullDashboard() {
  const [ok, setOk] = useState(false), [plan, setPlan] = useState<Plan | null>(null), [sess, setSess] = useState<Sess | null>(null);
  const [recent, setRecent] = useState<Row[]>([]), [week, setWeek] = useState(0);
  useEffect(() => { (async () => {
    const sb = supabase(); const { data: { user } } = await sb.auth.getUser(); if (!user) { location.href = "/"; return; }
    const { data: p } = await sb.from("profiles").select("onboarding_completed_at").maybeSingle();
    if (!p?.onboarding_completed_at) { location.href = "/onboarding"; return; }
    const ctx = await loadContext(); setPlan(ctx.plan); setSess(ctx.session);
    const { data } = await sb.from("sessions").select("id,mode,status,started_at,game,duration_seconds").eq("status", "completed").order("started_at", { ascending: false }).limit(20);
    const rows = (data as Row[]) ?? []; setRecent(rows.slice(0, 4));
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    setWeek(rows.filter(r => r.mode === "exercise" && new Date(r.started_at) >= d).length); setOk(true);
  })(); }, []);
  if (!ok) return <main className="grid min-h-dvh place-items-center text-navy/60">Loading…</main>;
  const target = plan?.sessions_per_week ?? 0, ready = exerciseReady(plan);
  return (
    <main className="mx-auto max-w-md px-6 pb-28 pt-[max(2.5rem,env(safe-area-inset-top))]">
      <h1 className="font-display text-3xl">Welcome back.</h1>
      <section className="mt-6 rounded-3xl bg-paper p-6 shadow-soft">
        {!plan ? <><h2 className="font-display text-xl">Set up your plan</h2><p className="mt-2 text-sm text-navy/70">Choose the movements your clinician has approved, so the games fit you.</p>
          <a href="/plan" className="btn-primary mt-4 inline-flex w-full items-center justify-center">Create my plan</a></>
          : sess ? <><h2 className="font-display text-xl">Your session is in progress</h2><p className="mt-2 text-sm text-navy/70">You’ve already done today’s check-in. Pick up where you left off.</p>
            <a href="/games" className="btn-primary mt-4 inline-flex w-full items-center justify-center">Continue session</a></>
          : <><h2 className="font-display text-xl">Ready when you are</h2><p className="mt-2 text-sm text-navy/70">{ready ? "A quick five-question check-in comes first." : "Exercises are locked until you confirm clinician approval in your plan. Free play is available."}</p>
            <a href="/session" className="btn-primary mt-4 inline-flex w-full items-center justify-center">Start a session</a></>}
      </section>
      {plan && <section className="mt-4 rounded-3xl bg-lav/40 p-6"><h2 className="font-display text-xl">Your plan</h2>
        <p className="mt-2 text-sm">{ready ? `Approved movements: ${plan.authorized_movements.map(moveLabel).join(", ")}.` : "No movements are confirmed for exercise yet."}</p>
        {target > 0 && <p className="mt-1 text-sm">This week: {week} of {target} planned sessions.</p>}
        {plan.goals.length > 0 && <ul className="mt-2 grid gap-1 text-sm text-navy/80">{plan.goals.slice(0, 4).map(g => <li key={g}>· {g}</li>)}</ul>}
        <a href="/plan" className="btn-quiet mt-4 inline-flex min-h-[48px] w-full items-center justify-center">Edit plan</a></section>}
      <section className="mt-4 rounded-3xl bg-paper p-6 shadow-soft"><h2 className="font-display text-xl">Recent sessions</h2>
        {recent.length === 0 ? <p className="mt-2 text-sm text-navy/70">Nothing yet. Your first session will appear here.</p>
          : <ul className="mt-3 grid gap-2 text-sm">{recent.map(r => <li key={r.id}><a href={`/summary?id=${r.id}`} className="flex justify-between"><span>{new Date(r.started_at).toLocaleDateString()} · {r.game ? GAME_NAMES[r.game] : "Session"}</span><span className="text-navy/60">{r.mode === "explore" ? "Free play" : "Exercise"}</span></a></li>)}</ul>}
        <a href="/history" className="btn-quiet mt-4 inline-flex min-h-[48px] w-full items-center justify-center">All sessions</a>
        <a href="/gallery" className="mt-3 block text-center text-sm text-navy/70 underline">Your artwork gallery</a></section>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 border-t border-navy/10 bg-ivory/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"><ul className="mx-auto flex max-w-md justify-around">
        {[["Home", "/dashboard"], ["Plan", "/plan"], ["History", "/history"], ["Camera", "/calibrate"]].map(([l, h]) => <li key={l}><a href={h} className="flex min-h-[56px] min-w-[72px] items-center justify-center text-sm text-navy/80">{l}</a></li>)}</ul></nav>
    </main>);
}

function TestHome() {
  const [ok, setOk] = useState(false), [name, setName] = useState(""), [cal, setCal] = useState<{ flight: boolean; dash: boolean }>({ flight: false, dash: false });
  useEffect(() => { (async () => {
    const sb = supabase(); const { data: { user } } = await sb.auth.getUser(); if (!user) { location.href = "/"; return; }
    const { data: p } = await sb.from("profiles").select("onboarding_completed_at,first_name").maybeSingle();
    if (!p?.onboarding_completed_at) { location.href = "/onboarding"; return; }
    setName(p.first_name ?? "");
    const { data: c } = await sb.from("calibration_profiles").select("created_at").order("created_at", { ascending: false }).limit(1);
    const { data: d } = await sb.from("dash_calibration").select("summary").maybeSingle();
    const mv = d?.summary?.moves, dashReady = !!mv && ["jump", "fly", "duck", "right", "left"].every(m => mv[m]?.detectable);
    const flightReady = !!c?.length;
    let skipped = false; try { skipped = sessionStorage.getItem("sq-skipcal") === "1"; } catch { /* ignore */ }
    if (!flightReady && !dashReady && !skipped) { location.href = "/calibrate?first=1&next=/dashboard"; return; }
    setCal({ flight: flightReady, dash: dashReady }); setOk(true);
  })(); }, []);
  async function logout() { await supabase().auth.signOut(); location.href = "/"; }
  if (!ok) return <main className="grid min-h-dvh place-items-center text-navy/60">Loading…</main>;
  const any = cal.flight || cal.dash;
  return (
    <main className="mx-auto min-h-dvh max-w-md px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="flex items-center justify-between gap-3"><p className="text-xs uppercase tracking-[.3em] text-teal">SmileQuest</p><ThemeToggle /></div>
      <h1 className="mt-6 font-display text-4xl leading-tight">{name ? `Hi, ${name}.` : "Welcome back."}</h1>
      <h2 className="mt-8 text-xs uppercase tracking-[.25em] text-navy/60">Pick a game</h2>
      <a href="/flyer" className="mt-3 block overflow-hidden rounded-3xl border border-navy/10 bg-paper shadow-soft transition active:scale-[.99]">
        <svg viewBox="0 0 320 130" className="block w-full" aria-hidden><defs><linearGradient id="fg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="rgb(var(--lav))" /><stop offset="1" stopColor="rgb(var(--ivory))" /></linearGradient></defs><rect width="320" height="130" fill="url(#fg)" />
          <path d="M0 112q50-22 100-6t110-8 110 10v22H0z" fill="rgb(var(--sage))" opacity=".35" />
          <rect x="206" y="-8" width="30" height="50" rx="7" fill="rgb(var(--teal))" /><rect x="206" y="88" width="30" height="50" rx="7" fill="rgb(var(--teal))" />
          <path d="M60 70h60" stroke="rgb(var(--paper))" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 10" opacity=".9" />
          <circle cx="150" cy="66" r="15" fill="rgb(var(--navy))" /><path d="M140 66q-9-13-20-9 4 9 12 14z" fill="rgb(var(--navy))" opacity=".6" /><circle cx="155" cy="62" r="3.2" fill="rgb(var(--paper))" /><path d="M163 67l8 2-8 3z" fill="rgb(var(--gold))" />
          <circle cx="271" cy="65" r="6" fill="rgb(var(--gold))" /></svg>
        <div className="flex items-center justify-between p-5"><div><h3 className="font-display text-2xl">Mirror Flight</h3><p className="mt-1 text-sm text-navy/70">Gentle and steady. Fly through the gaps.</p></div><span className="text-2xl text-teal" aria-hidden>→</span></div></a>
      <a href="/dash" className="mt-4 block overflow-hidden rounded-3xl border border-navy/10 bg-paper shadow-soft transition active:scale-[.99]">
        <svg viewBox="0 0 320 130" className="block w-full" aria-hidden><defs><linearGradient id="dg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="rgb(var(--navy))" stopOpacity=".92" /><stop offset="1" stopColor="rgb(var(--teal))" /></linearGradient></defs><rect width="320" height="130" fill="url(#dg)" />
          <path d="M148 34h24l70 96H78z" fill="rgb(var(--paper))" opacity=".12" />
          <path d="M155 34L128 130M160 34v96M165 34l27 96" stroke="rgb(var(--paper))" strokeOpacity=".35" strokeWidth="1.5" />
          <rect x="143" y="62" width="34" height="5" rx="2.5" fill="rgb(var(--gold))" />
          <circle cx="186" cy="82" r="4.5" fill="rgb(var(--gold))" /><circle cx="196" cy="100" r="6" fill="rgb(var(--gold))" />
          <rect x="106" y="86" width="26" height="30" rx="13" fill="rgb(var(--paper))" /><circle cx="119" cy="80" r="8" fill="rgb(var(--paper))" /></svg>
        <div className="flex items-center justify-between p-5"><div><h3 className="font-display text-2xl">Mirror Dash</h3><p className="mt-1 text-sm text-navy/70">Fast and challenging. Run, jump, duck and fly.</p></div><span className="text-2xl text-teal" aria-hidden>→</span></div></a>
      <a href="/calibrate" className="btn-quiet mt-8 inline-flex min-h-[52px] w-full items-center justify-center">{any ? "Recalibrate" : "Calibrate"}</a>
    </main>);
}

export default function Dashboard() { return PATIENT_TEST_MODE ? <TestHome /> : <FullDashboard />; }
