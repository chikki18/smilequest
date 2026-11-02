"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { createTracker, type Frame, type Vals } from "@/lib/tracking";
import { POLICY_VERSION } from "@/lib/onboarding";

type Move = { threshold: number; range: number; detectable: boolean };
const SPELLS: Record<string, { name: string; label: string; icon: string }> = {
  brow: { name: "Lumous Glow", label: "gentle eyebrow raise", icon: "🌙" },
  smile: { name: "Sunburst Spark", label: "gentle smile", icon: "☀️" },
  pucker: { name: "Wind Whisper", label: "soft lip pucker", icon: "🍃" },
  close: { name: "Soft Rain", label: "gentle eye closure", icon: "🌧️" },
};
const hex = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const mix = (a: string, b: string, t: number) => { const A = hex(a), B = hex(b); return `rgb(${A.map((x, i) => Math.round(x + (B[i] - x) * t)).join(",")})`; };
const fresh = () => ({ charge: 0, aboveSince: null as number | null, cur: 0, longest: 0, holds: 0, time: 0, lostSince: null as number | null, adjust: false, pauses: 0, manualPause: false, complete: false });

function draw(ctx: CanvasRenderingContext2D, W: number, H: number, c: number, t: number, flies: { x: number; y: number; s: number; p: number }[]) {
  const e = c * c * (3 - 2 * c), TAU = Math.PI * 2;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, mix("#0b1220", "#cfe3df", e)); g.addColorStop(1, mix("#16233a", "#f6ecd2", e));
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = mix("#101a2c", "#9fb8a0", e);
  ctx.beginPath(); ctx.ellipse(W * .25, H * .85, W * .6, H * .22, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.ellipse(W * .85, H * .88, W * .55, H * .2, 0, 0, TAU); ctx.fill();
  for (const x of [.08, .2, .8, .92]) {
    ctx.fillStyle = mix("#070c14", "#6b5a45", e); ctx.fillRect(W * x - 5, H * .5, 10, H * .3);
    ctx.fillStyle = mix("#0a111d", "#5f8a6e", e); ctx.beginPath(); ctx.arc(W * x, H * .47, W * .09, 0, TAU); ctx.fill();
  }
  ctx.fillStyle = mix("#0d1522", "#7fa37f", e); ctx.fillRect(0, H * .86, W, H * .14);
  if (e > 0.02) { ctx.globalAlpha = e; ctx.fillStyle = "#ead9a4"; ctx.beginPath();
    ctx.moveTo(W * .47, H * .7); ctx.lineTo(W * .53, H * .7); ctx.lineTo(W * .8, H); ctx.lineTo(W * .2, H); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1; }
  const lx = W / 2, ly = H * .46, r = 30 + e * W * .9;
  const rg = ctx.createRadialGradient(lx, ly, 2, lx, ly, r);
  rg.addColorStop(0, `rgba(255,226,140,${.2 + .65 * e})`); rg.addColorStop(1, "rgba(255,226,140,0)");
  ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#2a2f3a"; ctx.fillRect(lx - 3, ly, 6, H * .24);
  ctx.fillStyle = mix("#3a3f4c", "#f4d98e", e); ctx.fillRect(lx - 16, ly - 24, 32, 36);
  ctx.fillStyle = "#2a2f3a"; ctx.beginPath(); ctx.moveTo(lx - 22, ly - 24); ctx.lineTo(lx, ly - 42); ctx.lineTo(lx + 22, ly - 24); ctx.closePath(); ctx.fill();
  for (const f of flies) {
    const x = (f.x + Math.sin(t * 0.0004 * f.s + f.p) * 0.03) * W, y = (f.y + Math.cos(t * 0.0003 * f.s + f.p) * 0.03) * H;
    ctx.fillStyle = `rgba(255,236,160,${.15 + .85 * e})`; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, TAU); ctx.fill();
  }
}

export default function Play() {
  const video = useRef<HTMLVideoElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null), tracker = useRef<Awaited<ReturnType<typeof createTracker>> | null>(null);
  const latest = useRef<Frame | null>(null), g = useRef(fresh());
  const [phase, setPhase] = useState<"loading" | "nocal" | "pick" | "play" | "done">("loading");
  const [moves, setMoves] = useState<Record<string, Move>>({});
  const [sel, setSel] = useState<string>(""); const [holdSec, setHoldSec] = useState(3);
  const [msg, setMsg] = useState<string | null>(null); const [starting, setStarting] = useState(false);
  const [preview, setPreview] = useState(true);
  const [ui, setUi] = useState({ charge: 0, adjust: false, paused: false, complete: false, cur: 0 });
  const [result, setResult] = useState({ holds: 0, longest: 0, time: 0, pauses: 0 });
  const R = useRef({ moves, sel, holdSec }); R.current = { moves, sel, holdSec };

  useEffect(() => { (async () => {
    const { data: { user } } = await supabase().auth.getUser();
    if (!user) { setMsg("Please log in on the home page first."); setPhase("nocal"); return; }
    const { data } = await supabase().from("calibration_profiles").select("summary").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const m: Record<string, Move> = {};
    for (const [k, v] of Object.entries((data?.summary?.moves ?? {}) as Record<string, Move>)) if (v.detectable && SPELLS[k]) m[k] = v;
    if (!Object.keys(m).length) { setPhase("nocal"); return; }
    setMoves(m); setSel(Object.keys(m)[0]); setPhase("pick");
  })(); return () => stop(); }, []);

  function stop() {
    tracker.current?.stop(); tracker.current = null;
    stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; latest.current = null;
  }
  async function begin() {
    setStarting(true); setMsg(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      stream.current = s;
      s.getVideoTracks()[0].onended = () => { g.current.adjust = true; };
      const v = video.current!; v.srcObject = s; await v.play();
      tracker.current = await createTracker(v, fr => { latest.current = fr; });
      const sb = supabase(); const { data: { user } } = await sb.auth.getUser();
      if (user) await sb.from("consent_records").insert({ user_id: user.id, kind: "camera_processing", granted: true, policy_version: POLICY_VERSION });
      g.current = fresh(); setPhase("play");
    } catch (e: any) {
      stop();
      setMsg(e?.name === "NotAllowedError" ? "Camera access is blocked. Allow it in your browser’s site settings, then try again." : `Couldn’t start the camera: ${e?.message ?? e}`);
    }
    setStarting(false);
  }
  function finish() {
    const s = g.current; if (s.aboveSince != null && s.complete) s.holds = Math.max(s.holds, 1);
    setResult({ holds: s.holds, longest: s.longest, time: s.time, pauses: s.pauses }); stop(); setPhase("done");
  }

  useEffect(() => {
    if (phase !== "play") return;
    const cv = canvas.current!, ctx = cv.getContext("2d")!;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const flies = Array.from({ length: 16 }, () => ({ x: Math.random(), y: .2 + Math.random() * .6, s: .5 + Math.random(), p: Math.random() * 6 }));
    const resize = () => { const r = cv.getBoundingClientRect(), d = devicePixelRatio || 1; cv.width = r.width * d; cv.height = r.height * d; ctx.setTransform(d, 0, 0, d, 0, 0); };
    resize(); addEventListener("resize", resize);
    let raf = 0, prev = performance.now();
    const step = (dt: number, now: number) => {
      const s = g.current, { moves, sel, holdSec } = R.current, m = moves[sel], fr = latest.current;
      if (s.manualPause || s.complete || !m) return;
      if (!(fr?.vals && fr.q.face && fr.q.size)) {   // lost tracking: pause, never count as failure
        if (s.lostSince == null) s.lostSince = now;
        if (now - s.lostSince > 600 && !s.adjust) { s.adjust = true; s.pauses++; }
        s.aboveSince = null; return;
      }
      s.lostSince = null; s.adjust = false; s.time += dt;
      if (fr.vals[sel as keyof Vals] >= m.threshold) {
        if (s.aboveSince == null) s.aboveSince = now;
        s.cur = (now - s.aboveSince) / 1000; s.longest = Math.max(s.longest, s.cur);
        s.charge = Math.min(1, s.charge + dt / holdSec);
        if (s.charge >= 1) { s.complete = true; if (s.cur >= .5) s.holds++; }
      } else {
        if (s.aboveSince != null && now - s.aboveSince >= 500) s.holds++;
        s.aboveSince = null; s.cur = 0; s.charge = Math.max(0, s.charge - dt / holdSec * 0.3); // gentle fade, never a reset
      }
    };
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop); const dt = Math.min(0.1, (now - prev) / 1000); prev = now; step(dt, now);
      const r = cv.getBoundingClientRect(); draw(ctx, r.width, r.height, g.current.charge, reduce ? 0 : now, flies);
    };
    raf = requestAnimationFrame(loop);
    const id = setInterval(() => { const s = g.current; setUi({ charge: s.charge, adjust: s.adjust, paused: s.manualPause, complete: s.complete, cur: s.cur }); }, 100);
    return () => { cancelAnimationFrame(raf); clearInterval(id); removeEventListener("resize", resize); };
  }, [phase]);

  const sp = SPELLS[sel];
  const videoEl = <video ref={video} playsInline muted aria-label="Your camera preview (mirrored)"
    className={phase === "play" && preview ? "absolute right-3 top-24 z-20 h-24 w-32 -scale-x-100 rounded-2xl object-cover shadow-soft" : "pointer-events-none absolute h-px w-px opacity-0"} />;

  if (phase === "loading") return <main className="grid min-h-dvh place-items-center text-navy/60">Loading…</main>;
  if (phase === "nocal") return (
    <main className="mx-auto max-w-md px-6 pt-24"><h1 className="font-display text-3xl">Let’s set up your camera first.</h1>
      <p className="mt-4 text-navy/70">{msg ?? "The game needs your saved calibration so it fits your own comfortable movements."}</p>
      <a className="btn-primary mt-8 inline-flex w-full items-center justify-center" href="/calibrate">Go to camera setup</a></main>);
  if (phase === "done") return (
    <main className="mx-auto max-w-md px-6 pt-20">
      <h1 className="font-display text-3xl">The lantern is lit.</h1>
      <p className="mt-3 text-navy/70">{result.holds > 0 ? `You completed ${result.holds} comfortable ${sp.label} hold${result.holds === 1 ? "" : "s"} today.` : "You took part in today’s exercise."}</p>
      <ul className="mt-6 grid gap-2 rounded-3xl bg-paper p-5 text-sm shadow-soft">
        <li>Game: The Forgotten Lantern ({sp.name})</li><li>Time playing: {Math.round(result.time)} s</li>
        <li>Longest comfortable hold: {result.longest.toFixed(1)} s</li><li>Camera adjustments needed: {result.pauses}</li></ul>
      <p className="mt-3 text-xs text-navy/50">Camera-derived estimates of game engagement, not a clinical measure. This session isn’t saved yet; session saving comes with the next milestone.</p>
      <button className="btn-primary mt-6 w-full" onClick={() => setPhase("pick")}>Play again</button>
      <a className="btn-quiet mt-3 inline-flex w-full items-center justify-center" href="/dashboard">Back to dashboard</a></main>);
  if (phase === "pick") return (
    <main className="mx-auto max-w-md px-6 pb-12 pt-[max(2rem,env(safe-area-inset-top))]">{videoEl}
      <h1 className="font-display text-3xl">The Forgotten Lantern</h1>
      <p className="mt-3 text-navy/70">The forest has gone dark. Hold a gentle movement and the lantern will glow brighter. Rest whenever you like; the light only fades slowly. Only choose a movement your clinician has approved.</p>
      <h2 className="mt-6 font-display text-xl">Choose your spell</h2>
      <div className="mt-3 grid gap-3" role="radiogroup">{Object.keys(moves).map(k => (
        <button key={k} role="radio" aria-checked={sel === k} onClick={() => setSel(k)}
          className={`min-h-[60px] rounded-2xl border px-4 text-left ${sel === k ? "border-teal bg-teal/10 shadow-soft" : "border-navy/15 bg-paper"}`}>
          {SPELLS[k].icon} <b>{SPELLS[k].name}</b> · {SPELLS[k].label}</button>))}</div>
      <label className="mt-5 block text-sm">Hold length<select className="field mt-1" value={holdSec} onChange={e => setHoldSec(+e.target.value)}>
        {[2, 3, 5, 8].map(n => <option key={n} value={n}>{n} seconds</option>)}</select></label>
      <p className="mt-4 text-xs text-navy/60">Your camera is processed on this device. Video is never uploaded or saved.</p>
      {msg && <p role="alert" className="mt-3 rounded-2xl bg-lav/40 p-3 text-sm">{msg}</p>}
      <button className="btn-primary mt-5 w-full" disabled={starting} onClick={begin}>{starting ? "Starting camera…" : "Start camera and play"}</button>
    </main>);

  return (
    <div className="fixed inset-0 bg-navy">{videoEl}
      <canvas ref={canvas} className="h-full w-full" aria-label="Forest scene. The lantern grows brighter as you hold your movement." />
      <div className="absolute inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-10 rounded-2xl bg-paper/90 p-4 text-sm shadow-soft backdrop-blur" role="status">
        {ui.complete ? "The path appears through the trees. Thank you, apprentice. The forest is safe again."
          : <>A woodland friend whispers: “The lantern has gone dark. Could you wake it with a {sp.label}? Take your time.”</>}
      </div>
      {(ui.adjust || ui.paused) && <div className="absolute inset-0 z-30 grid place-items-center bg-navy/60 p-8 text-center text-ivory" role="alert">
        <div><p className="font-display text-2xl">{ui.paused ? "Paused" : "Let’s adjust your camera"}</p>
          <p className="mt-2 text-sm">{ui.paused ? "Take as long as you need." : "We can’t see your face clearly. Center your face and add light. Nothing is counted against you."}</p>
          {ui.paused && <button className="btn-primary mt-5" onClick={() => { g.current.manualPause = false; }}>Resume</button>}</div></div>}
      <div className="absolute inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-10 rounded-3xl bg-paper/95 p-4 shadow-soft">
        <div className="flex items-center justify-between text-sm"><span>{sp.icon} <b>{sp.name}</b></span><span className="text-navy/60">{ui.complete ? "Complete" : ui.cur > 0 ? `Holding ${ui.cur.toFixed(1)} s` : "Resting is fine"}</span></div>
        <div className="mt-2 h-3 rounded-full bg-mist" role="progressbar" aria-valuenow={Math.round(ui.charge * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Lantern charge">
          <div className="h-3 rounded-full bg-gold transition-[width] duration-100" style={{ width: `${ui.charge * 100}%` }} /></div>
        <div className="mt-3 flex flex-wrap gap-2">
          {ui.complete ? <button className="btn-primary min-h-[44px] flex-1" onClick={finish}>See summary</button> : <>
            <button className="btn-quiet min-h-[44px] flex-1" onClick={() => { g.current.manualPause = true; }}>Pause</button>
            <button className="btn-quiet min-h-[44px] flex-1" onClick={() => { stop(); setPhase("pick"); }}>Rest</button></>}
          <button className="btn-quiet min-h-[44px]" onClick={() => setPreview(p => !p)}>{preview ? "Hide camera" : "Show camera"}</button>
          <a className="btn-quiet inline-flex min-h-[44px] items-center" href="/dashboard" onClick={stop}>Exit</a>
        </div></div>
    </div>);
}
