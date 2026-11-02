"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { createTracker, type Frame } from "@/lib/tracking";
import { POLICY_VERSION } from "@/lib/onboarding";

type Move = { threshold: number; range: number; detectable: boolean; nm: number };
const KEYS = ["smile", "brow", "pucker", "close"] as const;
type K = typeof KEYS[number];
const NAMES: Record<K, string> = { smile: "Smile", brow: "Eyebrows", pucker: "Lip pucker", close: "Eye closure" };
const PALETTES: Record<string, string[]> = { Garden: ["#e8a0b4", "#a9c8a0", "#f3d58a", "#b7a7dc"], Coast: ["#7fb7c4", "#a9d3d8", "#f2e2b8", "#e9a98f"], Dusk: ["#c8a6d9", "#8fa6d6", "#f3c09a", "#e7d3f0"] };
const W = 450, H = 600, TAU = Math.PI * 2;
const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(",");
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const fr_ = (x: number) => x - Math.floor(x);

function dab(c: CanvasRenderingContext2D, x: number, y: number, r: number, col: string, a: number, soft: number) {
  const g = c.createRadialGradient(x, y, r * (1 - soft) * 0.6, x, y, r);
  g.addColorStop(0, `rgba(${rgb(col)},${a})`); g.addColorStop(1, `rgba(${rgb(col)},0)`);
  c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
}
function drawScene(c: CanvasRenderingContext2D) {
  const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#bcd8e6"); g.addColorStop(.55, "#f6e9d0"); g.addColorStop(1, "#cfe0c0");
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.fillStyle = "#f8d98a"; c.beginPath(); c.arc(W * .76, H * .17, W * .1, 0, TAU); c.fill();
  [["#a9c7a0", .5, .62], ["#8fb58c", .8, .7], ["#6f9f7a", .3, .8]].forEach(([col, x, y]) => { c.fillStyle = col as string; c.beginPath(); c.ellipse(W * (x as number), H * (y as number), W * .6, H * .16, 0, 0, TAU); c.fill(); });
  const cols = ["#e8a0b4", "#f3d58a", "#b7a7dc", "#f2b8a0"];
  for (let i = 0; i < 34; i++) {
    const x = fr_(i * .137 + .05) * W, y = H * (.58 + fr_(i * .311) * .38), s = 9 + fr_(i * .53) * 9;
    c.strokeStyle = "#5f8a6e"; c.lineWidth = 3; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + H * .07); c.stroke();
    c.fillStyle = cols[i % 4]; for (let k = 0; k < 6; k++) { c.beginPath(); c.arc(x + Math.cos(k * TAU / 6) * s, y + Math.sin(k * TAU / 6) * s, s * .7, 0, TAU); c.fill(); }
    c.fillStyle = "#fff4c8"; c.beginPath(); c.arc(x, y, s * .5, 0, TAU); c.fill();
  }
}
type Pot = { w: number; h: number; rim: number; spin: number };
function drawPot(c: CanvasRenderingContext2D, p: Pot, glaze: number) {
  const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#f8f1e4"); g.addColorStop(1, "#e6dcc8"); c.fillStyle = g; c.fillRect(0, 0, W, H);
  const cx = W / 2, wy = H * .82;
  c.fillStyle = "#b9b2a4"; c.beginPath(); c.ellipse(cx, wy + 18, W * .34, 26, 0, 0, TAU); c.fill();
  c.fillStyle = "#d8d1c3"; c.beginPath(); c.ellipse(cx, wy, W * .34, 26, 0, 0, TAU); c.fill();
  for (let i = 0; i < 10; i++) { const a = p.spin + i * TAU / 10; if (Math.sin(a) > 0) { c.fillStyle = "#a39b8b"; c.beginPath(); c.arc(cx + Math.cos(a) * W * .31, wy + Math.sin(a) * 23, 3, 0, TAU); c.fill(); } }
  const vh = H * (.22 + .4 * p.h), base = W * (.12 + .2 * p.w), rimMul = .85 + .5 * p.rim;
  const r = (t: number) => base * (.62 + .38 * Math.sin(Math.PI * (t * .85 + .08))) * (1 + (rimMul - 1) * clamp((t - .7) / .3, 0, 1));
  const y = (t: number) => wy - t * vh, N = 40;
  c.fillStyle = "rgba(0,0,0,.12)"; c.beginPath(); c.ellipse(cx, wy + 6, base * .8, 10, 0, 0, TAU); c.fill();
  const gr = c.createLinearGradient(cx - base, 0, cx + base, 0);
  gr.addColorStop(0, "#b9795a"); gr.addColorStop(.35, "#d9a07c"); gr.addColorStop(.7, "#c98a67"); gr.addColorStop(1, "#9c5f45");
  c.fillStyle = gr; c.beginPath();
  for (let i = 0; i <= N; i++) { const t = i / N; i ? c.lineTo(cx - r(t), y(t)) : c.moveTo(cx - r(t), y(t)); }
  for (let i = N; i >= 0; i--) { const t = i / N; c.lineTo(cx + r(t), y(t)); }
  c.closePath(); c.fill();
  const line = (sx: number, col: string, w: number) => { c.strokeStyle = col; c.lineWidth = w; c.beginPath(); for (let i = 0; i <= N; i++) { const t = i / N; i ? c.lineTo(cx + sx * r(t), y(t)) : c.moveTo(cx + sx * r(t), y(t)); } c.stroke(); };
  for (let j = 0; j < 6; j++) { const ph = (p.spin * .15 + j / 6) * TAU, co = Math.cos(ph); if (co > 0) line(Math.sin(ph), `rgba(255,255,255,${.08 * co})`, 2); }
  line(-.45, `rgba(255,255,255,${.08 + .3 * glaze})`, 7);
  c.fillStyle = "#7c4a37"; c.beginPath(); c.ellipse(cx, y(1), r(1), 11, 0, 0, TAU); c.fill();
  c.fillStyle = "#5a3526"; c.beginPath(); c.ellipse(cx, y(1) + 1, r(1) * .86, 8, 0, 0, TAU); c.fill();
}

export default function Studio() {
  const video = useRef<HTMLVideoElement>(null), cvRef = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null), tracker = useRef<Awaited<ReturnType<typeof createTracker>> | null>(null);
  const latest = useRef<Frame | null>(null), paused = useRef(false), adjust = useRef(false);
  const art = useRef<{ undo: () => void; reset: () => void; url: () => string } | null>(null);
  const levs = useRef<Record<K, number>>({ smile: 0, brow: 0, pucker: 0, close: 0 }), sides = useRef({ L: 0, R: 0 });
  const [phase, setPhase] = useState<"loading" | "nocal" | "pick" | "play">("loading");
  const [cal, setCal] = useState<Partial<Record<K, Move>>>({}), [neutral, setNeutral] = useState<Record<string, { mean: number }>>({});
  const [mode, setMode] = useState<"reveal" | "pottery">("reveal"), [palette, setPalette] = useState("Garden");
  const [gain, setGain] = useState(1.3), [dir, setDir] = useState(1), [showSides, setShowSides] = useState(false), [preview, setPreview] = useState(true);
  const [msg, setMsg] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [ui, setUi] = useState({ lev: { smile: 0, brow: 0, pucker: 0, close: 0 } as Record<K, number>, adjust: false, paused: false, L: 0, R: 0 });
  const S = useRef({ mode, palette, gain, dir, cal, neutral }); S.current = { mode, palette, gain, dir, cal, neutral };

  useEffect(() => { (async () => {
    const { data: { user } } = await supabase().auth.getUser();
    if (!user) { setMsg("Please log in on the home page first."); setPhase("nocal"); return; }
    const { data } = await supabase().from("calibration_profiles").select("summary").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const m: Partial<Record<K, Move>> = {};
    for (const k of KEYS) { const v = data?.summary?.moves?.[k]; if (v?.detectable) m[k] = { ...v, nm: v.threshold - 0.5 * v.range }; }
    if (!Object.keys(m).length) { setPhase("nocal"); return; }
    setCal(m); setNeutral(data?.summary?.neutral ?? {}); setPhase("pick");
  })(); return () => stop(); }, []);

  function stop() { tracker.current?.stop(); tracker.current = null; stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; latest.current = null; }
  async function begin() {
    setBusy(true); setMsg(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      stream.current = s; s.getVideoTracks()[0].onended = () => { adjust.current = true; };
      const v = video.current!; v.srcObject = s; await v.play();
      tracker.current = await createTracker(v, f => { latest.current = f; });
      const sb = supabase(); const { data: { user } } = await sb.auth.getUser();
      if (user) await sb.from("consent_records").insert({ user_id: user.id, kind: "camera_processing", granted: true, policy_version: POLICY_VERSION });
      paused.current = false; setPhase("play");
    } catch (e: any) { stop(); setMsg(e?.name === "NotAllowedError" ? "Camera access is blocked. Allow it in your browser’s site settings, then try again." : `Couldn’t start the camera: ${e?.message ?? e}`); }
    setBusy(false);
  }

  useEffect(() => {
    if (phase !== "play") return;
    const mk = () => { const c = document.createElement("canvas"); c.width = W; c.height = H; return c; };
    const ctxOf = (c: HTMLCanvasElement) => c.getContext("2d", { willReadFrequently: true })!;
    const Sc = mk(), M = mk(), P = mk(), T = mk(), A = mk(), sc = ctxOf(Sc), mc = ctxOf(M), pc = ctxOf(P), tc = ctxOf(T), ac = ctxOf(A);
    drawScene(sc);
    const cv = cvRef.current!, ctx = cv.getContext("2d")!; cv.width = W; cv.height = H;
    const snaps: { m: ImageData; p: ImageData }[] = [], potSnaps: Pot[] = [];
    const pot: Pot = { w: .5, h: .5, rim: .3, spin: 0 }; let glaze = 0, dirty = true, lastSnap = 0, dotT = 0;
    const br = { x: .5, y: .8, ph: 0 }, lev: Record<K, number> = { smile: 0, brow: 0, pucker: 0, close: 0 };
    art.current = {
      undo() { if (S.current.mode === "pottery") { const p = potSnaps.pop(); if (p) Object.assign(pot, p); } else { const s = snaps.pop(); if (s) { mc.putImageData(s.m, 0, 0); pc.putImageData(s.p, 0, 0); dirty = true; } } },
      reset() { mc.clearRect(0, 0, W, H); pc.clearRect(0, 0, W, H); snaps.length = 0; potSnaps.length = 0; Object.assign(pot, { w: .5, h: .5, rim: .3 }); dirty = true; },
      url() { return (S.current.mode === "pottery" ? cv : A).toDataURL("image/jpeg", .85); },
    };
    const snap = () => { snaps.push({ m: mc.getImageData(0, 0, W, H), p: pc.getImageData(0, 0, W, H) }); if (snaps.length > 8) snaps.shift(); };
    let raf = 0, prev = performance.now(), lost: number | null = null;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop); const dt = Math.min(.1, (now - prev) / 1000); prev = now;
      const s = S.current, f = latest.current, ok = !!(f?.vals && f.q.face && f.q.size);
      if (!ok) { if (lost == null) lost = now; adjust.current = now - lost > 600; } else { lost = null; adjust.current = false; }
      if (ok && !paused.current) {
        for (const k of KEYS) { const m = s.cal[k]; let l = m ? clamp(s.gain * (f!.vals![k] - m.nm) / m.range, 0, 1) : 0; if (l < .1) l = 0; lev[k] += (l - lev[k]) * .25; }
        levs.current = { ...lev };
        const nl = s.neutral.liftL?.mean, nr = s.neutral.liftR?.mean, sr = s.cal.smile?.range;
        if (nl != null && nr != null && sr) sides.current = { L: clamp((f!.vals!.liftL - nl) / sr, 0, 1), R: clamp((f!.vals!.liftR - nr) / sr, 0, 1) };
        if (s.mode === "reveal") {
          const pal = PALETTES[s.palette], avail = KEYS.filter(k => s.cal[k]);
          const flowKey: K | undefined = s.cal.smile ? "smile" : avail[0], flow = flowKey ? lev[flowKey] : 0;
          br.ph += dt * .32; br.x = .5 + .42 * Math.sin(br.ph);
          const ty = s.cal.brow ? .88 - .74 * lev.brow : .5 + .35 * Math.sin(br.ph * .37); br.y += (ty - br.y) * .12;
          const px = br.x * W, py = br.y * H, soft = .35 + .65 * lev.close;
          if (flow > .08) {
            if (now - lastSnap > 4000) { snap(); lastSnap = now; }
            const r = 16 + flow * 38, a = (.05 + .2 * flow) * Math.min(2, dt * 60);
            dab(mc, px, py, r, "#ffffff", a * 1.6, soft); dab(pc, px, py, r, pal[Math.floor(br.ph * .9) % pal.length], a * .9, soft); dirty = true;
          }
          if (s.cal.pucker && lev.pucker > .35) { dotT += dt; if (dotT > .14) { dotT = 0; if (now - lastSnap > 4000) { snap(); lastSnap = now; }
            const col = pal[(Math.floor(br.ph * 2) + 2) % pal.length];
            for (let i = 0; i < 5; i++) { const an = i * TAU / 5 + br.ph; dab(pc, px + Math.cos(an) * 7, py + Math.sin(an) * 7, 6, col, .55, .2); dab(mc, px + Math.cos(an) * 7, py + Math.sin(an) * 7, 8, "#ffffff", .9, .3); }
            dab(pc, px, py, 3 + lev.pucker * 3, "#f3d58a", .8, .1); dirty = true; } }
        } else {
          pot.spin += dt * .5;
          if (Math.max(lev.smile, lev.brow, lev.pucker) > .12) {   // relaxed face = no change (stabilises)
            if (now - lastSnap > 4000) { potSnaps.push({ ...pot }); if (potSnaps.length > 8) potSnaps.shift(); lastSnap = now; }
            pot.w = clamp(pot.w + s.dir * .1 * dt * lev.smile, .15, 1); pot.h = clamp(pot.h + s.dir * .08 * dt * lev.brow, .2, 1); pot.rim = clamp(pot.rim + s.dir * .12 * dt * lev.pucker, 0, 1);
          }
          glaze += (lev.close - glaze) * .1;
        }
      } else if (S.current.mode === "pottery" && !paused.current) pot.spin += dt * .5;
      if (s.mode === "pottery") drawPot(ctx, pot, glaze);
      else {
        if (dirty) {
          ac.globalCompositeOperation = "source-over"; ac.fillStyle = "#fffdf8"; ac.fillRect(0, 0, W, H);
          ac.globalAlpha = .07; ac.drawImage(Sc, 0, 0); ac.globalAlpha = 1;
          tc.globalCompositeOperation = "source-over"; tc.clearRect(0, 0, W, H); tc.drawImage(Sc, 0, 0); tc.globalCompositeOperation = "destination-in"; tc.drawImage(M, 0, 0); tc.globalCompositeOperation = "source-over";
          ac.drawImage(T, 0, 0); ac.globalCompositeOperation = "multiply"; ac.drawImage(P, 0, 0); ac.globalCompositeOperation = "source-over"; dirty = false;
        }
        ctx.drawImage(A, 0, 0); ctx.strokeStyle = "rgba(27,42,58,.35)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(br.x * W, br.y * H, 10, 0, TAU); ctx.stroke();
      }
    };
    raf = requestAnimationFrame(loop);
    const id = setInterval(() => setUi({ lev: { ...levs.current }, adjust: adjust.current, paused: paused.current, L: sides.current.L, R: sides.current.R }), 120);
    return () => { cancelAnimationFrame(raf); clearInterval(id); art.current = null; };
  }, [phase, mode]);

  async function save() {
    setMsg(null); const { data: { user } } = await supabase().auth.getUser();
    if (!user || !art.current) { setMsg("Please log in to save."); return; }
    const { error } = await supabase().from("saved_artwork").insert({ user_id: user.id, mode, title: `${mode === "reveal" ? "Watercolor" : "Pottery"} · ${new Date().toLocaleDateString()}`, image_data: art.current.url() });
    setMsg(error ? `Couldn’t save: ${error.message}` : "Saved to your gallery.");
  }
  function download() { if (!art.current) return; const a = document.createElement("a"); a.href = art.current.url(); a.download = `smilequest-${mode}.jpg`; a.click(); }

  const videoEl = <video ref={video} playsInline muted aria-label="Your camera preview (mirrored)"
    className={phase === "play" && preview ? "fixed right-3 top-3 z-40 h-20 w-28 -scale-x-100 rounded-2xl object-cover shadow-soft" : "pointer-events-none fixed h-px w-px opacity-0"} />;
  const body = () => {
    if (phase === "loading") return <main className="grid min-h-dvh place-items-center text-navy/60">Loading…</main>;
    if (phase === "nocal") return (<main className="mx-auto max-w-md px-6 pt-24"><h1 className="font-display text-3xl">Let’s set up your camera first.</h1>
      <p className="mt-4 text-navy/70">{msg ?? "The studio uses your saved calibration so it fits your own comfortable movements."}</p>
      <a className="btn-primary mt-8 inline-flex w-full items-center justify-center" href="/calibrate">Go to camera setup</a></main>);
    if (phase === "pick") return (
      <main className="mx-auto max-w-md px-6 pb-12 pt-[max(2rem,env(safe-area-inset-top))]">
        <h1 className="font-display text-3xl">Living Portrait &amp; Canvas</h1>
        <p className="mt-3 text-navy/70">A calm studio where gentle movements make art. No timers, no scores, nothing to get wrong. Only use movements your clinician has approved.</p>
        <div className="mt-6 grid gap-3" role="radiogroup" aria-label="Choose a mode">
          {([["reveal", "🎨 Watercolor Reveal", "Smile paints, eyebrows move the brush, lip pucker adds petals, soft eye closure blends."], ["pottery", "🏺 Pottery & Sculpture", "Smile widens, eyebrows raise, lip pucker refines the rim. A relaxed face keeps the shape."]] as const).map(([k, t, d]) => (
            <button key={k} role="radio" aria-checked={mode === k} onClick={() => setMode(k)} className={`rounded-2xl border p-4 text-left ${mode === k ? "border-teal bg-teal/10 shadow-soft" : "border-navy/15 bg-paper"}`}><b>{t}</b><br /><span className="text-sm text-navy/70">{d}</span></button>))}</div>
        <p className="mt-4 text-sm text-navy/70">Movements ready from your calibration: {KEYS.filter(k => cal[k]).map(k => NAMES[k]).join(", ")}.</p>
        <p className="mt-2 text-xs text-navy/60">Your camera is processed on this device. Video is never uploaded or saved.</p>
        {msg && <p role="alert" className="mt-3 rounded-2xl bg-lav/40 p-3 text-sm">{msg}</p>}
        <button className="btn-primary mt-5 w-full" disabled={busy} onClick={begin}>{busy ? "Starting camera…" : "Start camera and create"}</button>
      </main>);
    return (
      <main className="mx-auto max-w-md px-4 pb-16 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="relative overflow-hidden rounded-3xl shadow-soft">
          <canvas ref={cvRef} className="block w-full" style={{ aspectRatio: `${W}/${H}` }} aria-label={mode === "reveal" ? "Watercolor canvas painted by your facial movements" : "Pottery wheel shaped by your facial movements"} />
          {(ui.adjust || ui.paused) && <div className="absolute inset-0 grid place-items-center bg-navy/55 p-6 text-center text-ivory" role="alert"><div>
            <p className="font-display text-2xl">{ui.paused ? "Paused" : "Let’s adjust your camera"}</p>
            <p className="mt-2 text-sm">{ui.paused ? "Take as long as you like." : "We can’t see your face clearly. Center it and add light. Nothing is lost."}</p>
            {ui.paused && <button className="btn-primary mt-4" onClick={() => { paused.current = false; }}>Resume</button>}</div></div>}
        </div>
        <div className="mt-3 grid gap-1.5" aria-label="Your movements right now">{KEYS.filter(k => cal[k]).map(k => (
          <div key={k} className="flex items-center gap-2 text-xs"><span className="w-20 text-navy/70">{NAMES[k]}</span>
            <div className="h-2 flex-1 rounded-full bg-mist"><div className="h-2 rounded-full bg-teal transition-[width] duration-100" style={{ width: `${ui.lev[k] * 100}%` }} /></div></div>))}
          {mode === "pottery" && Math.max(ui.lev.smile, ui.lev.brow, ui.lev.pucker) < .12 && <p className="text-xs text-navy/60">Relaxed. Your shape is staying just as it is.</p>}
        </div>
        {showSides && cal.smile && <div className="mt-3 rounded-2xl bg-lav/30 p-3 text-xs"><p className="mb-1 text-navy/60">Left and right smile movement (camera estimate, just for curiosity)</p>
          {([["Left", ui.L], ["Right", ui.R]] as const).map(([n, v]) => <div key={n} className="mt-1 flex items-center gap-2"><span className="w-10">{n}</span><div className="h-2 flex-1 rounded-full bg-mist"><div className="h-2 rounded-full bg-lav" style={{ width: `${v * 100}%` }} /></div></div>)}</div>}
        <div className="mt-4 grid grid-cols-3 gap-2">
          <button className="btn-quiet min-h-[48px] px-2" onClick={() => { paused.current = true; }}>Pause</button>
          <button className="btn-quiet min-h-[48px] px-2" onClick={() => art.current?.undo()}>Undo</button>
          <button className="btn-quiet min-h-[48px] px-2" onClick={() => art.current?.reset()}>Start over</button>
          <button className="btn-primary col-span-2 min-h-[48px] px-2" onClick={save}>Save to gallery</button>
          <button className="btn-quiet min-h-[48px] px-2" onClick={download}>Download</button></div>
        {msg && <p role="status" className="mt-3 rounded-2xl bg-lav/40 p-3 text-sm">{msg}</p>}
        <div className="mt-5 grid gap-3 rounded-3xl bg-paper p-4 text-sm shadow-soft">
          <label>Sensitivity (higher = responds to smaller movements)<input type="range" min={0.6} max={2.2} step={0.1} value={gain} onChange={e => setGain(+e.target.value)} className="mt-1 w-full accent-teal" /></label>
          {mode === "reveal" && <label>Colors<select className="field mt-1" value={palette} onChange={e => setPalette(e.target.value)}>{Object.keys(PALETTES).map(p => <option key={p}>{p}</option>)}</select></label>}
          {mode === "pottery" && <label>Shaping direction<select className="field mt-1" value={dir} onChange={e => setDir(+e.target.value)}><option value={1}>Grow (widen, raise, open)</option><option value={-1}>Soften (narrow, lower, close)</option></select></label>}
          <label className="flex items-center gap-3"><input type="checkbox" className="h-5 w-5 accent-teal" checked={showSides} onChange={e => setShowSides(e.target.checked)} />Show left/right movement</label>
          <label className="flex items-center gap-3"><input type="checkbox" className="h-5 w-5 accent-teal" checked={preview} onChange={e => setPreview(e.target.checked)} />Show camera preview</label>
        </div>
        <div className="mt-4 flex gap-2">
          <button className="btn-quiet min-h-[48px] flex-1" onClick={() => { stop(); setPhase("pick"); }}>Rest / change mode</button>
          <a className="btn-quiet inline-flex min-h-[48px] flex-1 items-center justify-center" href="/gallery" onClick={stop}>Gallery</a></div>
      </main>);
  };
  return <>{videoEl}{body()}</>;
}
