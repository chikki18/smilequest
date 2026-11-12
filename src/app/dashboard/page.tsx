"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { PATIENT_TEST_MODE } from "@/lib/config";
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
  const [ok, setOk] = useState(false);
  useEffect(() => { (async () => {
    const sb = supabase(); const { data: { user } } = await sb.auth.getUser(); if (!user) { location.href = "/"; return; }
    const { data: p } = await sb.from("profiles").select("onboarding_completed_at").maybeSingle();
    if (!p?.onboarding_completed_at) { location.href = "/onboarding"; return; }
    setOk(true);
  })(); }, []);
  async function logout() { await supabase().auth.signOut(); location.href = "/"; }
  if (!ok) return <main className="grid min-h-dvh place-items-center text-navy/60">Loading…</main>;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))] text-center">
      <svg viewBox="0 0 240 130" className="w-full rounded-3xl shadow-soft" aria-hidden><rect width="240" height="130" fill="#62c3ee" /><rect x="170" y="0" width="30" height="44" fill="#79c08c" stroke="#35604a" strokeWidth="3" /><rect x="170" y="88" width="30" height="42" fill="#79c08c" stroke="#35604a" strokeWidth="3" />
        <ellipse cx="80" cy="66" rx="26" ry="23" fill="#6bb3a8" stroke="#2b3340" strokeWidth="3" /><circle cx="90" cy="59" r="6" fill="#fff" stroke="#2b3340" strokeWidth="2" /><circle cx="92" cy="59" r="3" fill="#2b3340" /><path d="M104 66 L120 71 L104 76Z" fill="#f29e4c" stroke="#2b3340" strokeWidth="2" /><circle cx="185" cy="66" r="9" fill="#f6c945" stroke="#a67c12" strokeWidth="2" /></svg>
      <h1 className="mt-8 font-display text-3xl">Pick a game</h1>
      <a href="/flyer" className="btn-primary mt-5 inline-flex min-h-[72px] w-full items-center justify-center text-2xl">Mirror Flight</a>
      <p className="mt-1 text-sm text-navy/60">Gentle, steady. Fly through the gaps.</p>
      <a href="/dash" className="btn-primary mt-5 inline-flex min-h-[72px] w-full items-center justify-center text-2xl">Mirror Dash</a>
      <p className="mt-1 text-sm text-navy/60">Fast and challenging. Run, jump, duck and fly.</p>
      <button className="mt-8 text-sm text-navy/60 underline" onClick={logout}>Log out</button>
    </main>);
}

export default function Dashboard() { return PATIENT_TEST_MODE ? <TestHome /> : <FullDashboard />; }
