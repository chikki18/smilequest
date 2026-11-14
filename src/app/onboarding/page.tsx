"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { POLICY_VERSION } from "@/lib/onboarding";

const APPEARANCE = [
  "I get upset when people stare at me", "I dislike how I look", "I avoid having my photo taken", "I feel unhappy about how I look", "I avoid looking at myself in the mirror",
  "I cover up or hide how I look when I go out", "I avoid sharing photos of myself (eg. Instagram or Snapchat)", "I avoid going out because of how I look (like to a party)", "I feel self-conscious about how I look", "It’s hard to meet new people because of how I look",
];
const APPEARANCE_SCALE = ["Never", "Sometimes", "Often", "Always"];
const SMILE = [
  "how well your smile expresses how you feel?", "how your smile looks in the mirror?", "how big (wide) your smile looks?", "the shape of your smile (has a nice curve)?", "how even your smile looks (same on both sides)?",
  "how straight your smile looks (not crooked or lopsided)?", "how your smile looks in photos?", "how your smile looks when your teeth show?", "how your smile looks compared with other people’s smiles?",
];
const SMILE_SCALE = ["Not at all", "A little bit", "Quite a bit", "Very much"];
const BANDS: [number, string][] = [[18, "18-24"], [25, "25-34"], [35, "35-44"], [45, "45-54"], [55, "55-64"], [65, "65+"]];
const ageOn = (dob: string) => { const d = new Date(dob + "T00:00:00"), n = new Date(); let a = n.getFullYear() - d.getFullYear(); if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--; return a; };

function Likert({ items, scale, value, onChange, lead }: { items: string[]; scale: string[]; value: (number | null)[]; onChange: (i: number, v: number) => void; lead?: string }) {
  return (
    <div className="mt-5 grid gap-3">
      {items.map((q, i) => (
        <fieldset key={q} className="rounded-2xl border border-navy/10 bg-paper p-4 shadow-soft">
          <legend className="sr-only">{lead ? `${lead} ${q}` : q}</legend>
          <p className="font-medium leading-snug">{lead && <span className="text-navy/60">{lead} </span>}{q}</p>
          <div className="mt-3 grid grid-cols-4 gap-1.5" role="radiogroup" aria-label={q}>
            {scale.map((l, v) => <button key={l} type="button" role="radio" aria-checked={value[i] === v} onClick={() => onChange(i, v)}
              className={`min-h-[52px] rounded-xl border px-1 text-[12px] leading-tight transition ${value[i] === v ? "border-teal bg-teal text-white shadow-soft" : "border-navy/15 bg-ivory text-navy/80"}`}>{l}</button>)}
          </div>
        </fieldset>))}
    </div>);
}

export default function Onboarding() {
  const router = useRouter();
  const [i, setI] = useState(0), [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null), [young, setYoung] = useState(false);
  const [first, setFirst] = useState(""), [last, setLast] = useState(""), [dob, setDob] = useState("");
  const [ap, setAp] = useState<(number | null)[]>(APPEARANCE.map(() => null)), [sm, setSm] = useState<(number | null)[]>(SMILE.map(() => null));
  const today = new Date().toISOString().slice(0, 10);
  const dobOk = !!dob && dob <= today && dob > "1900-01-01";
  const ready = [first.trim() && last.trim() && dobOk, ap.every(v => v !== null), sm.every(v => v !== null)][i];
  const done = i === 1 ? ap.filter(v => v !== null).length : i === 2 ? sm.filter(v => v !== null).length : 0;
  const TITLES = ["About you", "How you feel about your appearance", "How you feel about your smile"];

  function next() {
    if (i === 0 && ageOn(dob) < 18) { setYoung(true); return; }
    if (i < 2) { setI(i + 1); window.scrollTo(0, 0); } else finish();
  }
  async function finish() {
    setBusy(true); setErr(null);
    const sb = supabase(); const { data: { user } } = await sb.auth.getUser(); if (!user) { router.push("/"); return; }
    const age = ageOn(dob), band = [...BANDS].reverse().find(([min]) => age >= min)![1], now = new Date().toISOString();
    const p = await sb.from("profiles").upsert({ id: user.id, first_name: first.trim(), last_name: last.trim(), date_of_birth: dob, age_band: band, state_of_residence: "Not provided", onboarding_completed_at: now, updated_at: now });
    if (p.error) { setErr(p.error.message + " (Run the 0008 database step in Supabase.)"); setBusy(false); return; }
    const pack = (items: string[], vals: (number | null)[]) => items.map((q, n) => ({ q, v: vals[n] }));
    const sum = (vals: (number | null)[]) => vals.reduce<number>((a, b) => a + (b ?? 0), 0);
    const rs = await Promise.all([
      sb.from("questionnaire_responses").insert([{ user_id: user.id, instrument: "appearance_baseline", answers: pack(APPEARANCE, ap), total_score: sum(ap) }, { user_id: user.id, instrument: "smile_baseline", answers: pack(SMILE, sm), total_score: sum(sm) }]),
      sb.from("consent_records").insert([{ user_id: user.id, kind: "terms", granted: true, policy_version: POLICY_VERSION }, { user_id: user.id, kind: "privacy", granted: true, policy_version: POLICY_VERSION }]),
    ]);
    const bad = rs.find(r => r.error); if (bad?.error) { setErr(bad.error.message); setBusy(false); return; }
    router.push("/calibrate?first=1&next=/dashboard");
  }

  if (young) return (
    <main className="mx-auto max-w-md px-6 pt-24"><h1 className="font-display text-3xl">A pathway for younger patients is on the way.</h1>
      <p className="mt-4 text-navy/70">SmileQuest is currently available for adults (18+). Please check with your care team about exercises that suit you now.</p>
      <button className="btn-quiet mt-8" onClick={() => setYoung(false)}>Back</button></main>);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]">
      <div className="flex gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={3} aria-valuenow={i + 1} aria-label={`Part ${i + 1} of 3`}>{TITLES.map((_, n) => <div key={n} className={`h-1.5 flex-1 rounded-full ${n <= i ? "bg-teal" : "bg-navy/15"}`} />)}</div>
      <p className="mt-6 text-xs uppercase tracking-[.3em] text-teal">Welcome to SmileQuest</p>
      <h1 className="mt-2 font-display text-3xl leading-tight">{TITLES[i]}</h1>
      {i === 0 && <section className="mt-5 grid gap-4">
        <p className="text-navy/70">Let’s start with a few details. Your care team uses them to match your account to you.</p>
        <label className="text-sm">First name<input className="field mt-1" autoComplete="given-name" value={first} onChange={e => setFirst(e.target.value)} /></label>
        <label className="text-sm">Last name<input className="field mt-1" autoComplete="family-name" value={last} onChange={e => setLast(e.target.value)} /></label>
        <label className="text-sm">Date of birth<input type="date" className="field mt-1" autoComplete="bday" max={today} value={dob} onChange={e => setDob(e.target.value)} /></label>
      </section>}
      {i === 1 && <><p className="mt-3 text-navy/70">Think about the past few weeks. How often do these statements apply to you? There are no right or wrong answers.</p><p className="mt-2 text-xs text-navy/60">{done} of {APPEARANCE.length} answered</p>
        <Likert items={APPEARANCE} scale={APPEARANCE_SCALE} value={ap} onChange={(n, v) => setAp(a => a.map((x, k) => (k === n ? v : x)))} /></>}
      {i === 2 && <><p className="mt-3 text-navy/70">How much do you like…</p><p className="mt-2 text-xs text-navy/60">{done} of {SMILE.length} answered</p>
        <Likert items={SMILE} scale={SMILE_SCALE} value={sm} onChange={(n, v) => setSm(a => a.map((x, k) => (k === n ? v : x)))} lead="…" /></>}
      {err && <p role="alert" className="mt-4 rounded-xl bg-lav/50 p-3 text-sm">{err}</p>}
      <div className="sticky bottom-0 mt-6 flex gap-3 bg-gradient-to-t from-ivory via-ivory to-transparent pb-1 pt-4">
        {i > 0 && <button className="btn-quiet" onClick={() => { setI(i - 1); window.scrollTo(0, 0); }}>Back</button>}
        <button className="btn-primary flex-1" disabled={!ready || busy} onClick={next}>{busy ? "Saving…" : i < 2 ? "Continue" : "Finish and set up camera"}</button>
      </div>
    </main>);
}
