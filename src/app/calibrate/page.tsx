"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { createTracker, type Frame, type Vals } from "@/lib/tracking";

// ---------- what we measure ----------
type Id = "smile" | "brow" | "frown" | "pucker" | "right" | "left" | "close";
type SK = "smile" | "brow" | "frown" | "pucker" | "close" | "sideA" | "sideB";
type Step = "intro" | "align" | "rest" | Id | "review";
const ORDER: Step[] = ["intro", "align", "rest", "smile", "brow", "frown", "pucker", "right", "left", "close", "review"];
const MOVES: Id[] = ["smile", "brow", "frown", "pucker", "right", "left", "close"];
const COPY: Record<Id, { title: string; cue: string; tip: string; games: string }> = {
  smile: { title: "Smile", cue: "Give a gentle smile", tip: "Like greeting a friend. Never force it.", games: "Flight · Dash" },
  brow: { title: "Eyebrow raise", cue: "Lift your eyebrows", tip: "Raise them gently, as if mildly surprised.", games: "Flight · Dash" },
  frown: { title: "Frown", cue: "Turn the corners of your mouth down", tip: "Just your mouth, like a small frown. Keep your brows relaxed.", games: "Dash" },
  pucker: { title: "Lip pucker", cue: "Round your lips like “ooo”", tip: "Gently purse them and hold.", games: "Flight" },
  right: { title: "Pucker to your right", cue: "Pucker, then nudge your lips to your right", tip: "Round your lips, then shift them toward your right cheek.", games: "Dash" },
  left: { title: "Pucker to your left", cue: "Pucker, then nudge your lips to your left", tip: "Round your lips, then shift them toward your left cheek.", games: "Dash" },
  close: { title: "Gentle eye closure", cue: "Close your eyes softly", tip: "Soft, like resting. No squeezing.", games: "Flight" },
};
const MINSK: Record<SK, number> = { smile: .015, brow: .015, frown: .04, pucker: .08, close: .08, sideA: .08, sideB: .08 };
const CAL_KEYS = ["smile", "brow", "pucker", "close", "liftL", "liftR", "browL", "browR", "closeL", "closeR"] as (keyof Vals)[];
const FSIDES: Record<string, (keyof Vals)[] | null> = { smile: ["liftL", "liftR"], brow: ["browL", "browR"], pucker: null, close: ["closeL", "closeR"] };
const sig = (v: Vals): Record<SK, number> => ({ smile: v.smile, brow: v.brow, frown: v.frown, pucker: v.pucker, close: v.close, sideA: v.sideA - 0.6 * v.sideB + 0.3 * v.pucker, sideB: v.sideB - 0.6 * v.sideA + 0.3 * v.pucker });
const SKS: SK[] = ["smile", "brow", "frown", "pucker", "close", "sideA", "sideB"];
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
const topMean = (a: number[]) => mean([...a].sort((x, y) => y - x).slice(0, Math.max(5, Math.floor(a.length / 4))));
const buzz = (p: number | number[]) => { try { if ("vibrate" in navigator) navigator.vibrate(p); } catch { /* not supported */ } };
type Neutral = { sk: Record<SK, { mean: number; std: number }>; raw: Record<string, { mean: number; std: number }> };
const CW = 360, CH = 480, CX = CW / 2, CY = CH * .46, RX = CW * .34, RY = CH * .36, IOD = RX * 2 / 2.4;
const BLUE = "#8fd0ff", PURPLE = "#b79cff";

function Guide({ id, size = 64 }: { id: Id | "rest" | "pucker"; size?: number }) {
  const sx = id === "right" ? 5 : id === "left" ? -5 : 0;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" stroke={BLUE} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <ellipse cx="50" cy="52" rx="31" ry="38" strokeOpacity=".5" />
      {id === "brow" ? <><path d="M26 33q9-9 18 0M56 33q9-9 18 0" /><circle cx="35" cy="46" r="4" fill={BLUE} /><circle cx="65" cy="46" r="4" fill={BLUE} /></>
        : id === "close" ? <><path d="M27 46q8 7 16 0M57 46q8 7 16 0" /><path d="M27 36q8-4 16 0M57 36q8-4 16 0" strokeOpacity=".6" /></>
        : <><path d="M27 37q8-4 16 0M57 37q8-4 16 0" strokeOpacity=".7" /><circle cx="36" cy="47" r="3" fill={BLUE} /><circle cx="64" cy="47" r="3" fill={BLUE} /></>}
      {id === "smile" ? <path d="M33 68q17 14 34 0" /> : id === "frown" ? <path d="M35 77q15-12 30 0" /> : id === "pucker" || id === "right" || id === "left" ? <circle cx={50 + sx * 2.4} cy="70" r="6.5" /> : id === "brow" ? <path d="M40 70h20" /> : <path d="M38 70h24" strokeOpacity=".7" />}
      {(id === "right" || id === "left") && <path d={id === "right" ? "M68 70h14m-5-5l5 5-5 5" : "M32 70H18m5-5l-5 5 5 5"} />}
    </svg>);
}

type Built = { flight: Record<string, any>; dash: Record<string, any>; neutral: Record<string, { mean: number; std: number }>; status: Record<Id, "ok" | "weak" | "skipped"> };

export default function Calibrate() {
  const video = useRef<HTMLVideoElement>(null), cv = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null), tracker = useRef<Awaited<ReturnType<typeof createTracker>> | null>(null), latest = useRef<Frame | null>(null);
  const [step, setStep] = useState<Step>("intro"), [cam, setCam] = useState<"off" | "loading" | "on">("off"), [err, setErr] = useState<string | null>(null);
  const [built, setBuilt] = useState<Built | null>(null), [saving, setSaving] = useState(false), [saved, setSaved] = useState(false);
  const [hud, setHud] = useState({ aligned: false, locked: false, hint: "Looking for your face…", progress: 0, phase: "brief" as "brief" | "count" | "hold" | "flash", skipHint: false, face: false, count: 0 as number });
  const S = useRef({ step: "intro" as Step, alignedSince: 0, lostSince: 0, locked: false, enteredAt: 0, phase: "brief" as "brief" | "count" | "hold" | "flash", phaseStart: 0, lostAt: 0, fails: 0, skipBrief: false, over: 0, holdStart: 0, weakSince: 0, buf: [] as Vals[], restBuf: [] as Vals[], restMs: 0, last: 0, flashUntil: 0, bestKey: "sideA" as SK, rightKey: null as SK | null, neutral: null as Neutral | null, redo: false, samples: {} as Partial<Record<Id, Vals[]>>, progress: 0, hint: "", face: false, aligned: false, rough: false });
  const [first, setFirst] = useState(false); useEffect(() => { setFirst(new URLSearchParams(location.search).get("first") === "1"); }, []);

  useEffect(() => { (async () => { const { data: { user } } = await supabase().auth.getUser(); if (!user) location.href = "/"; })(); return () => stop(); }, []);
  function stop() { tracker.current?.stop(); tracker.current = null; stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; latest.current = null; }
  function nextUrl() { const n = new URLSearchParams(location.search).get("next"); return n && n.startsWith("/") && !n.startsWith("//") ? n : "/dashboard"; }

  function enter(s: Step) {
    const r = S.current; r.step = s; r.enteredAt = performance.now(); r.phase = "brief"; r.phaseStart = performance.now(); r.lostAt = 0; r.fails = 0; r.skipBrief = false; r.over = 0; r.buf = []; r.progress = 0; r.weakSince = 0; r.restBuf = []; r.restMs = 0; r.flashUntil = 0;
    if (s === "review") { S.current.redo = false; setBuilt(build()); stop(); setCam("off"); }
    setStep(s);
  }
  function goBack() {
    const i = ORDER.indexOf(S.current.step), n = ORDER[i - 1];
    if (!n) { location.href = "/dashboard"; return; }
    if (n === "intro") { stop(); setCam("off"); enter("intro"); return; }
    if (cam === "off") { startCam(n); return; }
    delete S.current.samples[n as Id]; if (n === "rest") S.current.neutral = null; if (n === "right") S.current.rightKey = null;
    enter(n);
  }
  async function startCam(goTo: Step = "align") {
    setCam("loading"); setErr(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      stream.current = s; s.getVideoTracks()[0].onended = () => { setCam("off"); setErr("The camera was interrupted. Tap Start camera to resume."); };
      const v = video.current!; v.srcObject = s; await v.play();
      tracker.current = await createTracker(v, f => { latest.current = f; });
      setCam("on"); enter(goTo);
    } catch (e: any) { stop(); setCam("off"); setErr(e?.name === "NotAllowedError" ? "Camera access is blocked. Allow it in your browser’s site settings (the lock icon by the address), then try again." : `Couldn’t start the camera: ${e?.message ?? e}`); }
  }

  function build(): Built {
    const nu = S.current.neutral, sm = S.current.samples;
    const status = {} as Record<Id, "ok" | "weak" | "skipped">; const flight: Record<string, any> = {}, dash: Record<string, any> = {};
    if (!nu) { for (const m of MOVES) status[m] = "skipped"; return { flight, dash, neutral: {}, status }; }
    const mv = (s: Vals[], k: SK, key?: SK) => { const kk = key ?? k, a = s.map(v => sig(v)[kk]), n = nu.sk[kk], peak = topMean(a), range = peak - n.mean; return { key: kk, nm: n.mean, std: n.std, peak, range, detectable: range > Math.max(3 * n.std, MINSK[kk]) }; };
    for (const k of ["smile", "brow", "pucker", "close"] as const) {
      const s = sm[k]; if (!s?.length) { status[k] = "skipped"; continue; }
      const n = nu.raw[k], peak = topMean(s.map(v => v[k] as number)), range = peak - n.mean, detectable = range > Math.max(3 * n.std, MINSK[k]);
      const top = [...s].sort((a, b) => (b[k] as number) - (a[k] as number)).slice(0, Math.max(5, Math.floor(s.length / 4))), sides = FSIDES[k];
      flight[k] = { peak, range, threshold: n.mean + .5 * range, detectable, sideDelta: sides ? sides.map(x => mean(top.map(t => t[x] as number)) - nu.raw[x as string].mean) : null };
      status[k] = detectable ? "ok" : "weak";
    }
    for (const [d, k] of [["jump", "smile"], ["fly", "brow"], ["duck", "frown"]] as [string, SK][]) { const s = sm[k === "smile" ? "smile" : k === "brow" ? "brow" : "frown"]; if (s?.length) dash[d] = mv(s, k); }
    if (sm.frown?.length) status.frown = dash.duck.detectable ? "ok" : "weak"; else status.frown = "skipped";
    let rk: SK | null = null;
    if (sm.right?.length) { const a = mv(sm.right, "sideA"), b = mv(sm.right, "sideB"), win = a.range / MINSK.sideA >= b.range / MINSK.sideB ? a : b; rk = win.key; dash.right = win; status.right = win.detectable ? "ok" : "weak"; } else status.right = "skipped";
    if (sm.left?.length && rk) { const w = mv(sm.left, "sideA", rk === "sideA" ? "sideB" : "sideA"); dash.left = w; status.left = w.detectable ? "ok" : "weak"; } else status.left = "skipped";
    const neutral: Record<string, { mean: number; std: number }> = {}; for (const k of CAL_KEYS) neutral[k as string] = nu.raw[k as string];
    return { flight, dash, neutral, status };
  }

  // ---------- live loop ----------
  useEffect(() => {
    if (cam !== "on") return; const c = cv.current; if (!c) return; c.width = CW * 2; c.height = CH * 2; const x = c.getContext("2d")!; x.setTransform(2, 0, 0, 2, 0, 0);
    let raf = 0, hudT = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop); const r = S.current, fr = latest.current, v = video.current; const dt = Math.min(100, now - (r.last || now)); r.last = now;
      // geometry
      let nx = -1, ny = -1, iod = 0, face = false;
      if (v && v.videoWidth) { const sc = Math.max(CW / v.videoWidth, CH / v.videoHeight), ox = (v.videoWidth * sc - CW) / 2, oy = (v.videoHeight * sc - CH) / 2;
        x.save(); x.translate(CW, 0); x.scale(-1, 1); x.drawImage(v, -ox, -oy, v.videoWidth * sc, v.videoHeight * sc); x.restore();
        if (fr?.pos && fr.q.face) { face = true; nx = CW - (fr.pos.x * v.videoWidth * sc - ox); ny = fr.pos.y * v.videoHeight * sc - oy; iod = fr.pos.s * v.videoWidth * sc; } }
      const dx = nx - CX, dy = ny - CY, rr = iod / IOD;
      const ok = face && Math.abs(dx) < CW * .07 && Math.abs(dy) < CH * .07 && rr > .8 && rr < 1.25;
      const rough = face && Math.abs(dx) < CW * .13 && Math.abs(dy) < CH * .13 && rr > .65 && rr < 1.5;
      if (ok) { if (!r.alignedSince) r.alignedSince = now; r.lostSince = 0; } else { if (!r.lostSince) r.lostSince = now; if (now - r.lostSince > 400) r.alignedSince = 0; }
      r.locked = !!r.alignedSince && now - r.alignedSince > 700; r.aligned = ok; r.rough = rough; r.face = face;
      hudSkip = false;
      let count = 0;
      let hint = !face ? "Looking for your face…" : rr < .8 ? "Move a little closer" : rr > 1.25 ? "Move back a little" : dx > CW * .07 ? "Move left" : dx < -CW * .07 ? "Move right" : dy > CH * .07 ? "Move up" : dy < -CH * .07 ? "Move down" : "Hold still";
      const good = !!(fr?.vals && fr.q.face && fr.q.size);
      // ---- state machine ----
      if (r.step === "align") { r.progress = r.locked ? Math.min(1, (now - r.alignedSince - 700) / 1300) : 0; hint = r.locked ? "Locked in" : hint; if (r.locked && now - r.alignedSince > 2000) { buzz(60); enter("rest"); } }
      else if (r.step === "rest" || (MOVES as string[]).includes(r.step)) {
        const isRest = r.step === "rest", id = r.step as Id, BRIEF = 3500, HOLD = 3000;
        if (r.phase === "flash") { hint = isRest ? "Baseline saved" : "Got it"; r.progress = 1; if (now > r.flashUntil) { if (isRest) enter("smile"); else enter(r.redo ? "review" : ORDER[ORDER.indexOf(r.step) + 1]); } }
        else if (!rough || !good) {
          if (!r.lostAt) r.lostAt = now;
          if ((r.phase === "count" || r.phase === "hold") && now - r.lostAt > 500) { r.phase = "brief"; r.phaseStart = now; r.buf = []; }
          if (r.phase === "brief") { r.phaseStart = now; r.skipBrief = false; }
          r.progress = 0; if (!face) hint = "Looking for your face…";
        } else {
          r.lostAt = 0; const el = now - r.phaseStart;
          if (r.phase === "brief") { hint = r.fails ? "Let’s try that once more" : "Press I’m ready"; r.progress = 0; if (r.skipBrief) { r.skipBrief = false; r.phase = "count"; r.phaseStart = now; } }
          else if (r.phase === "count") { count = Math.max(1, 3 - Math.floor(el / 1000)); hint = isRest ? "Relax your face" : COPY[id].title; r.progress = 0; if (el >= 3000) { r.phase = "hold"; r.phaseStart = now; r.buf = []; buzz(40); } }
          else if (r.phase === "hold") {
            hint = isRest ? "Stay relaxed…" : "Hold it…"; r.buf.push(fr!.vals!); r.progress = Math.min(1, el / HOLD);
            if (el >= HOLD) {
              if (isRest) {
                if (r.buf.length > 25) {
                  const nu: Neutral = { sk: {} as any, raw: {} }; for (const k of SKS) { const a = r.buf.map(b => sig(b)[k]); nu.sk[k] = { mean: mean(a), std: sd(a) }; }
                  for (const k of CAL_KEYS) { const a = r.buf.map(b => b[k] as number); nu.raw[k as string] = { mean: mean(a), std: sd(a) }; }
                  r.neutral = nu; r.phase = "flash"; r.flashUntil = now + 1100; buzz(100);
                } else { r.fails++; r.phase = "brief"; r.phaseStart = now; }
              } else if (r.neutral) {
                const nu = r.neutral, cands: SK[] = id === "right" ? ["sideA", "sideB"] : id === "left" ? (r.rightKey ? [r.rightKey === "sideA" ? "sideB" : "sideA"] : ["sideA", "sideB"]) : [id as SK];
                let bk = cands[0], br = -9;
                for (const k of cands) { const a = r.buf.map(q => sig(q)[k]), n = nu.sk[k], ratio = (topMean(a) - n.mean) / Math.max(3 * n.std, MINSK[k]); if (ratio > br) { br = ratio; bk = k; } }
                if (br > 1) { r.samples[id] = r.buf; if (id === "right") r.rightKey = bk; r.phase = "flash"; r.flashUntil = now + 1200; buzz(110); }
                else { r.fails++; r.phase = "brief"; r.phaseStart = now; r.buf = []; }
              } else enter("rest");
            }
          }
        }
        hudSkip = r.fails >= 2 && !isRest;
      }
      if (now - hudT > 100) { hudT = now; setHud({ aligned: r.aligned, locked: r.locked, hint, progress: r.progress, phase: r.phase, skipHint: hudSkip, face, count }); }
      drawHud(x, now, face, nx, ny, ok, r.locked, r.step);
    };
    let hudSkip = false;
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [cam]);

  async function save() {
    if (!built) return; setSaving(true); setErr(null);
    const sb = supabase(); const { data: { user } } = await sb.auth.getUser(); if (!user) { location.href = "/"; return; }
    const e1 = (await sb.from("calibration_profiles").insert({ user_id: user.id, summary: { version: 2, neutral: built.neutral, moves: built.flight, swapLR: false, note: "Camera-derived estimates in face-size-normalised units; not clinical measurements." } })).error;
    if (e1) { setSaving(false); setErr(`Couldn’t save: ${e1.message}`); return; }
    const e2 = (await sb.from("dash_calibration").upsert({ user_id: user.id, summary: { version: 1, moves: built.dash, note: "Camera-derived estimates; not clinical measurements." }, updated_at: new Date().toISOString() }, { onConflict: "user_id" })).error;
    setSaving(false);
    if (e2) { setErr(`Your main calibration saved, but Mirror Dash’s didn’t: ${e2.message}. (Run the 0007 database step in Supabase.)`); return; }
    buzz([100, 80, 100]); setSaved(true); setTimeout(() => { location.href = nextUrl(); }, 900);
  }

  const idx = ORDER.indexOf(step), total = ORDER.length - 2; const isMove = (MOVES as string[]).includes(step); const c = isMove ? COPY[step as Id] : null;
  const dots = <div className="flex gap-1" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={Math.min(total, Math.max(1, idx))} aria-label={`Step ${Math.max(1, idx)} of ${total}`}>{ORDER.slice(1, -1).map((s, n) => <div key={s} className={`h-1 flex-1 rounded-full ${n < idx ? "bg-teal" : "bg-navy/15"}`} />)}</div>;
  const videoEl = <video ref={video} playsInline muted className="pointer-events-none fixed left-0 top-0 h-1 w-1 opacity-[0.02]" aria-hidden />;

  if (step === "intro") return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))]">{videoEl}
      <button className="self-start text-sm text-navy/60" onClick={() => (location.href = "/dashboard")} aria-label="Back to dashboard">← Back</button>
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <svg viewBox="0 0 200 240" className="h-52 w-44 text-teal" fill="none" aria-hidden>
          <ellipse cx="100" cy="120" rx="70" ry="92" stroke="currentColor" strokeWidth="2.5" strokeDasharray="8 7" />
          {Array.from({ length: 36 }, (_, i) => { const a = i * Math.PI / 18, l = i % 3 === 0; return <line key={i} x1={100 + Math.cos(a) * 76} y1={120 + Math.sin(a) * 98} x2={100 + Math.cos(a) * (l ? 88 : 82)} y2={120 + Math.sin(a) * (l ? 112 : 104)} stroke="currentColor" strokeOpacity={l ? 0.9 : 0.4} strokeWidth="1.5" />; })}
          <path d="M70 108q8-5 16 0M114 108q8-5 16 0" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /><path d="M82 152q18 12 36 0" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M18 20h22M18 20v22M182 20h-22M182 20v22M18 220h22M18 220v-22M182 220h-22M182 220v-22" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
        <h1 className="mt-6 font-display text-4xl">{first ? "Let’s calibrate" : "Calibrate"}</h1>
        <p className="mt-1 text-navy/60">About 2 minutes</p>
        <ul className="mt-7 grid w-full grid-cols-3 gap-3 text-xs text-navy/80">
          <li className="rounded-2xl bg-paper px-2 py-4 shadow-soft"><svg viewBox="0 0 32 32" className="mx-auto h-8 w-8 text-teal" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><circle cx="9" cy="19" r="5" /><circle cx="23" cy="19" r="5" /><path d="M14 19h4M4 19L6 10M28 19l-2-9M5 28L27 8" /></svg><span className="mt-2 block">Glasses off</span></li>
          <li className="rounded-2xl bg-paper px-2 py-4 shadow-soft"><svg viewBox="0 0 32 32" className="mx-auto h-8 w-8 text-teal" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><circle cx="16" cy="16" r="5" /><path d="M16 4v3M16 25v3M4 16h3M25 16h3M7.5 7.5l2 2M22.5 22.5l2 2M24.5 7.5l-2 2M9.5 22.5l-2 2" /></svg><span className="mt-2 block">Good light</span></li>
          <li className="rounded-2xl bg-paper px-2 py-4 shadow-soft"><svg viewBox="0 0 32 32" className="mx-auto h-8 w-8 text-teal" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="9" y="3" width="14" height="26" rx="3" /><circle cx="16" cy="10" r="2" /><path d="M13 25h6" /></svg><span className="mt-2 block">Eye level</span></li>
        </ul>
      </div>
      {err && <p role="alert" className="mb-3 rounded-xl bg-lav/50 p-3 text-sm">{err}</p>}
      <button className="btn-primary min-h-[60px] w-full text-lg" disabled={cam === "loading"} onClick={() => startCam("align")}>{cam === "loading" ? "Starting camera…" : "Start"}</button>
      <p className="mt-3 text-center text-xs text-navy/50">Video stays on your device.{first && <> · <button className="underline" onClick={() => { try { sessionStorage.setItem("sq-skipcal", "1"); } catch { /* ignore */ } location.href = "/dashboard"; }}>Skip for now</button></>}</p>
    </main>);

  if (step === "review") {
    const b = built; const st = (m: Id) => b?.status[m] ?? "skipped";
    const flightOk = (["smile", "brow", "pucker", "close"] as Id[]).some(m => st(m) === "ok"), dashOk = (["smile", "brow", "frown", "right", "left"] as Id[]).every(m => st(m) === "ok");
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">{videoEl}
        {dots}<h1 className="mt-5 font-display text-3xl">All set?</h1>
        <ul className="mt-4 grid gap-2">{MOVES.map(m => <li key={m} className="flex items-center gap-3 rounded-xl bg-paper p-3 shadow-soft"><Guide id={m} size={44} /><span className="flex-1"><b>{COPY[m].title}</b><br /><span className="text-xs text-navy/60">{COPY[m].games}</span></span>
          <span className={`rounded-full px-3 py-1 text-xs ${st(m) === "ok" ? "bg-sage/40" : "bg-gold/30"}`}>{st(m) === "ok" ? "Ready" : st(m) === "weak" ? "Not detected" : "Skipped"}</span>
          <button className="text-sm text-teal underline" onClick={() => { S.current.redo = true; startCam(m); }}>Redo</button></li>)}</ul>
        <div className="mt-4 grid gap-2 text-sm"><p className={`rounded-xl p-3 ${flightOk ? "bg-sage/25" : "bg-gold/25"}`}>Mirror Flight: {flightOk ? "ready with the movements marked Ready." : "record at least one movement."}</p>
          <p className={`rounded-xl p-3 ${dashOk ? "bg-sage/25" : "bg-gold/25"}`}>Mirror Dash: {dashOk ? "ready." : "needs smile, eyebrows, frown, and pucker right and left to all be Ready."}</p></div>
        {err && <p role="alert" className="mt-3 rounded-xl bg-lav/50 p-3 text-sm">{err}</p>}
        <div className="mt-auto pt-6"><button className="btn-primary w-full min-h-[60px] text-lg" disabled={saving || saved || !(flightOk || dashOk)} onClick={save}>{saved ? "Saved ✓" : saving ? "Saving…" : "Save calibration"}</button>
          <button className="btn-quiet mt-3 w-full" disabled={saving} onClick={() => goBack()}>Back</button></div>
      </main>);
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">{videoEl}
      <div className="px-1">{dots}</div>
      <div className="relative mt-3 overflow-hidden rounded-2xl border border-sage/40 bg-black shadow-soft" style={{ aspectRatio: `${CW} / ${CH}` }}>
        <canvas ref={cv} className="absolute inset-0 h-full w-full" aria-label="Your camera preview (mirrored) with a head-position outline" />
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3 text-white">
          <span className="rounded bg-[#0f1038]/70 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[.2em] text-[#8fd0ff] backdrop-blur">{step === "align" ? "Align" : step === "rest" ? "Baseline" : `Move ${Math.max(1, idx - 2)}/${MOVES.length}`}</span>
          {(isMove || step === "rest") && <span className="rounded-lg bg-[#0f1038]/70 p-1.5 backdrop-blur"><Guide id={isMove ? (step as Id) : "rest"} size={58} /></span>}
        </div>
        <div className="pointer-events-none absolute inset-x-0 top-[34%] flex justify-center px-6 text-center">
          {hud.phase === "flash" ? <span className="rounded-full bg-[#8fd0ff] px-5 py-2 text-lg font-semibold text-[#0f1038]">✓ Captured</span>
            : hud.phase === "count" && hud.count > 0 && (isMove || step === "rest") ? <span className="font-display text-[110px] font-bold leading-none text-white drop-shadow-[0_0_24px_rgba(143,208,255,.9)]" aria-live="assertive">{hud.count}</span>
            : <span className={`rounded-full px-4 py-1.5 font-mono text-xs uppercase tracking-[.18em] backdrop-blur ${hud.aligned ? "bg-[#8fd0ff]/25 text-[#bfe6ff]" : "bg-[#b79cff]/25 text-[#d9ccff]"}`}>{hud.hint}</span>}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3">
          <div className="rounded-xl border border-white/10 bg-[#0f1038]/75 p-3 text-white backdrop-blur">
            {step === "align" && <><p className="font-display text-xl">Fit your head in the outline</p><p className="mt-1 text-sm text-white/75">Look straight at the camera. Glasses off, please.</p></>}
            {step === "rest" && (hud.phase === "brief" ? <><p className="font-display text-xl">First, a relaxed face</p><p className="mt-1 text-sm text-white/75">Look at the camera with a comfortable, neutral face.</p></>
              : hud.phase === "count" ? <><p className="font-display text-xl">Relax your face</p><p className="mt-1 text-sm text-white/75">Get comfortable and neutral.</p></>
              : <><p className="font-display text-xl">Stay relaxed</p><p className="mt-1 text-sm text-white/75">Hold still. Almost done.</p></>)}
            {c && (hud.phase === "brief" ? <><p className="text-xs uppercase tracking-[.2em] text-[#8fd0ff]">Next up</p><p className="mt-0.5 font-display text-xl">{c.cue}</p><p className="mt-1 text-sm text-white/75">{hud.skipHint ? "Not picking it up yet. Try a little more this time, or skip this one." : `${c.tip}`}</p></>
              : hud.phase === "count" ? <><p className="font-display text-xl">{c.cue}</p><p className="mt-1 text-sm text-white/75">Start making the face now, then hold it when the count ends.</p></>
              : <><p className="font-display text-xl">Hold it…</p><p className="mt-1 text-sm text-white/75">{c.title}. Keep it steady until the bar fills.</p></>)}
            <div className="mt-2.5 h-1 rounded-full bg-white/15"><div className="h-1 rounded-full bg-[#8fd0ff] transition-[width] duration-100" style={{ width: `${Math.round(hud.progress * 100)}%` }} /></div>
          </div></div>
      </div>
      {err && <p role="alert" className="mt-3 rounded-xl bg-lav/50 p-3 text-sm">{err}</p>}
      <div className="mt-4 grid gap-3">
        {(isMove || step === "rest") && hud.phase === "brief" && <button className="btn-primary min-h-[60px] w-full text-lg" onClick={() => { S.current.skipBrief = true; }}>I’m ready</button>}
        <div className="flex items-center gap-3">
          <button className="btn-quiet" onClick={() => goBack()}>Back</button>
          {isMove && <button className={`btn-quiet flex-1 ${hud.skipHint ? "!border-teal" : ""}`} onClick={() => enter(S.current.redo ? "review" : ORDER[ORDER.indexOf(step) + 1])}>Skip this one</button>}
        </div>
      </div>
    </main>);
}

function drawHud(x: CanvasRenderingContext2D, now: number, face: boolean, nx: number, ny: number, aligned: boolean, locked: boolean, step: Step) {
  const col = aligned ? BLUE : PURPLE;
  x.fillStyle = "rgba(12,13,40,.62)"; x.beginPath(); x.rect(0, 0, CW, CH); x.ellipse(CX, CY, RX, RY, 0, 0, Math.PI * 2); x.fill("evenodd");
  x.save(); x.shadowColor = col; x.shadowBlur = locked ? 18 : 6; x.strokeStyle = col; x.lineWidth = 2.5; x.setLineDash(locked ? [] : [10, 8]); x.lineDashOffset = -now / 60; x.beginPath(); x.ellipse(CX, CY, RX, RY, 0, 0, Math.PI * 2); x.stroke(); x.restore();
  x.strokeStyle = col; x.lineWidth = 1.5;
  for (let i = 0; i < 72; i++) { const a = i * Math.PI / 36, long = i % 6 === 0, r1 = 1.04, r2 = long ? 1.12 : 1.07; x.globalAlpha = long ? .9 : .45; x.beginPath(); x.moveTo(CX + Math.cos(a) * RX * r1, CY + Math.sin(a) * RY * r1); x.lineTo(CX + Math.cos(a) * RX * r2, CY + Math.sin(a) * RY * r2); x.stroke(); }
  x.globalAlpha = 1; x.lineWidth = 2.5; const L = 26, m = 14;
  for (const [px, py, sx, sy] of [[m, m + 38, 1, 1], [CW - m, m + 38, -1, 1], [m, CH - m - 96, 1, -1], [CW - m, CH - m - 96, -1, -1]] as number[][]) { x.beginPath(); x.moveTo(px, py + sy * L); x.lineTo(px, py); x.lineTo(px + sx * L, py); x.stroke(); }
  x.lineWidth = 1; x.globalAlpha = .5; x.beginPath(); x.moveTo(CX - 10, CY); x.lineTo(CX + 10, CY); x.moveTo(CX, CY - 10); x.lineTo(CX, CY + 10); x.stroke(); x.globalAlpha = 1;
  if (step === "align" || step === "rest") { const t = (now / 2200) % 1, y = CY - RY + t * RY * 2; x.save(); x.beginPath(); x.ellipse(CX, CY, RX, RY, 0, 0, Math.PI * 2); x.clip(); const g = x.createLinearGradient(0, y - 24, 0, y); g.addColorStop(0, "rgba(143,208,255,0)"); g.addColorStop(1, "rgba(143,208,255,.35)"); x.fillStyle = g; x.fillRect(CX - RX, y - 24, RX * 2, 24); x.restore(); }
  if (face && nx >= 0) { x.strokeStyle = col; x.lineWidth = 1.5; x.beginPath(); x.arc(nx, ny, 7, 0, Math.PI * 2); x.moveTo(nx - 13, ny); x.lineTo(nx - 4, ny); x.moveTo(nx + 4, ny); x.lineTo(nx + 13, ny); x.moveTo(nx, ny - 13); x.lineTo(nx, ny - 4); x.moveTo(nx, ny + 4); x.lineTo(nx, ny + 13); x.stroke(); }
}
