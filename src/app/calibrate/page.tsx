"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { createTracker, type Frame, type Vals } from "@/lib/tracking";
import { POLICY_VERSION } from "@/lib/onboarding";

const MOVES = [
  { k: "smile", label: "Gentle smile", hint: "Smile as comfortably as you can. Never force it.", min: 0.015, sides: ["liftL", "liftR"] },
  { k: "brow", label: "Gentle eyebrow raise", hint: "Lift your eyebrows softly.", min: 0.015, sides: ["browL", "browR"] },
  { k: "pucker", label: "Soft lip pucker", hint: "Gently round your lips, as if saying “oo”.", min: 0.08, sides: null },
  { k: "close", label: "Gentle eye closure", hint: "Close your eyes softly, as if resting. No squeezing.", min: 0.08, sides: ["closeL", "closeR"] },
] as const;
type Key = typeof MOVES[number]["k"];
type Move = { peak: number; range: number; threshold: number; detectable: boolean; sideDelta: number[] | null };
const ALL = ["smile","brow","pucker","close","liftL","liftR","browL","browR","closeL","closeR"] as (keyof Vals)[];
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };

export default function Calibrate() {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const tracker = useRef<Awaited<ReturnType<typeof createTracker>> | null>(null);
  const latest = useRef<Frame | null>(null);
  const [f, setF] = useState<Frame | null>(null);
  const [status, setStatus] = useState<"off" | "loading" | "on">("off");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const [swap, setSwap] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [neutral, setNeutral] = useState<Record<string, { mean: number; std: number }> | null>(null);
  const [moves, setMoves] = useState<Partial<Record<Key, Move>>>({});
  const holds = useRef<Record<string, number | null>>({});
  const model = useRef({ neutral, moves }); model.current = { neutral, moves };
  const [, tick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      const fr = latest.current; setF(fr);
      const { neutral: n, moves: m } = model.current;
      for (const mv of MOVES) {
        const c = m[mv.k]; if (!n || !c || !c.detectable || !fr?.vals) { holds.current[mv.k] = null; continue; }
        const above = fr.vals[mv.k] >= c.threshold;
        if (above && holds.current[mv.k] == null) holds.current[mv.k] = Date.now();
        if (!above) holds.current[mv.k] = null;
      }
      tick(x => x + 1);
    }, 100);
    return () => clearInterval(id);
  }, []);
  useEffect(() => () => stop(), []);
  useEffect(() => { tracker.current?.setSwap(swap); }, [swap]);

  async function start() {
    setMsg(null); setStatus("loading");
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      stream.current = s;
      s.getVideoTracks()[0].onended = () => { stop(); setMsg("The camera was interrupted. Tap Start camera to resume."); };
      const v = video.current!; v.srcObject = s; await v.play();
      tracker.current = await createTracker(v, fr => { latest.current = fr; });
      tracker.current.setSwap(swap);
      setStatus("on");
      const sb = supabase(); const { data: { user } } = await sb.auth.getUser();
      if (user) await sb.from("consent_records").insert({ user_id: user.id, kind: "camera_processing", granted: true, policy_version: POLICY_VERSION });
    } catch (e: any) {
      stop();
      setMsg(e?.name === "NotAllowedError" ? "Camera access is blocked. Allow it in your browser’s site settings (the lock icon by the address), then try again." : `Couldn’t start camera tracking: ${e?.message ?? e}`);
    }
  }
  function stop() {
    tracker.current?.stop(); tracker.current = null;
    stream.current?.getTracks().forEach(t => t.stop()); stream.current = null;
    latest.current = null; setStatus("off");
  }

  async function grab(secs: number, label: string) {
    setBusy(label); setMsg(null);
    const s: Vals[] = []; const end = Date.now() + secs * 1000;
    await new Promise<void>(res => { const id = setInterval(() => {
      const fr = latest.current; setLeft(Math.max(0, Math.ceil((end - Date.now()) / 1000)));
      if (fr?.vals && fr.q.face && fr.q.size) s.push(fr.vals);
      if (Date.now() >= end) { clearInterval(id); res(); } }, 50); });
    setBusy(null);
    if (s.length < 25) { setMsg("Let’s adjust your camera. We couldn’t see your face clearly, so nothing was recorded. Try more light and center your face."); return null; }
    return s;
  }
  async function doNeutral() {
    const s = await grab(3, "neutral"); if (!s) return;
    const n: Record<string, { mean: number; std: number }> = {};
    for (const k of ALL) { const a = s.map(x => x[k]); n[k] = { mean: mean(a), std: sd(a) }; }
    setNeutral(n); setMoves({});
  }
  async function doMove(mv: typeof MOVES[number]) {
    if (!neutral) return;
    const s = await grab(4, mv.k); if (!s) return;
    const top = [...s].sort((a, b) => b[mv.k] - a[mv.k]).slice(0, Math.max(5, Math.floor(s.length / 4)));
    const peak = mean(top.map(x => x[mv.k])), nm = neutral[mv.k];
    const range = peak - nm.mean;
    const detectable = range > Math.max(3 * nm.std, mv.min);
    const sideDelta = mv.sides ? mv.sides.map(k => mean(top.map(x => x[k])) - neutral[k].mean) : null;
    setMoves(m => ({ ...m, [mv.k]: { peak, range, threshold: nm.mean + 0.5 * range, detectable, sideDelta } }));
  }
  async function save() {
    setSaving(true); setSaveMsg(null); setSaved(false);
    try {
      const sb = supabase(); const { data: { user } } = await sb.auth.getUser();
      if (!user) { setSaveMsg("You’re not logged in, so there’s nowhere to save. Go to the home page, log in, then come back to /calibrate."); setSaving(false); return; }
      const { error } = await sb.from("calibration_profiles").insert({ user_id: user.id, summary: { version: 1, neutral, moves, swapLR: swap,
        note: "Camera-derived estimates in face-size-normalised units; not clinical measurements." } });
      if (error) setSaveMsg(`Couldn’t save: ${error.message}`);
      else { setSaved(true); stop(); }
    } catch (e: any) { setSaveMsg(`Couldn’t save: ${e?.message ?? e}`); }
    setSaving(false);
  }

  const q = f?.q; const ok = !!(q?.face && q.size && q.light);
  const Badge = ({ good, text }: { good: boolean; text: string }) =>
    <span className={`rounded-full px-3 py-1 text-xs ${good ? "bg-sage/40" : "bg-gold/30"}`}>{text}</span>;

  if (saved) return (
    <main className="mx-auto max-w-md px-6 pt-24">
      <h1 className="font-display text-3xl">Calibration saved.</h1>
      <p className="mt-4 text-navy/70">Your personal movement targets are saved to your account. No images were stored, and the camera is now off.</p>
      <a href="/dashboard" className="btn-primary mt-8 inline-flex w-full items-center justify-center">Back to dashboard</a>
      <button className="btn-quiet mt-3 w-full" onClick={() => { setSaved(false); }}>Recalibrate</button>
    </main>
  );

  return (
    <main className="mx-auto max-w-md px-6 pb-16 pt-[max(2rem,env(safe-area-inset-top))]">
      <h1 className="font-display text-3xl">Camera setup</h1>
      <p className="mt-2 text-sm text-navy/70">Your camera is processed on this device. Video is never uploaded or saved. Move only as comfortably as feels right, and stop any time.</p>

      <div className="relative mt-5 aspect-[4/3] overflow-hidden rounded-3xl bg-navy/90 shadow-soft">
        <video ref={video} playsInline muted className="h-full w-full -scale-x-100 object-cover" aria-label="Your camera preview (mirrored)" />
        {status === "on" && !ok && <div className="absolute inset-x-3 bottom-3 rounded-2xl bg-paper/95 p-3 text-sm" role="status">Let’s adjust your camera: {!q?.face ? "we can’t see your face yet." : !q.size ? "move closer or center your face." : "try a brighter, even light."}</div>}
        {status !== "on" && <div className="absolute inset-0 grid place-items-center p-6 text-center text-ivory/80">{status === "loading" ? "Starting camera…" : "Camera is off"}</div>}
      </div>

      <div className="mt-3 flex flex-wrap gap-2" aria-live="polite">
        <Badge good={!!q?.face} text={q?.face ? "Face visible" : "No face"} />
        <Badge good={!!q?.size} text="Distance" /><Badge good={!!q?.light} text="Lighting" />
        <span className="rounded-full bg-mist px-3 py-1 text-xs">{q?.fps ?? 0} fps</span>
      </div>

      <div className="mt-4 grid gap-3">
        {status === "off" ? <button className="btn-primary" onClick={start}>Start camera</button>
          : <button className="btn-quiet" onClick={stop}>Stop camera</button>}
        <label className="flex items-center gap-3 text-sm text-navy/70"><input type="checkbox" className="h-5 w-5 accent-teal" checked={swap} onChange={e => setSwap(e.target.checked)} />Swap left/right for eye closure (use if closing your LEFT eye lights the Right bar)</label>
        {msg && <p role="alert" className="rounded-2xl bg-lav/40 p-3 text-sm">{msg}</p>}
      </div>

      {status === "on" && <section className="mt-8">
        <h2 className="font-display text-xl">1. Relaxed face</h2>
        <p className="mt-1 text-sm text-navy/70">Look at the camera comfortably with a relaxed face for 3 seconds.</p>
        <button className="btn-primary mt-3 w-full" disabled={!!busy || !ok} onClick={doNeutral}>{busy === "neutral" ? `Hold still… ${left}` : neutral ? "Redo relaxed face ✓" : "Record relaxed face"}</button>

        {neutral && <>
          <h2 className="mt-8 font-display text-xl">2. Your comfortable movements</h2>
          <p className="mt-1 text-sm text-navy/70">Calibrate only the movements your clinician has approved. (Plan-based filtering arrives in Milestone 3.) Skip any you don’t want to do.</p>
          <div className="mt-3 grid gap-3">{MOVES.map(mv => { const c = moves[mv.k]; return (
            <div key={mv.k} className="rounded-3xl bg-paper p-4 shadow-soft">
              <div className="font-medium">{mv.label}</div><p className="text-sm text-navy/60">{mv.hint}</p>
              <button className="btn-quiet mt-3 w-full" disabled={!!busy || !ok} onClick={() => doMove(mv)}>{busy === mv.k ? `Move gently… ${left}` : c ? "Redo" : "Record 4 seconds"}</button>
              {c && !c.detectable && <p className="mt-2 text-sm">We couldn’t detect a reliable change for this one. That’s okay. Your clinician can suggest an alternative.</p>}
              {c?.detectable && neutral && f?.vals && <div className="mt-3">
                <div className="relative h-3 rounded-full bg-mist"><div className="h-3 rounded-full bg-teal transition-[width]" style={{ width: `${Math.min(100, Math.max(0, (f.vals[mv.k] - neutral[mv.k].mean) / c.range * 100))}%` }} /><div className="absolute top-[-3px] h-[18px] w-0.5 bg-navy/60" style={{ left: "50%" }} /></div>
                <div className="mt-1 flex justify-between text-xs text-navy/60"><span>rest</span><span>your target (|)</span><span>your comfortable max</span></div>
                <div className="mt-1 text-sm">{holds.current[mv.k] ? `Holding: ${((Date.now() - holds.current[mv.k]!) / 1000).toFixed(1)} s` : "Resting"}</div>
                {c.sideDelta && <div className="mt-1 text-xs text-navy/60">Left {c.sideDelta[0].toFixed(3)} · Right {c.sideDelta[1].toFixed(3)} (camera-derived estimates, unvalidated)</div>}
              </div>}
            </div>); })}</div>
          {!Object.values(moves).some(m => m?.detectable) && <p className="mt-6 text-sm text-navy/70">Record at least one movement above (with a clear change) to unlock saving.</p>}
          <button className="btn-primary mt-4 w-full" disabled={saving || saved || !Object.values(moves).some(m => m?.detectable)} onClick={save}>{saving ? "Saving…" : saved ? "Saved ✓" : "Save calibration"}</button>
          {saveMsg && <p role="alert" className="mt-3 rounded-2xl bg-lav/40 p-3 text-sm">{saveMsg}</p>}
        </>}
      </section>}
    </main>
  );
}
