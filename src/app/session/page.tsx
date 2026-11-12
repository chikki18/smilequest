"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { QUESTIONS, loadContext, loadPlan, exerciseReady, type Plan } from "@/lib/workflow";

export default function SessionStart() {
  const [phase, setPhase] = useState<"loading" | "noplan" | "unconfirmed" | "ask" | "rest">("loading");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [mode, setMode] = useState<"exercise" | "explore">("exercise");
  const [i, setI] = useState(0), [ans, setAns] = useState<(number | null)[]>([null, null, null, null, null]);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<string | null>(null), [sid, setSid] = useState<string | null>(null);

  useEffect(() => { (async () => {
    const { data: { user } } = await supabase().auth.getUser();
    if (!user) { location.href = "/"; return; }
    const ctx = await loadContext();
    if (ctx.session) { location.href = "/games"; return; }   // resume: never repeat the questions
    const p = await loadPlan(); setPlan(p);
    if (!p) { setPhase("noplan"); return; }
    if (exerciseReady(p)) { setMode("exercise"); setPhase("ask"); } else setPhase("unconfirmed");
  })(); }, []);

  async function submit(values: number[]) {
    setBusy(true); setMsg(null);
    const sb = supabase(); const { data: { user } } = await sb.auth.getUser();
    if (!user) { location.href = "/"; return; }
    const hi = values[1] >= 7;
    const { data: s, error: e1 } = await sb.from("sessions").insert({ user_id: user.id, plan_id: plan?.id ?? null, mode, status: "checkin", discomfort_reported: hi }).select("id").single();
    if (e1 || !s) { setMsg(`Couldn’t start the session: ${e1?.message}`); setBusy(false); return; }
    const { error: e2 } = await sb.from("checkin_responses").insert(QUESTIONS.map((q, n) => ({ session_id: s.id, user_id: user.id, question_key: q.key, value: values[n], higher_means: q.higher })));
    if (e2) { setMsg(`Couldn’t save your answers: ${e2.message}`); setBusy(false); return; }
    setSid(s.id);
    if (hi) { setPhase("rest"); setBusy(false); return; }
    const { error: e3 } = await sb.from("sessions").update({ status: "active", checkin_completed_at: new Date().toISOString() }).eq("id", s.id);
    if (e3) { setMsg(e3.message); setBusy(false); return; }
    location.href = "/games";
  }
  async function afterRest(rest: boolean) {
    setBusy(true); const sb = supabase();
    if (rest) { await sb.from("sessions").update({ status: "abandoned", ended_at: new Date().toISOString() }).eq("id", sid!); location.href = "/dashboard"; return; }
    await sb.from("sessions").update({ status: "active", checkin_completed_at: new Date().toISOString() }).eq("id", sid!); location.href = "/games";
  }
  function pick(v: number) {
    const next = [...ans]; next[i] = v; setAns(next);
    if (i < 4) setTimeout(() => setI(i + 1), 180);
  }

  if (phase === "loading") return <main className="grid min-h-dvh place-items-center text-navy/60">Loading…</main>;
  if (phase === "noplan") return (<main className="mx-auto max-w-md px-6 pt-24"><h1 className="font-display text-3xl">First, set up your plan.</h1>
    <p className="mt-4 text-navy/70">Your plan decides which movements the games can use.</p><a href="/plan" className="btn-primary mt-8 inline-flex w-full items-center justify-center">Create my plan</a></main>);
  if (phase === "unconfirmed") return (<main className="mx-auto max-w-md px-6 pt-24"><h1 className="font-display text-3xl">Exercises are locked for now.</h1>
    <p className="mt-4 text-navy/70">Your plan doesn’t yet confirm that your clinician approved specific movements. You can update your plan, or explore with free play. Free play is relaxed fun and isn’t counted as an exercise session.</p>
    <a href="/plan" className="btn-primary mt-8 inline-flex w-full items-center justify-center">Update my plan</a>
    <button className="btn-quiet mt-3 w-full" onClick={() => { setMode("explore"); setPhase("ask"); }}>Continue with free play</button></main>);
  if (phase === "rest") return (<main className="mx-auto max-w-md px-6 pt-24"><h1 className="font-display text-3xl">Rest is a good choice today.</h1>
    <p className="mt-4 text-navy/70">You mentioned noticeable tightness or discomfort. Please follow your clinician’s instructions, and stop if anything feels wrong. You can rest now or continue gently.</p>
    <button className="btn-primary mt-8 w-full" disabled={busy} onClick={() => afterRest(true)}>Rest for today</button>
    <button className="btn-quiet mt-3 w-full" disabled={busy} onClick={() => afterRest(false)}>Continue gently</button></main>);

  const q = QUESTIONS[i], v = ans[i], all = ans.every(a => a !== null);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]">
      <p className="text-sm text-navy/60">Daily check-in{mode === "explore" ? " · free play" : ""}</p>
      <div className="mt-2 flex gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={5} aria-valuenow={i + 1} aria-label={`Question ${i + 1} of 5`}>{QUESTIONS.map((_, n) => <div key={n} className={`h-1.5 flex-1 rounded-full ${n <= i ? "bg-teal" : "bg-mist"}`} />)}</div>
      <h1 className="mt-10 font-display text-3xl leading-tight">{q.text}</h1>
      <div className="mt-8 grid grid-cols-6 gap-2" role="radiogroup" aria-label={q.text}>{Array.from({ length: 11 }, (_, n) => (
        <button key={n} role="radio" aria-checked={v === n} onClick={() => pick(n)} className={`grid min-h-[56px] place-items-center rounded-2xl border text-lg ${v === n ? "border-teal bg-teal/15 shadow-soft" : "border-navy/15 bg-paper"}`}>{n}</button>))}</div>
      <div className="mt-2 flex justify-between text-xs text-navy/60"><span>0 = {q.lo}</span><span>10 = {q.hi}</span></div>
      <div className="flex-1" />
      <p className="mt-6 text-xs text-navy/50">These are simple daily check-in questions, not a validated medical questionnaire. There are no right or wrong answers.</p>
      {msg && <p role="alert" className="mt-3 rounded-2xl bg-lav/40 p-3 text-sm">{msg}</p>}
      <div className="mt-4 flex gap-3">
        {i > 0 && <button className="btn-quiet" onClick={() => setI(i - 1)}>Back</button>}
        {i < 4 ? <button className="btn-primary flex-1" disabled={v === null} onClick={() => setI(i + 1)}>Next</button>
          : <button className="btn-primary flex-1" disabled={!all || busy} onClick={() => submit(ans as number[])}>{busy ? "Saving…" : "Finish check-in"}</button>}
      </div>
    </main>);
}
