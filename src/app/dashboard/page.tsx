"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { dailyDue, dailyUrl } from "@/lib/daily";
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
  const [due, setDue] = useState(false);
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
    setDue(await dailyDue());
  })(); }, []);
  async function logout() { await supabase().auth.signOut(); location.href = "/"; }
  if (!ok) return <main className="grid min-h-dvh place-items-center text-navy/60">Loading…</main>;
  const any = cal.flight || cal.dash;
  return (
    <main className="mx-auto min-h-dvh max-w-md px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
      <div className="flex items-center justify-between gap-3"><p className="text-xs uppercase tracking-[.3em] text-teal">SmileQuest</p><ThemeToggle /></div>
      <h1 className="mt-3 font-display text-3xl leading-tight">{name ? `Hi, ${name}.` : "Welcome back."}</h1>
      {due && any && <a href={dailyUrl("/dashboard")} className="mt-5 block rounded-2xl border border-teal/40 bg-teal/10 p-4 shadow-soft"><b>Daily recalibration</b><br /><span className="text-sm text-navy/70">About 3 minutes. Do it before you play today.</span></a>}
      <h2 className="mt-5 text-xs uppercase tracking-[.25em] text-navy/60">Pick a game</h2>
      <a href="/flyer" className="mt-3 flex items-stretch overflow-hidden rounded-3xl border border-navy/10 bg-paper shadow-soft transition active:scale-[.99]">
        <svg viewBox="0 0 320 130" preserveAspectRatio="xMidYMid slice" className="block w-36 shrink-0 self-stretch" aria-hidden><defs><linearGradient id="fg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="rgb(var(--lav))" /><stop offset="1" stopColor="rgb(var(--ivory))" /></linearGradient></defs><rect width="320" height="130" fill="url(#fg)" />
          <path d="M0 112q50-22 100-6t110-8 110 10v22H0z" fill="rgb(var(--sage))" opacity=".35" />
          <rect x="206" y="-8" width="30" height="50" rx="7" fill="rgb(var(--teal))" /><rect x="206" y="88" width="30" height="50" rx="7" fill="rgb(var(--teal))" />
          <path d="M60 70h60" stroke="rgb(var(--paper))" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 10" opacity=".9" />
          <circle cx="150" cy="66" r="15" fill="rgb(var(--navy))" /><path d="M140 66q-9-13-20-9 4 9 12 14z" fill="rgb(var(--navy))" opacity=".6" /><circle cx="155" cy="62" r="3.2" fill="rgb(var(--paper))" /><path d="M163 67l8 2-8 3z" fill="rgb(var(--gold))" />
          <circle cx="271" cy="65" r="6" fill="rgb(var(--gold))" /></svg>
        <div className="flex min-h-[104px] flex-1 items-center justify-between gap-2 p-4"><div><h3 className="font-display text-xl">Mirror Flight</h3><p className="mt-1 text-sm text-navy/70">Gentle and steady. Fly through the gaps.</p></div><span className="text-2xl text-teal" aria-hidden>→</span></div></a>
      <a href="/dash" className="mt-3 flex items-stretch overflow-hidden rounded-3xl border border-navy/10 bg-paper shadow-soft transition active:scale-[.99]">
        <svg viewBox="0 0 320 130" preserveAspectRatio="xMidYMid slice" className="block w-36 shrink-0 self-stretch" aria-hidden><defs><linearGradient id="dg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#14143f" /><stop offset=".55" stopColor="#3a2f86" /><stop offset="1" stopColor="#6b4fb8" /></linearGradient><linearGradient id="dp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8f86d6" stopOpacity=".55" /><stop offset="1" stopColor="#c9c2f2" stopOpacity=".9" /></linearGradient></defs><rect width="320" height="130" fill="url(#dg)" />
          <circle cx="252" cy="26" r="13" fill="#e9e6ff" opacity=".9" />
          <path d="M0 62l30-14 24 10 28-16 26 14 24-8 28 12 26-6 24 8 26-12 24 14 30-8v34H0z" fill="#241f66" />
          <path d="M138 44h44v6h-44zM144 50h32v16h-32zM150 38h20v6h-20z" fill="#1a1650" /><rect x="154" y="54" width="12" height="12" fill="#6b4fb8" opacity=".7" />
          <path d="M146 64h28l76 66H70z" fill="url(#dp)" />
          <path d="M160 64L116 130M160 64v66M160 64l44 66" stroke="#fff" strokeOpacity=".35" strokeWidth="1.4" />
          <rect x="196" y="92" width="26" height="6" rx="3" fill="#4a3f9c" /><rect x="198" y="98" width="22" height="9" rx="2" fill="#2a2370" />
          <circle cx="126" cy="86" r="4.5" fill="#f6c453" /><circle cx="122" cy="100" r="5.5" fill="#f6c453" /><circle cx="116" cy="116" r="6.5" fill="#f6c453" />
          <path d="M146 106q-22-4-28 10q14 2 26-6z" fill="#e8772e" /><circle cx="118" cy="114" r="4" fill="#fff" />
          <ellipse cx="160" cy="104" rx="11" ry="15" fill="#e8772e" /><ellipse cx="160" cy="108" rx="6" ry="9" fill="#f7e0c4" />
          <path d="M150 90l-2-13 9 7zM170 90l2-13-9 7z" fill="#e8772e" /><circle cx="160" cy="88" r="10" fill="#f08a3c" /><path d="M153 91q7 9 14 0q-7 3-14 0z" fill="#fff" /><circle cx="156" cy="86" r="1.6" fill="#1a1650" /><circle cx="164" cy="86" r="1.6" fill="#1a1650" /><circle cx="160" cy="91" r="1.7" fill="#1a1650" />
          <path d="M152 118l-5 8M168 118l5 8" stroke="#c4561c" strokeWidth="4" strokeLinecap="round" /></svg>
        <div className="flex min-h-[104px] flex-1 items-center justify-between gap-2 p-4"><div><h3 className="font-display text-xl">Mirror Dash</h3><p className="mt-1 text-sm text-navy/70">Fast and challenging. Run, jump, duck and fly.</p></div><span className="text-2xl text-teal" aria-hidden>→</span></div></a>
      <a href="/slice" className="mt-3 flex items-stretch overflow-hidden rounded-3xl border border-navy/10 bg-paper shadow-soft transition active:scale-[.99]">
        <svg viewBox="0 0 320 130" preserveAspectRatio="xMidYMid slice" className="block w-36 shrink-0 self-stretch" aria-hidden><defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#14194a" /><stop offset=".6" stopColor="#3a2a6e" /><stop offset="1" stopColor="#8a3f6e" /></linearGradient></defs><rect width="320" height="130" fill="url(#sg)" />
          <path d="M20 70h280" stroke="#ff9db4" strokeWidth="9" strokeLinecap="round" opacity=".75" /><path d="M20 67h280" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".5" />
          <g><path d="M70 38a26 26 0 0 1 52 0z" fill="#fff1c9" stroke="#d93a42" strokeWidth="5" /><path d="M70 92a26 26 0 0 0 52 0z" fill="#fff1c9" stroke="#d93a42" strokeWidth="5" /></g>
          <g><path d="M186 40a24 24 0 0 1 48 0z" fill="#ffc566" stroke="#ff9a1f" strokeWidth="5" /><path d="M186 94a24 24 0 0 0 48 0z" fill="#ffc566" stroke="#ff9a1f" strokeWidth="5" /></g>
          <circle cx="270" cy="30" r="14" fill="#7048e8" /><circle cx="266" cy="25" r="4" fill="#fff" opacity=".4" /><circle cx="46" cy="104" r="9" fill="#ff5a6e" opacity=".9" /><circle cx="150" cy="22" r="3" fill="#fff" opacity=".7" /><circle cx="250" cy="100" r="3" fill="#fff" opacity=".7" /></svg>
        <div className="flex min-h-[104px] flex-1 items-center justify-between gap-2 p-4"><div><h3 className="font-display text-xl">Mirror Slice</h3><p className="mt-1 text-sm text-navy/70">Tongue exercise. Slice flying fruit with swipes and pokes.</p></div><span className="text-2xl text-teal" aria-hidden>→</span></div></a>
      <a href="/calibrate" className="btn-quiet mt-5 inline-flex min-h-[52px] w-full items-center justify-center">{any ? "Recalibrate" : "Calibrate"}</a>
      <button className="mt-6 block w-full text-center text-sm text-navy/60 underline" onClick={logout}>Log out</button>
    </main>);
}

export default function Dashboard() { return PATIENT_TEST_MODE ? <TestHome /> : <FullDashboard />; }
