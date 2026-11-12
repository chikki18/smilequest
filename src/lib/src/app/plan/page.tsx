"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { GOALS } from "@/lib/onboarding";
import { MOVEMENTS, loadPlan, type Plan } from "@/lib/workflow";

type Form = {
  goals: string[]; moves: string[]; avoid: string; restrictions: string; notes: string;
  cname: string; crole: string; cinstr: string; attest: boolean;
  freq: number; mins: number; reps: number; hold: number; rest: number; start: string;
};
const blank = (): Form => ({ goals: [], moves: [], avoid: "", restrictions: "", notes: "", cname: "", crole: "", cinstr: "", attest: false, freq: 3, mins: 10, reps: 8, hold: 3, rest: 30, start: new Date().toISOString().slice(0, 10) });
const opts = (list: number[], v: number) => Array.from(new Set([...list, v])).sort((a, b) => a - b);
const FIELD_LABELS: Record<string, string> = { goals: "goals", authorized_movements: "approved movements", avoid_text: "movements to avoid", restrictions: "restrictions", notes: "notes", clinician_name: "clinician name", clinician_role: "clinician role", clinician_instructions: "clinician instructions", sessions_per_week: "sessions per week", session_minutes: "session length", repetitions: "repetitions", hold_seconds: "hold length", rest_seconds: "rest length", start_date: "start date", patient_attested_at: "your confirmation" };
type Rev = { version: number; created_at: string; snapshot: Record<string, unknown> };

export default function PlanPage() {
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [source, setSource] = useState<"self" | "clinician" | null>(null);
  const [f, setF] = useState<Form>(blank());
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState<string | null>(null), [saved, setSaved] = useState(false);
  const [revs, setRevs] = useState<Rev[]>([]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF(p => ({ ...p, [k]: v }));
  const toggle = (k: "goals" | "moves", v: string) => setF(p => ({ ...p, [k]: p[k].includes(v) ? p[k].filter(x => x !== v) : [...p[k], v] }));

  useEffect(() => { (async () => {
    const sb = supabase(); const { data: { user } } = await sb.auth.getUser();
    if (!user) { location.href = "/"; return; }
    const p = await loadPlan();
    if (p) {
      setPlan(p); setSource(p.source);
      setF({ goals: p.goals, moves: p.authorized_movements, avoid: p.avoid_text ?? "", restrictions: p.restrictions ?? "", notes: p.notes ?? "", cname: p.clinician_name ?? "", crole: p.clinician_role ?? "", cinstr: p.clinician_instructions ?? "",
        attest: !!p.patient_attested_at, freq: p.sessions_per_week ?? 3, mins: p.session_minutes ?? 10, reps: p.repetitions ?? 8, hold: p.hold_seconds ?? 3, rest: p.rest_seconds ?? 30, start: p.start_date ?? "" });
      const { data } = await sb.from("plan_revisions").select("version,created_at,snapshot").eq("plan_id", p.id).order("version", { ascending: false }).limit(10);
      setRevs((data as Rev[]) ?? []);
    } else {
      const { data } = await sb.from("rehab_goals").select("goal"); setF(x => ({ ...x, goals: (data ?? []).map((g: { goal: string }) => g.goal) }));
    }
    setLoading(false);
  })(); }, []);

  async function save() {
    if (!source) return; setBusy(true); setMsg(null); setSaved(false);
    const sb = supabase(); const { data: { user } } = await sb.auth.getUser();
    if (!user) { setMsg("Please log in again."); setBusy(false); return; }
    const sameMoves = plan && [...plan.authorized_movements].sort().join() === [...f.moves].sort().join();
    const attestedAt = !f.attest || f.moves.length === 0 ? null : (plan?.patient_attested_at && sameMoves ? plan.patient_attested_at : new Date().toISOString());
    const row = {
      source, goals: f.goals, authorized_movements: f.moves, avoid_text: f.avoid.trim() || null, restrictions: f.restrictions.trim() || null, notes: f.notes.trim() || null,
      clinician_name: source === "clinician" ? f.cname.trim() || null : null, clinician_role: source === "clinician" ? f.crole || null : null,
      clinician_instructions: source === "clinician" ? f.cinstr.trim() || null : null, patient_attested_at: attestedAt,
      sessions_per_week: f.freq, session_minutes: f.mins, repetitions: f.reps, hold_seconds: f.hold, rest_seconds: f.rest, start_date: f.start || null,
    };
    const { data, error } = plan
      ? await sb.from("rehab_plans").update(row).eq("id", plan.id).select("*").single()
      : await sb.from("rehab_plans").insert({ ...row, user_id: user.id }).select("*").single();
    if (error) { setMsg(`Couldn’t save: ${error.message}`); setBusy(false); return; }
    setPlan(data as Plan); setSaved(true); setBusy(false);
    const { data: rv } = await sb.from("plan_revisions").select("version,created_at,snapshot").eq("plan_id", (data as Plan).id).order("version", { ascending: false }).limit(10);
    setRevs((rv as Rev[]) ?? []);
  }

  const changed = (i: number) => {
    const a = revs[i], b = revs[i + 1]; if (!a) return "";
    if (!b) return "plan created";
    const keys = Object.keys(FIELD_LABELS).filter(k => JSON.stringify(a.snapshot[k]) !== JSON.stringify(b.snapshot[k]));
    return keys.length ? `changed ${keys.map(k => FIELD_LABELS[k]).join(", ")}` : "saved";
  };

  if (loading) return <main className="grid min-h-dvh place-items-center text-navy/60">Loading…</main>;

  if (!source) return (
    <main className="mx-auto max-w-md px-6 pb-12 pt-[max(2rem,env(safe-area-inset-top))]">
      <h1 className="font-display text-3xl">Your rehabilitation plan</h1>
      <p className="mt-3 text-navy/70">The plan decides which movements the games can use. SmileQuest never picks exercises for you from your diagnosis or surgery.</p>
      <div className="mt-6 grid gap-3">
        <button className="rounded-3xl border border-navy/15 bg-paper p-5 text-left shadow-soft" onClick={() => setSource("self")}><b>Create my own plan</b><br /><span className="text-sm text-navy/70">Choose the movements and routine you want to work on.</span></button>
        <button className="rounded-3xl border border-navy/15 bg-paper p-5 text-left shadow-soft" onClick={() => setSource("clinician")}><b>Follow my clinician’s plan</b><br /><span className="text-sm text-navy/70">Enter the instructions your surgeon or facial therapist gave you.</span></button>
      </div>
      <a href="/dashboard" className="btn-quiet mt-6 inline-flex w-full items-center justify-center">Back</a>
    </main>);

  const Num = ({ label, v, list, k, unit }: { label: string; v: number; list: number[]; k: "freq" | "mins" | "reps" | "hold" | "rest"; unit: string }) => (
    <label className="text-sm">{label}<select className="field mt-1" value={v} onChange={e => set(k, +e.target.value)}>{opts(list, v).map(n => <option key={n} value={n}>{n} {unit}</option>)}</select></label>);

  return (
    <main className="mx-auto max-w-md px-6 pb-28 pt-[max(2rem,env(safe-area-inset-top))]">
      <h1 className="font-display text-3xl">{plan ? "Edit your plan" : source === "clinician" ? "Your clinician’s plan" : "Your own plan"}</h1>
      {source === "clinician" && <p className="mt-2 rounded-2xl bg-lav/30 p-3 text-sm">You’re entering your clinician’s instructions yourself. They’re saved as <b>entered by you</b> and marked <b>not yet reviewed by a clinician in SmileQuest</b>. Every change you make is kept in the history below, so nothing is silently overwritten.</p>}

      {source === "clinician" && <section className="mt-6 grid gap-3">
        <h2 className="font-display text-xl">From your clinician</h2>
        <input className="field" placeholder="Clinician’s name (optional)" value={f.cname} onChange={e => set("cname", e.target.value)} />
        <select className="field" value={f.crole} onChange={e => set("crole", e.target.value)} aria-label="Clinician role"><option value="">Role (optional)</option><option>Surgeon</option><option>Facial rehabilitation therapist</option><option>Other clinician</option></select>
        <label className="text-sm">Their instructions, as they gave them<textarea className="field mt-1 py-3" rows={4} value={f.cinstr} onChange={e => set("cinstr", e.target.value)} /></label>
      </section>}

      <section className="mt-6"><h2 className="font-display text-xl">Movements approved for exercise</h2>
        <p className="mt-1 text-sm text-navy/70">Only these will appear in your games.</p>
        <div className="mt-3 grid gap-2">{MOVEMENTS.map(m => <button key={m.k} type="button" role="checkbox" aria-checked={f.moves.includes(m.k)} onClick={() => toggle("moves", m.k)}
          className={`min-h-[56px] rounded-2xl border px-4 text-left ${f.moves.includes(m.k) ? "border-teal bg-teal/10 shadow-soft" : "border-navy/15 bg-paper"}`}>{m.label}</button>)}</div>
        <label className="mt-3 block text-sm">Movements to avoid, if any<textarea className="field mt-1 py-3" rows={2} value={f.avoid} onChange={e => set("avoid", e.target.value)} /></label>
        <label className="mt-3 flex items-start gap-3 rounded-2xl bg-gold/20 p-4 text-sm"><input type="checkbox" className="mt-1 h-5 w-5 accent-teal" checked={f.attest} onChange={e => set("attest", e.target.checked)} />
          <span><b>I confirm my treating clinician has approved the movements I selected above for active exercise.</b> Without this, SmileQuest only offers free play, which isn’t counted as an exercise session.</span></label>
      </section>

      <section className="mt-6"><h2 className="font-display text-xl">Goals</h2>
        <div className="mt-3 grid gap-2">{GOALS.map(g => <button key={g} type="button" role="checkbox" aria-checked={f.goals.includes(g)} onClick={() => toggle("goals", g)}
          className={`min-h-[52px] rounded-2xl border px-4 text-left text-sm ${f.goals.includes(g) ? "border-teal bg-teal/10 shadow-soft" : "border-navy/15 bg-paper"}`}>{g}</button>)}</div></section>

      <section className="mt-6"><h2 className="font-display text-xl">Routine</h2>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Num label="Sessions per week" v={f.freq} list={[1, 2, 3, 4, 5, 6, 7]} k="freq" unit="" />
          <Num label="Session length" v={f.mins} list={[5, 10, 15, 20, 30]} k="mins" unit="min" />
          <Num label="Repetitions" v={f.reps} list={[3, 5, 8, 10, 15, 20]} k="reps" unit="" />
          <Num label="Hold length" v={f.hold} list={[2, 3, 5, 8, 10]} k="hold" unit="sec" />
          <Num label="Rest between" v={f.rest} list={[10, 20, 30, 60, 120]} k="rest" unit="sec" />
          <label className="text-sm">Start date<input type="date" className="field mt-1" value={f.start} onChange={e => set("start", e.target.value)} /></label></div></section>

      <section className="mt-6 grid gap-3"><h2 className="font-display text-xl">Notes</h2>
        <label className="text-sm">Surgery-specific restrictions (optional)<textarea className="field mt-1 py-3" rows={2} value={f.restrictions} onChange={e => set("restrictions", e.target.value)} /></label>
        <label className="text-sm">Other notes from you or your therapist (optional)<textarea className="field mt-1 py-3" rows={2} value={f.notes} onChange={e => set("notes", e.target.value)} /></label></section>

      <p className="mt-6 text-xs text-navy/60">SmileQuest supports exercises your clinician has approved. It doesn’t diagnose, prescribe, or increase difficulty on its own. Stop any time you feel discomfort or strain.</p>
      {msg && <p role="alert" className="mt-3 rounded-2xl bg-lav/40 p-3 text-sm">{msg}</p>}
      {saved && <p role="status" className="mt-3 rounded-2xl bg-sage/40 p-3 text-sm">Plan saved{plan?.patient_attested_at ? "." : ". Exercises stay locked until you confirm clinician approval above."}</p>}
      <button className="btn-primary mt-4 w-full" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save plan"}</button>
      <a href="/dashboard" className="btn-quiet mt-3 inline-flex w-full items-center justify-center">{saved ? "Back to dashboard" : "Cancel"}</a>

      {revs.length > 0 && <section className="mt-10"><h2 className="font-display text-xl">Change history</h2>
        <ul className="mt-3 grid gap-2 text-sm">{revs.map((r, i) => <li key={r.version} className="rounded-2xl bg-paper p-3 shadow-soft"><b>Version {r.version}</b> · {new Date(r.created_at).toLocaleString()}<br /><span className="text-navy/60">Edited by you; {changed(i)}</span></li>)}</ul></section>}
    </main>);
}
