"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { supabase } from "@/lib/supabase/client";
import { AGE, US_STATES, TYPES, SIDES, SURGERY, GOALS, POLICY_VERSION } from "@/lib/onboarding";

type A = { age: string; state: string; type: string; side: string; surgery: string; surgeryDate: string; notes: string; goals: string[] };
const TITLES = ["How old are you?", "Where do you live?", "What type of facial palsy do you have?", "Which side is affected?", "What surgical treatment have you received?", "What would you like to work toward?"];

function Choice({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return <button type="button" role="radio" aria-checked={on} onClick={onClick}
    className={`min-h-[56px] rounded-2xl border px-4 text-left transition ${on ? "border-teal bg-teal/10 shadow-soft" : "border-navy/15 bg-paper"}`}>{label}</button>;
}

export default function Onboarding() {
  const router = useRouter();
  const [i, setI] = useState(0); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [a, setA] = useState<A>({ age: "", state: "", type: "", side: "", surgery: "", surgeryDate: "", notes: "", goals: [] });
  const set = <K extends keyof A>(k: K, v: A[K]) => setA(p => ({ ...p, [k]: v }));
  const [under18, setUnder18] = useState(false);

  const ready = [a.age, a.state, a.type, a.side, a.surgery, a.goals.length ? "y" : ""][i];

  async function finish() {
    setBusy(true); setErr(null);
    const sb = supabase();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { router.push("/"); return; }
    const uid = user.id;
    const steps = [
      sb.from("profiles").upsert({ id: uid, age_band: a.age, state_of_residence: a.state, onboarding_completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    ];
    const first = await steps[0];
    if (first.error) { setErr(first.error.message); setBusy(false); return; }
    const results = await Promise.all([
      sb.from("palsy_conditions").upsert({ user_id: uid, palsy_type: a.type, affected_side: a.side, updated_at: new Date().toISOString() }, { onConflict: "user_id" }),
      sb.from("surgical_history").delete().eq("user_id", uid).then(() =>
        sb.from("surgical_history").insert({ user_id: uid, procedure: a.surgery, surgery_date: a.surgeryDate || null, notes: a.notes || null })),
      sb.from("rehab_goals").delete().eq("user_id", uid).then(() =>
        sb.from("rehab_goals").insert(a.goals.map(goal => ({ user_id: uid, goal })))),
      sb.from("consent_records").insert([{ user_id: uid, kind: "terms", granted: true, policy_version: POLICY_VERSION }, { user_id: uid, kind: "privacy", granted: true, policy_version: POLICY_VERSION }]),
    ]);
    const bad = results.find(r => r.error);
    if (bad?.error) { setErr(bad.error.message); setBusy(false); return; }
    router.push("/dashboard");
  }

  if (under18) return (
    <main className="mx-auto max-w-md px-6 pt-24">
      <h1 className="font-display text-3xl">A pathway for younger patients is on the way.</h1>
      <p className="mt-4 text-navy/70">SmileQuest is currently available for adults (18+). Please check with your care team about exercises that suit you now.</p>
      <button className="btn-quiet mt-8" onClick={() => { setUnder18(false); }}>Back</button>
    </main>
  );

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]">
      <div className="flex gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={6} aria-valuenow={i + 1} aria-label={`Question ${i + 1} of 6`}>
        {TITLES.map((_, n) => <div key={n} className={`h-1.5 flex-1 rounded-full ${n <= i ? "bg-teal" : "bg-mist"}`} />)}
      </div>
      <AnimatePresence mode="wait">
        <motion.section key={i} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: .25 }} className="mt-10 flex-1">
          <h1 className="font-display text-3xl leading-tight">{TITLES[i]}</h1>
          <div className="mt-6 grid gap-3" role="radiogroup" aria-label={TITLES[i]}>
            {i === 0 && <>
              {AGE.map(v => <Choice key={v} label={v} on={a.age === v} onClick={() => set("age", v)} />)}
              <button type="button" onClick={() => setUnder18(true)} className="min-h-[56px] rounded-2xl border border-dashed border-navy/20 px-4 text-left text-navy/50">Under 18 (not yet available)</button>
            </>}
            {i === 1 && <select aria-label="State of residence" className="field" value={a.state} onChange={e => set("state", e.target.value)}>
              <option value="">Select your state</option>{US_STATES.map(s => <option key={s}>{s}</option>)}</select>}
            {i === 2 && TYPES.map(([k, l]) => <Choice key={k} label={l} on={a.type === k} onClick={() => set("type", k)} />)}
            {i === 3 && SIDES.map(([k, l]) => <Choice key={k} label={l} on={a.side === k} onClick={() => set("side", k)} />)}
            {i === 4 && <>
              {SURGERY.map(([k, l]) => <Choice key={k} label={l} on={a.surgery === k} onClick={() => set("surgery", k)} />)}
              {a.surgery && a.surgery !== "none" && a.surgery !== "unsure" && <div className="grid gap-3 rounded-2xl bg-lav/30 p-4">
                <label className="text-sm">Approximate surgery date (optional)
                  <input type="date" className="field mt-1" value={a.surgeryDate} onChange={e => set("surgeryDate", e.target.value)} /></label>
                {a.surgery === "other_multiple" && <label className="text-sm">List your procedures (optional)
                  <textarea className="field mt-1 py-3" rows={3} value={a.notes} onChange={e => set("notes", e.target.value)} /></label>}
              </div>}
            </>}
            {i === 5 && GOALS.map(g => <button key={g} type="button" role="checkbox" aria-checked={a.goals.includes(g)}
              onClick={() => set("goals", a.goals.includes(g) ? a.goals.filter(x => x !== g) : [...a.goals, g])}
              className={`min-h-[56px] rounded-2xl border px-4 text-left transition ${a.goals.includes(g) ? "border-teal bg-teal/10 shadow-soft" : "border-navy/15 bg-paper"}`}>{g}</button>)}
          </div>
        </motion.section>
      </AnimatePresence>
      {err && <p role="alert" className="mb-3 text-sm">{err}</p>}
      <div className="mt-6 flex gap-3">
        {i > 0 && <button className="btn-quiet" onClick={() => setI(i - 1)}>Back</button>}
        <button className="btn-primary flex-1" disabled={!ready || busy} onClick={() => (i < 5 ? setI(i + 1) : finish())}>{i < 5 ? "Continue" : "Save and continue"}</button>
      </div>
    </main>
  );
}
