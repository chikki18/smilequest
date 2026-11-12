"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { createTracker, type Frame, type Vals } from "@/lib/tracking";
import { POLICY_VERSION } from "@/lib/onboarding";

// ---------- movements ----------
type M = "jump" | "fly" | "duck" | "right" | "left";
const MOVES: M[] = ["jump", "fly", "duck", "right", "left"];
type SK = "smile" | "brow" | "frown" | "sideA" | "sideB";
const INFO: Record<M, { name: string; action: string; cue: string; tip: string; icon: string }> = {
  jump: { name: "Smile", action: "Jump", cue: "Smile to jump", tip: "A gentle smile. Never force it.", icon: "😊" },
  fly: { name: "Eyebrow raise", action: "Jetpack", cue: "Raise your eyebrows to fly", tip: "Lift them gently, as if mildly surprised. Hold to keep flying.", icon: "🤨" },
  duck: { name: "Frown", action: "Duck", cue: "Frown to duck", tip: "Gently draw your brows down and the corners of your mouth down.", icon: "☹️" },
  right: { name: "Pucker to your right", action: "Move right", cue: "Pucker to your right to move right", tip: "Round your lips like “ooo” and nudge them toward your right cheek.", icon: "😗" },
  left: { name: "Pucker to your left", action: "Move left", cue: "Pucker to your left to move left", tip: "Round your lips like “ooo” and nudge them toward your left cheek.", icon: "😗" },
};
const SHORT: Record<M, string> = { jump: "Smile\nJump", fly: "Brows\nFly", duck: "Frown\nDuck", right: "Pucker →\nRight", left: "← Pucker\nLeft" };
type Move = { key: SK; nm: number; std: number; peak: number; range: number; detectable: boolean };
type Cal = Record<M, Move>;
const MIN: Record<SK, number> = { smile: .015, brow: .015, frown: .05, sideA: .08, sideB: .08 };
const sigs = (v: Vals): Record<SK, number> => ({ smile: v.smile, brow: v.brow, frown: v.frown, sideA: v.sideA - 0.6 * v.sideB + 0.3 * v.pucker, sideB: v.sideB - 0.6 * v.sideA + 0.3 * v.pucker });
const SKS: SK[] = ["smile", "brow", "frown", "sideA", "sideB"];
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const buzz = (p: number | number[]) => { try { if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(p); } catch { /* not supported */ } };
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

// ---------- settings ----------
const LENS = [60, 90, 120];
const STARTS = [{ v: 10, n: "Slow" }, { v: 14, n: "Medium" }, { v: 18, n: "Quick" }];
const RAMPS = [{ v: 1.5, n: "A little" }, { v: 2, n: "Steadily" }, { v: 2.6, n: "A lot" }];
const GAINS = [1, 1.3, 1.7, 2.2, 3];
type Settings = { len: number; start: number; ramp: number; hints: boolean; haptics: boolean };
const DEF: Settings = { len: 90, start: 14, ramp: 2, hints: true, haptics: true };
const SKEY = "smilequest.dash.settings";
function loadSettings(): Settings { try { const j = JSON.parse(localStorage.getItem(SKEY) || "null"); if (j) return { ...DEF, ...j, len: LENS.includes(j.len) ? j.len : DEF.len }; } catch { /* ignore */ } return DEF; }
function saveSettings(s: Settings) { try { localStorage.setItem(SKEY, JSON.stringify(s)); } catch { /* ignore */ } }

// ---------- world ----------
const W = 360, HZ = 150, LANE = 100, D0 = 10, TOPBAR = 96, BOTBAR = 112;
const sOf = (d: number) => 1 / (1 + d / D0);
type Kind = "hurdle" | "bar" | "wall" | "full";
type Row = { z: number; kind: Kind; lanes: number[]; zone: boolean; threat: boolean | null; hit: boolean; done: boolean };
type Coin = { z: number; lane: number; cy: number; got: boolean };
type G = {
  stage: "ready" | "play" | "done"; readyLeft: number; t: number; dist: number; lane: number; lanePos: number; cd: number; jumpT: number; crouchT: number; jet: number; fuel: number;
  on: Record<M, boolean>; lev: Record<M, number>; rows: Row[]; coins: Coin[]; spawnZ: number; speed: number; mul: number; invuln: number; coinsGot: number; points: number;
  streak: number; best: number; cleared: number; stumbles: number; top: number; counts: Record<M, number>; clearedBy: Record<string, number>; stumbledBy: Record<string, number>;
  lostSince: number | null; adjust: boolean; manual: boolean; wh: number; py: number; hint: string; run: number;
};
const z5 = () => ({ jump: 0, fly: 0, duck: 0, right: 0, left: 0 });
const fresh = (wh: number): G => ({
  stage: "ready", readyLeft: 6, t: 0, dist: 0, lane: 1, lanePos: 1, cd: 0, jumpT: 0, crouchT: 0, jet: 0, fuel: 1,
  on: { jump: false, fly: false, duck: false, right: false, left: false }, lev: z5(), rows: [], coins: [], spawnZ: 60, speed: 0, mul: 1, invuln: 0, coinsGot: 0, points: 0,
  streak: 0, best: 0, cleared: 0, stumbles: 0, top: 0, counts: z5(), clearedBy: {}, stumbledBy: {}, lostSince: null, adjust: false, manual: false, wh, py: wh - BOTBAR - 40, hint: "", run: 0,
});
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
function spawnRow(s: G, len: number) {
  const p = clamp(s.t / len, 0, 1);
  const pool: Kind[] = ["hurdle"]; if (s.t > 6) pool.push("wall"); if (s.t > 12) pool.push("bar", "hurdle"); if (s.t > 20) pool.push("full", "wall");
  const kind = pool[Math.floor(Math.random() * pool.length)];
  const all = [0, 1, 2].sort(() => Math.random() - .5);
  const n = kind === "full" ? 3 : kind === "wall" ? 1 + (p > .35 && Math.random() < .4 ? 1 : 0) : 1 + Math.floor(Math.random() * (p > .3 ? 3 : 2));
  const lanes = all.slice(0, Math.min(3, n)).sort();
  s.rows.push({ z: s.spawnZ, kind, lanes, zone: false, threat: null, hit: false, done: false });
  const free = [0, 1, 2].filter(l => !lanes.includes(l));
  if (kind === "hurdle") { const l = lanes[0]; for (const dz of [-4, 0, 4]) s.coins.push({ z: s.spawnZ + dz, lane: l, cy: .75, got: false }); }
  else if (kind === "bar") { for (const dz of [-3, 0, 3]) s.coins.push({ z: s.spawnZ + dz, lane: lanes[0], cy: 0, got: false }); }
  else if (kind === "wall" && free.length) { for (const dz of [-4, 0, 4]) s.coins.push({ z: s.spawnZ + dz, lane: free[0], cy: 0, got: false }); }
  else if (kind === "full") { for (const dz of [-8, -4, 0, 4, 8]) s.coins.push({ z: s.spawnZ + dz, lane: 1, cy: 1.1, got: false }); }
  s.spawnZ += Math.max(22, 36 - 12 * p) + rnd(0, 6);
}

function drawWorld(c: CanvasRenderingContext2D, s: G, now: number) {
  const wh = s.wh, PY = s.py, cx = W / 2, yOf = (sc: number) => HZ + (PY - HZ) * sc;
  const sky = c.createLinearGradient(0, 0, 0, HZ + 30); sky.addColorStop(0, "#8fd3f4"); sky.addColorStop(1, "#fdf0d5");
  c.fillStyle = sky; c.fillRect(0, 0, W, wh); c.fillStyle = "#9ad0a0"; c.fillRect(0, HZ, W, wh - HZ);
  c.fillStyle = "#ffe9a8"; c.beginPath(); c.arc(285, HZ - 38, 22, 0, 7); c.fill();
  c.fillStyle = "#b7cfe0"; for (let i = 0; i < 9; i++) { const h = 20 + ((i * 53) % 34); c.fillRect(i * 44 - 6, HZ - h, 36, h); }
  // runway bands
  const b0 = Math.floor(s.dist / 4);
  for (let i = 30; i >= 0; i--) {
    const zn = (b0 + i) * 4 - s.dist, zf = zn + 4, sn = sOf(Math.max(zn, -8)), sf = sOf(zf);
    c.fillStyle = (b0 + i) % 2 ? "#6f7d8c" : "#657384";
    c.beginPath(); c.moveTo(cx - 150 * sf, yOf(sf)); c.lineTo(cx + 150 * sf, yOf(sf)); c.lineTo(cx + 150 * sn, yOf(sn)); c.lineTo(cx - 150 * sn, yOf(sn)); c.closePath(); c.fill();
  }
  c.strokeStyle = "rgba(255,255,255,.55)"; c.lineWidth = 2.5;
  for (const x of [-50, 50]) { c.beginPath(); c.moveTo(cx + x * sOf(120), yOf(sOf(120))); c.lineTo(cx + x * sOf(-8), yOf(sOf(-8))); c.stroke(); }
  c.strokeStyle = "#f6f1e3"; c.lineWidth = 4; for (const x of [-150, 150]) { c.beginPath(); c.moveTo(cx + x * sOf(120), yOf(sOf(120))); c.lineTo(cx + x * sOf(-8), yOf(sOf(-8))); c.stroke(); }
  // scenery
  const k0 = Math.ceil(s.dist / 14);
  for (let i = 8; i >= 0; i--) for (const side of [-1, 1]) {
    const idx = k0 + i, z = idx * 14 - s.dist, sc = sOf(z); if (sc > 1.3) continue;
    const bw = 62 * sc, bh = (70 + ((idx * 37 + (side > 0 ? 11 : 0)) % 80)) * sc * 1.3, x = cx + side * (178 * sc) + (side > 0 ? 0 : -bw), y = yOf(sc);
    c.fillStyle = ["#e9b8a2", "#a7c4d6", "#d9c7e8", "#f2d88f"][(idx + (side > 0 ? 1 : 0)) % 4]; c.fillRect(x, y - bh, bw, bh);
    c.fillStyle = "rgba(255,255,255,.55)"; for (let r = 0; r < 3; r++) c.fillRect(x + bw * .15, y - bh + bh * (.12 + r * .28), bw * .25, bh * .12);
  }
  // objects far -> near
  type Obj = { d: number; draw: () => void };
  const objs: Obj[] = [];
  for (const r of s.rows) {
    const d = r.z - s.dist; if (d > 95 || d < -6) continue; const sc = sOf(d), y = yOf(sc);
    objs.push({ d, draw: () => { for (const l of r.lanes) {
      const x = cx + (l - 1) * LANE * sc; c.lineWidth = Math.max(1, 2 * sc); c.strokeStyle = "#2b3340";
      if (r.kind === "hurdle") { c.fillStyle = "#f2994a"; c.fillRect(x - 39 * sc, y - 38 * sc, 78 * sc, 38 * sc); c.strokeRect(x - 39 * sc, y - 38 * sc, 78 * sc, 38 * sc); c.fillStyle = "#fff4d6"; for (let i = 0; i < 4; i++) c.fillRect(x - 39 * sc + i * 20 * sc, y - 38 * sc, 9 * sc, 38 * sc); }
      else if (r.kind === "bar") { c.fillStyle = "#555"; c.fillRect(x - 40 * sc, y - 88 * sc, 8 * sc, 88 * sc); c.fillRect(x + 32 * sc, y - 88 * sc, 8 * sc, 88 * sc); c.fillStyle = "#e85d75"; c.fillRect(x - 44 * sc, y - 88 * sc, 88 * sc, 24 * sc); c.strokeRect(x - 44 * sc, y - 88 * sc, 88 * sc, 24 * sc); }
      else { c.fillStyle = r.kind === "full" ? "#6c4a7a" : "#3b5b7a"; c.fillRect(x - 42 * sc, y - 150 * sc, 84 * sc, 150 * sc); c.strokeRect(x - 42 * sc, y - 150 * sc, 84 * sc, 150 * sc); c.fillStyle = "rgba(255,255,255,.7)"; for (let a = 0; a < 3; a++) for (let b = 0; b < 2; b++) c.fillRect(x - 30 * sc + b * 36 * sc, y - 136 * sc + a * 40 * sc, 24 * sc, 22 * sc); }
    } } });
  }
  for (const co of s.coins) {
    if (co.got) continue; const d = co.z - s.dist; if (d > 95 || d < -6) continue; const sc = sOf(d), y = yOf(sc), x = cx + (co.lane - 1) * LANE * sc;
    objs.push({ d, draw: () => { const cyp = y - (16 + co.cy * 90) * sc; c.fillStyle = "#f6c945"; c.strokeStyle = "#a67c12"; c.lineWidth = Math.max(1, 2 * sc); c.beginPath(); c.ellipse(x, cyp, 11 * sc * (.7 + .3 * Math.abs(Math.sin(now / 250 + co.z))), 11 * sc, 0, 0, 7); c.fill(); c.stroke(); } });
  }
  objs.sort((a, b) => b.d - a.d);
  for (const o of objs) if (o.d >= 0) o.draw();
  // player
  const px = cx + (s.lanePos - 1) * LANE, jumpH = s.jumpT > 0 ? Math.sin(Math.PI * (1 - s.jumpT / .7)) : 0, lift = jumpH * 80 + s.jet * 120;
  const crouch = s.crouchT > 0 && lift < 5, bodyH = crouch ? 40 : 70, y0 = PY - lift;
  if (!(s.invuln > 0 && Math.floor(now / 90) % 2)) {
    c.fillStyle = "rgba(0,0,0,.25)"; c.beginPath(); c.ellipse(px, PY + 2, 24 - lift * .06, 7, 0, 0, 7); c.fill();
    const sw = Math.sin(now / 70) * 7 * (lift > 5 ? .2 : 1);
    c.strokeStyle = "#2b3340"; c.lineWidth = 2;
    c.fillStyle = "#33404f"; c.fillRect(px - 12 + sw, y0 - 18, 8, 18); c.fillRect(px + 4 - sw, y0 - 18, 8, 18);
    if (s.jet > .05) { c.fillStyle = "#8c96a3"; c.fillRect(px - 20, y0 - bodyH + 6, 10, 26); const fl = 16 + Math.random() * 14 + s.jet * 14; c.fillStyle = "#f29e4c"; c.beginPath(); c.moveTo(px - 18, y0 - bodyH + 32); c.lineTo(px - 12, y0 - bodyH + 32); c.lineTo(px - 15, y0 - bodyH + 32 + fl); c.closePath(); c.fill(); }
    c.fillStyle = "#4E8A86"; c.beginPath(); c.roundRect(px - 16, y0 - bodyH + 6, 32, bodyH - 18, 8); c.fill(); c.stroke();
    c.fillStyle = "#f2c9a0"; c.beginPath(); c.arc(px, y0 - bodyH - 4, 14, 0, 7); c.fill(); c.stroke();
    c.fillStyle = "#1B2A3A"; c.beginPath(); c.arc(px, y0 - bodyH - 9, 14, Math.PI, 0); c.fill();
    c.fillStyle = "#1B2A3A"; c.fillRect(px - 6, y0 - bodyH - 5, 3, 3); c.fillRect(px + 3, y0 - bodyH - 5, 3, 3);
    c.strokeStyle = "#7a3e00"; c.lineWidth = 1.5; c.beginPath(); c.arc(px, y0 - bodyH, 4, .2, Math.PI - .2); c.stroke();
  }
  for (const o of objs) if (o.d < 0) o.draw();
}

type Prof = { total: number };
type GameRow = { id: string; played_at: string; duration_seconds: number; points: number; distance: number; coins: number; cleared: number; stumbles: number; best_streak: number; top_speed: number | null; completed: boolean; per_move: any };
type Result = { points: number; distance: number; coins: number; cleared: number; stumbles: number; bestStreak: number; topSpeed: number; seconds: number; completed: boolean; counts: Record<M, number>; saved: boolean };

function Page({ children }: { children?: any }) { return <main className="mx-auto max-w-md px-6 pb-12 pt-[max(2rem,env(safe-area-inset-top))]">{children}</main>; }

export default function Dash() {
  const video = useRef<HTMLVideoElement>(null), cvRef = useRef<HTMLCanvasElement>(null), calCv = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null), tracker = useRef<Awaited<ReturnType<typeof createTracker>> | null>(null);
  const latest = useRef<Frame | null>(null), g = useRef<G>(fresh(640));
  const cfg = useRef({ len: 90, start: 14, ramp: 2, gain: 1.3, haptics: true }), liveGain = useRef(1.3);
  const [view, setView] = useState<"loading" | "hub" | "clearance" | "ready" | "settings" | "calibrate" | "stats" | "play" | "results">("loading");
  const [cal, setCal] = useState<Cal | null>(null), calRef = useRef<Cal | null>(null); calRef.current = cal;
  const [clear, setClear] = useState(false), [agree, setAgree] = useState(false);
  const [st, setSt] = useState<Settings>(DEF), stRef = useRef(st); stRef.current = st;
  const [msg, setMsg] = useState<string | null>(null), [busy, setBusy] = useState(false), [preview, setPreview] = useState(true), [gainUi, setGainUi] = useState(1.3);
  const [box, setBox] = useState({ w: 360, h: 640 });
  const [ui, setUi] = useState({ stage: "ready" as "ready" | "play" | "done", ready: 6, left: 90, dist: 0, coins: 0, mul: 1, adjust: false, paused: false, hint: "", lev: z5() as Record<M, number>, on: { jump: false, fly: false, duck: false, right: false, left: false } as Record<M, boolean>, stumble: false });
  const [result, setResult] = useState<Result | null>(null), [games, setGames] = useState<GameRow[] | null>(null);
  const [calFrom, setCalFrom] = useState<"play" | "settings">("play");
  const [calStep, setCalStep] = useState(0), [calCam, setCalCam] = useState<"off" | "loading" | "on">("off");
  const [calStatus, setCalStatus] = useState<string | null>(null), [calBusy, setCalBusy] = useState(false), [calMsg, setCalMsg] = useState<string | null>(null);
  const [calNeutral, setCalNeutral] = useState<Record<SK, { mean: number; std: number }> | null>(null);
  const [calMoves, setCalMoves] = useState<Partial<Record<M, Move>>>({}), [calSaving, setCalSaving] = useState(false);
  const [calQ, setCalQ] = useState<{ face: boolean; size: boolean; light: boolean } | null>(null);
  const hasCal = !!cal;

  useEffect(() => { (async () => {
    const sb = supabase(); const { data: { user } } = await sb.auth.getUser();
    if (!user) { location.href = "/"; return; }
    setSt(loadSettings());
    const { data: c } = await sb.from("dash_calibration").select("summary").maybeSingle();
    const mv = c?.summary?.moves; if (mv && MOVES.every(m => mv[m]?.detectable)) setCal(mv as Cal);
    const { data: cl } = await sb.from("consent_records").select("id").eq("kind", "exercise_clearance").eq("granted", true).limit(1);
    setClear(!!cl?.length); setView("hub");
  })(); return () => stop(); }, []);

  function stop() { tracker.current?.stop(); tracker.current = null; stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; latest.current = null; }
  function update(p: Partial<Settings>) { const n = { ...st, ...p }; setSt(n); saveSettings(n); }

  // ---- calibration ----
  function openCalibrate(from: "play" | "settings") { setCalFrom(from); setCalStep(0); setCalNeutral(null); setCalMoves({}); setCalMsg(null); setCalStatus(null); setCalCam(tracker.current ? "on" : "off"); setMsg(null); setView("calibrate"); }
  function closeCalibrate(saved: boolean) { stop(); setCalCam("off"); setCalStatus(null); setCalBusy(false); if (saved && calFrom === "play") setView("ready"); else setView(calFrom === "play" ? "hub" : "settings"); }
  async function startCal() {
    setCalCam("loading"); setCalMsg(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      stream.current = s; s.getVideoTracks()[0].onended = () => { setCalCam("off"); setCalMsg("The camera was interrupted. Tap Start camera to resume."); };
      const v = video.current!; v.srcObject = s; await v.play();
      tracker.current = await createTracker(v, f => { latest.current = f; }); setCalCam("on");
    } catch (e: any) { stop(); setCalCam("off"); setCalMsg(e?.name === "NotAllowedError" ? "Camera access is blocked. Allow it in your browser’s site settings (the lock icon by the address), then try again." : `Couldn’t start the camera: ${e?.message ?? e}`); }
  }
  async function grab(lead: number, secs: number, leadText: string, recText: string): Promise<Vals[] | null> {
    setCalBusy(true); setCalMsg(null);
    const tick = (ms: number, fn: (left: number) => void) => new Promise<void>(res => { const end = Date.now() + ms; const id = setInterval(() => { fn(Math.max(0, Math.ceil((end - Date.now()) / 1000))); if (Date.now() >= end) { clearInterval(id); res(); } }, 50); });
    await tick(lead * 1000, l => setCalStatus(`${leadText} ${l}`));
    const s: Vals[] = [];
    await tick(secs * 1000, l => { setCalStatus(`${recText} ${l}`); const fr = latest.current; if (fr?.vals && fr.q.face && fr.q.size) s.push(fr.vals); });
    setCalStatus(null); setCalBusy(false);
    if (s.length < 25) { setCalMsg("Let’s adjust your camera. We couldn’t see your face clearly, so nothing was recorded. Try more light, center your face, and record again."); return null; }
    return s;
  }
  async function doNeutral() {
    const s = await grab(2, 3, "Relax your face…", "Stay relaxed…"); if (!s) return;
    const n = {} as Record<SK, { mean: number; std: number }>;
    for (const k of SKS) { const a = s.map(x => sigs(x)[k]); n[k] = { mean: mean(a), std: sd(a) }; }
    setCalNeutral(n); setCalMoves({}); if (st.haptics) buzz(120);
  }
  async function doMove(m: M) {
    if (!calNeutral) return;
    let cands: SK[] = m === "jump" ? ["smile"] : m === "fly" ? ["brow"] : m === "duck" ? ["frown"] : ["sideA", "sideB"];
    if (m === "left") { const r = calMoves.right; if (!r?.detectable) { setCalMsg("Record the right side first."); return; } cands = [r.key === "sideA" ? "sideB" : "sideA"]; }
    const s = await grab(2, 4, "Get ready…", "Hold it gently…"); if (!s) return;
    let best: Move | null = null;
    for (const key of cands) {
      const a = s.map(x => sigs(x)[key]); const top = [...a].sort((x, y) => y - x).slice(0, Math.max(5, Math.floor(a.length / 4)));
      const nm = calNeutral[key], peak = mean(top), range = peak - nm.mean, detectable = range > Math.max(3 * nm.std, MIN[key]);
      const mv: Move = { key, nm: nm.mean, std: nm.std, peak, range, detectable };
      if (!best || mv.range / (MIN[key]) > best.range / (MIN[best.key])) best = mv;
    }
    if (best) { const b = best; setCalMoves(o => ({ ...o, [m]: b })); if (st.haptics) buzz(b.detectable ? 120 : [60, 60, 60]); }
  }
  async function saveCal() {
    const all = MOVES.every(m => calMoves[m]?.detectable); if (!all) return; setCalSaving(true); setCalMsg(null);
    const sb = supabase(); const { data: { user } } = await sb.auth.getUser(); if (!user) { location.href = "/"; return; }
    const { error } = await sb.from("dash_calibration").upsert({ user_id: user.id, summary: { version: 1, moves: calMoves, note: "Camera-derived estimates in face-size-normalised units; not clinical measurements." }, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    setCalSaving(false);
    if (error) { setCalMsg(`Couldn’t save: ${error.message}. (Run the 0007 database step in Supabase.)`); return; }
    setCal(calMoves as Cal); if (st.haptics) buzz([100, 80, 100]); closeCalibrate(true);
  }

  // ---- flow ----
  async function onPlay() { setMsg(null); if (!clear) { setView("clearance"); return; } if (!hasCal) { openCalibrate("play"); return; } setView("ready"); }
  async function confirmClearance() {
    setBusy(true); setMsg(null);
    const sb = supabase(); const { data: { user } } = await sb.auth.getUser(); if (!user) { location.href = "/"; return; }
    const { error } = await sb.from("consent_records").insert([{ user_id: user.id, kind: "exercise_clearance", granted: true, policy_version: POLICY_VERSION }, { user_id: user.id, kind: "camera_processing", granted: true, policy_version: POLICY_VERSION }]);
    setBusy(false);
    if (error) { setMsg(`Couldn’t save your confirmation: ${error.message}.`); return; }
    setClear(true); if (!hasCal) openCalibrate("play"); else setView("ready");
  }
  async function startGame() {
    if (!cal) { openCalibrate("play"); return; }
    setBusy(true); setMsg(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      stream.current = s; s.getVideoTracks()[0].onended = () => { g.current.adjust = true; };
      const v = video.current!; v.srcObject = s; await v.play();
      tracker.current = await createTracker(v, f => { latest.current = f; });
      const wh = clamp(Math.round(W * innerHeight / innerWidth), 560, 800), sc = Math.min(innerWidth / W, innerHeight / wh);
      cfg.current = { len: st.len, start: st.start, ramp: st.ramp, gain: 1.3, haptics: st.haptics }; liveGain.current = 1.3; setGainUi(1.3);
      g.current = fresh(wh); setBox({ w: W * sc, h: wh * sc });
      setUi(u => ({ ...u, stage: "ready", ready: 6, left: st.len, dist: 0, coins: 0, mul: 1, adjust: false, paused: false, hint: "", stumble: false })); setView("play");
    } catch (e: any) { stop(); setMsg(e?.name === "NotAllowedError" ? "Camera access is blocked. Allow it in your browser’s site settings, then try again." : `Couldn’t start the camera: ${e?.message ?? e}`); setView("hub"); }
    setBusy(false);
  }
  async function finish(completed: boolean) {
    const s = g.current; stop();
    const r: Result = { points: s.points, distance: Math.round(s.dist), coins: s.coinsGot, cleared: s.cleared, stumbles: s.stumbles, bestStreak: s.best, topSpeed: Math.round(s.top * 10) / 10, seconds: Math.round(s.t), completed, counts: { ...s.counts }, saved: false };
    setResult(r); setView("results");
    try {
      const sb = supabase(); const { data: { user } } = await sb.auth.getUser(); if (!user) return;
      const { error } = await sb.from("dash_games").insert({ user_id: user.id, duration_seconds: r.seconds, points: r.points, distance: r.distance, coins: r.coins, cleared: r.cleared, stumbles: r.stumbles, best_streak: r.bestStreak, top_speed: r.topSpeed, completed, per_move: { counts: s.counts, clearedBy: s.clearedBy, stumbledBy: s.stumbledBy }, settings: { len: cfg.current.len, start: cfg.current.start, ramp: cfg.current.ramp } });
      if (error) { setMsg(`This run couldn’t be saved: ${error.message}`); return; }
      setResult(x => x && { ...x, saved: true });
    } catch (e: any) { setMsg(`This run couldn’t be saved: ${e?.message ?? e}`); }
  }
  async function openStats() {
    setView("stats"); setGames(null);
    const { data } = await supabase().from("dash_games").select("id,played_at,duration_seconds,points,distance,coins,cleared,stumbles,best_streak,top_speed,completed,per_move").order("played_at", { ascending: false }).limit(200);
    setGames((data as GameRow[]) ?? []);
  }

  // ---- game loop ----
  useEffect(() => {
    if (view !== "play") return;
    const cv = cvRef.current; if (!cv) return; const ctx = cv.getContext("2d")!, wh = g.current.wh, d = Math.min(2, devicePixelRatio || 1);
    cv.width = W * d; cv.height = wh * d; ctx.setTransform(d, 0, 0, d, 0, 0);
    const fit = () => { const sc = Math.min(innerWidth / W, innerHeight / wh); setBox({ w: W * sc, h: wh * sc }); };
    addEventListener("resize", fit);
    const prevScroll = document.body.style.overflow; document.body.style.overflow = "hidden";
    let raf = 0, prev = performance.now(), finished = false;
    const step = (dt: number, now: number) => {
      const s = g.current, fr = latest.current;
      if (s.manual || s.stage === "done") return;
      if (!(fr && fr.vals && fr.q.face && fr.q.size)) { if (s.lostSince == null) s.lostSince = now; if (now - s.lostSince > 600 && !s.adjust) s.adjust = true; return; }
      s.lostSince = null; s.adjust = false;
      const cal = calRef.current; if (!cal) return; const sg = sigs(fr.vals), edge: Record<M, boolean> = { jump: false, fly: false, duck: false, right: false, left: false };
      for (const m of MOVES) {
        const c = cal[m]; let l = clamp(liveGain.current * (sg[c.key] - c.nm) / c.range, 0, 1); if (l < .1) l = 0;
        s.lev[m] += (l - s.lev[m]) * .5; const was = s.on[m], on = was ? s.lev[m] >= .3 : s.lev[m] >= .55; s.on[m] = on; edge[m] = on && !was;
      }
      if (s.stage === "ready") { s.readyLeft -= dt; if (s.readyLeft <= 0) { s.stage = "play"; if (cfg.current.haptics) buzz(150); } return; }
      const { len, start, ramp } = cfg.current;
      s.t += dt; const prog = clamp(s.t / len, 0, 1);
      s.mul += (1 - s.mul) * Math.min(1, dt * .7);
      const base = start * (1 + (ramp - 1) * prog), v = base * s.mul; s.speed = v; s.top = Math.max(s.top, base); s.dist += v * dt;
      s.cd -= dt; s.invuln = Math.max(0, s.invuln - dt);
      if (s.cd <= 0 && edge.right && s.lane < 2) { s.lane++; s.cd = .22; s.counts.right++; }
      else if (s.cd <= 0 && edge.left && s.lane > 0) { s.lane--; s.cd = .22; s.counts.left++; }
      if (edge.jump && s.jumpT <= 0 && s.jet < .3) { s.jumpT = .7; s.counts.jump++; }
      if (edge.duck && s.jumpT <= 0 && s.jet < .3) { s.crouchT = .55; s.counts.duck++; }
      else if (s.on.duck && s.crouchT > 0) s.crouchT = Math.max(s.crouchT, .15);
      s.crouchT = Math.max(0, s.crouchT - dt); s.jumpT = Math.max(0, s.jumpT - dt);
      if (s.on.fly && s.fuel > 0) { if (edge.fly) s.counts.fly++; s.jet = Math.min(1.1, s.jet + dt * 4); s.fuel -= dt / 2.6; }
      else { s.jet = Math.max(0, s.jet - dt * 3.5); if (!s.on.fly) s.fuel = Math.min(1, s.fuel + dt / 5); }
      const jumpH = s.jumpT > 0 ? Math.sin(Math.PI * (1 - s.jumpT / .7)) : 0, h = Math.max(jumpH, Math.min(1, s.jet)), crouch = s.crouchT > 0 && h < .1;
      s.lanePos += (s.lane - s.lanePos) * Math.min(1, dt * 10);
      while (s.spawnZ < s.dist + 95) spawnRow(s, len);
      let hint = "";
      for (const r of s.rows) {
        const dd = r.z - s.dist;
        if (r.threat == null && dd < 38) r.threat = r.lanes.includes(s.lane);
        if (!r.zone && dd < 1.2 && dd > -1.2) r.zone = true;
        if (r.zone && !r.hit && dd > -1 && dd < .9 && s.invuln <= 0 && r.lanes.some(l => Math.abs(s.lanePos - l) < .55)) {
          const hit = r.kind === "hurdle" ? h < .5 : r.kind === "bar" ? !crouch && s.jet < .8 : s.jet < .8;
          if (hit) { r.hit = true; s.mul = .55; s.invuln = 1.4; s.streak = 0; s.stumbles++; s.stumbledBy[r.kind] = (s.stumbledBy[r.kind] ?? 0) + 1; if (cfg.current.haptics) buzz(90); }
        }
        if (!r.done && dd < -1.2) { r.done = true; if (!r.hit && r.threat) { s.cleared++; s.points += 10; s.streak++; s.best = Math.max(s.best, s.streak); s.clearedBy[r.kind] = (s.clearedBy[r.kind] ?? 0) + 1; } }
        if (!hint && !r.done && dd > 0 && dd < 45 && r.lanes.includes(s.lane) && !r.hit) {
          if (r.kind === "hurdle") hint = "😊 Smile to jump";
          else if (r.kind === "bar") hint = "☹️ Frown to duck";
          else if (r.kind === "full") hint = "🤨 Raise your eyebrows to fly";
          else { const free = [0, 1, 2].filter(l => !r.lanes.includes(l)).sort((a, b) => Math.abs(a - s.lane) - Math.abs(b - s.lane))[0]; hint = free == null ? "🤨 Raise your eyebrows to fly" : free > s.lane ? "😗 Pucker to your right" : "😗 Pucker to your left"; }
        }
      }
      s.hint = hint;
      for (const c of s.coins) if (!c.got) { const dd = c.z - s.dist; if (dd < .9 && dd > -.9 && Math.abs(s.lanePos - c.lane) < .6 && Math.abs(h - c.cy) < .5) { c.got = true; s.coinsGot++; s.points += 5; } }
      s.points = Math.max(s.points, 0);
      if (s.rows.length > 14) s.rows = s.rows.filter(r => r.z - s.dist > -8);
      if (s.coins.length > 60) s.coins = s.coins.filter(c => c.z - s.dist > -8);
      if (s.t >= len && !finished) { finished = true; s.stage = "done"; finish(true); }
    };
    const loop = (now: number) => { raf = requestAnimationFrame(loop); const dt = Math.min(.05, (now - prev) / 1000); prev = now; step(dt, now); drawWorld(ctx, g.current, now); };
    raf = requestAnimationFrame(loop);
    const id = setInterval(() => { const s = g.current; setUi(u => ({ ...u, stage: s.stage, ready: Math.max(0, Math.ceil(s.readyLeft)), left: Math.max(0, Math.ceil(cfg.current.len - s.t)), dist: Math.round(s.dist), coins: s.coinsGot, mul: Math.round(s.speed / cfg.current.start * 10) / 10, adjust: s.adjust, paused: s.manual, hint: s.hint, lev: { ...s.lev }, on: { ...s.on }, stumble: s.invuln > 0 })); }, 100);
    return () => { cancelAnimationFrame(raf); clearInterval(id); removeEventListener("resize", fit); document.body.style.overflow = prevScroll; };
  }, [view]);

  useEffect(() => {
    if (view !== "calibrate") return;
    const cv = calCv.current; if (cv) { cv.width = 320; cv.height = 240; }
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw); const c = calCv.current, v = video.current; if (!c || !v || v.readyState < 2 || !stream.current || !v.videoWidth) return;
      const x = c.getContext("2d")!, sc = Math.max(320 / v.videoWidth, 240 / v.videoHeight), dw = v.videoWidth * sc, dh = v.videoHeight * sc;
      x.save(); x.translate(320, 0); x.scale(-1, 1); x.drawImage(v, (320 - dw) / 2, (240 - dh) / 2, dw, dh); x.restore();
    };
    raf = requestAnimationFrame(draw);
    const id = setInterval(() => { const fr = latest.current; setCalQ(fr ? { face: fr.q.face, size: fr.q.size, light: fr.q.light } : null); }, 200);
    return () => { cancelAnimationFrame(raf); clearInterval(id); };
  }, [view]);

  const ios = typeof navigator !== "undefined" && /iPhone|iPad/.test(navigator.userAgent) && !(navigator as any).standalone;
  const videoEl = <video ref={video} playsInline muted aria-label="Your camera preview (mirrored)"
    className={view === "play" && preview ? "fixed z-40 -scale-x-100 rounded-2xl object-cover shadow-soft" : "pointer-events-none fixed left-0 top-0 h-1 w-1 opacity-[0.02]"}
    style={view === "play" && preview ? { right: 12, top: `calc(env(safe-area-inset-top, 0px) + ${TOPBAR + 8}px)`, width: 84, height: 63 } : undefined} />;
  const choice = (on: boolean) => `rounded-2xl border ${on ? "border-teal bg-teal/10 shadow-soft" : "border-navy/15 bg-paper"}`;

  const body = () => {
    if (view === "loading") return <main className="grid min-h-dvh place-items-center text-navy/60">Loading…</main>;

    if (view === "clearance") return (
      <Page><h1 className="font-display text-3xl">Before you start</h1>
        <p className="mt-3 text-navy/70">Mirror Dash asks you to make quick, gentle facial movements. Only continue if your clinician says facial exercises are okay for you, and stop any time you feel discomfort or strain.</p>
        <p className="mt-3 text-navy/70">Your camera is used only while you play. It’s processed on your device, and video is never uploaded or saved.</p>
        <label className="mt-5 flex items-start gap-3 rounded-2xl bg-gold/20 p-4 text-sm"><input type="checkbox" className="mt-1 h-5 w-5 accent-teal" checked={agree} onChange={e => setAgree(e.target.checked)} />
          <span>My clinician has said gentle facial exercises are okay for me, and I understand I can stop at any time.</span></label>
        {msg && <p role="alert" className="mt-3 rounded-2xl bg-lav/40 p-3 text-sm">{msg}</p>}
        <button className="btn-primary mt-5 w-full" disabled={!agree || busy} onClick={confirmClearance}>{busy ? "Saving…" : "Continue"}</button>
        <button className="btn-quiet mt-3 w-full" onClick={() => setView("hub")}>Back</button></Page>);

    if (view === "ready") return (
      <Page><h1 className="font-display text-3xl">How to play</h1>
        <p className="mt-2 text-navy/70">Your runner keeps running. Use these five movements to dodge, jump and fly. The run gets faster as it goes.</p>
        <ul className="mt-4 grid gap-2">{MOVES.map(m => <li key={m} className="flex items-center gap-3 rounded-2xl bg-paper p-3 shadow-soft"><span className="text-4xl" aria-hidden>{INFO[m].icon}</span><span className="flex-1"><b>{INFO[m].action}</b><br /><span className="text-sm text-navy/70">{INFO[m].name}</span></span></li>)}</ul>
        <p className="mt-3 text-xs text-navy/60">Bumps never end your run. You just stumble and slow down for a moment.</p>
        {msg && <p role="alert" className="mt-3 rounded-2xl bg-lav/40 p-3 text-sm">{msg}</p>}
        <button className="btn-primary mt-5 min-h-[64px] w-full text-xl" disabled={busy} onClick={startGame}>{busy ? "Starting camera…" : "Start running"}</button>
        <button className="btn-quiet mt-3 w-full" onClick={() => setView("hub")}>Back</button></Page>);

    if (view === "calibrate") {
      const sm: M | "rest" | null = calStep === 1 ? "rest" : calStep >= 2 && calStep <= 6 ? MOVES[[0, 1, 2, 3, 4][calStep - 2]] : null;
      const rec = sm && sm !== "rest" ? calMoves[sm] : undefined, allOk = MOVES.every(m => calMoves[m]?.detectable);
      const chip = (ok: boolean, t: string) => <span className={`rounded-full px-3 py-1 text-xs ${ok ? "bg-sage/40" : "bg-gold/30"}`}>{t}</span>;
      const canNext = calStep === 0 ? calCam === "on" : calStep === 1 ? !!calNeutral : calStep >= 2 && calStep <= 6 ? !!rec?.detectable : true;
      const title = calStep === 0 ? "Set up your camera" : calStep === 1 ? "Relaxed face" : calStep === 7 ? "All set?" : INFO[sm as M].name;
      return (
        <Page>
          <div className="flex gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={8} aria-valuenow={calStep + 1} aria-label={`Step ${calStep + 1} of 8`}>{Array.from({ length: 8 }, (_, n) => <div key={n} className={`h-1.5 flex-1 rounded-full ${n <= calStep ? "bg-teal" : "bg-mist"}`} />)}</div>
          <h1 className="mt-5 font-display text-3xl">{title}</h1>
          {calStep <= 6 && <>
            <canvas ref={calCv} className="mt-4 w-full rounded-3xl bg-navy/90 shadow-soft" style={{ aspectRatio: "4 / 3" }} aria-label="Your camera preview (mirrored)" />
            <div className="mt-3 flex flex-wrap gap-2" aria-live="polite">{chip(!!calQ?.face, calQ?.face ? "Face visible" : "No face yet")}{chip(!!calQ?.size, "Distance")}{chip(!!calQ?.light, "Lighting")}</div></>}
          {calStatus && <p role="status" className="mt-3 rounded-2xl bg-teal/15 p-4 text-center font-display text-2xl">{calStatus}</p>}
          {calMsg && <p role="alert" className="mt-3 rounded-2xl bg-lav/40 p-3 text-sm">{calMsg}</p>}
          {calStep === 0 && <section className="mt-4"><p className="text-navy/70">Your camera is processed on this device. Video is never uploaded or saved. We’ll record your relaxed face, then each of the five movements once. Go gently.</p>
            <button className="btn-primary mt-4 min-h-[60px] w-full text-lg" disabled={calCam !== "off"} onClick={startCal}>{calCam === "loading" ? "Starting camera…" : calCam === "on" ? "Camera is on ✓" : "Start camera"}</button></section>}
          {calStep === 1 && <section className="mt-4 flex flex-col items-center text-center"><div className="text-7xl" aria-hidden>😐</div>
            <p className="mt-3 text-lg">Look at the camera with a comfortable, relaxed face.</p>
            <button className="btn-primary mt-4 min-h-[60px] w-full text-lg" disabled={calBusy || calCam !== "on"} onClick={doNeutral}>{calNeutral ? "Record again" : "Record relaxed face (3 seconds)"}</button>
            {calNeutral && !calBusy && <p className="mt-3 text-sm text-navy/70">Got it. Your relaxed face is recorded.</p>}</section>}
          {calStep >= 2 && calStep <= 6 && sm && sm !== "rest" && <section className="mt-4 flex flex-col items-center text-center"><div className="text-7xl" aria-hidden>{INFO[sm].icon}</div>
            <p className="mt-3 text-xl">{INFO[sm].cue}</p><p className="mt-1 text-sm text-navy/70">{INFO[sm].tip}</p>
            <button className="btn-primary mt-4 min-h-[60px] w-full text-lg" disabled={calBusy || calCam !== "on"} onClick={() => doMove(sm)}>{rec ? "Record again" : "Record (4 seconds)"}</button>
            {rec && !calBusy && <p className="mt-3 text-sm text-navy/70">{rec.detectable ? "Great. We picked up a clear movement." : "We couldn’t pick up a clear change this time. That’s okay. Try again, a little more or slower."}</p>}</section>}
          {calStep === 7 && <section className="mt-4"><ul className="grid gap-2">{MOVES.map(m => { const mv = calMoves[m]; return (
            <li key={m} className="flex items-center gap-3 rounded-2xl bg-paper p-3 shadow-soft"><span className="text-3xl" aria-hidden>{INFO[m].icon}</span><span className="flex-1">{INFO[m].action}</span><span className="text-sm text-navy/70">{mv?.detectable ? "Ready ✓" : mv ? "Not detected" : "Not recorded"}</span></li>); })}</ul>
            <p className="mt-3 text-xs text-navy/60">Mirror Dash uses all five movements. You can recalibrate any time from Settings.</p>
            <button className="btn-primary mt-4 min-h-[60px] w-full text-lg" disabled={!allOk || calSaving} onClick={saveCal}>{calSaving ? "Saving…" : "Save calibration"}</button>
            {!allOk && <p className="mt-2 text-sm text-navy/70">Go back and record any movement that isn’t marked Ready.</p>}</section>}
          <div className="mt-6 flex gap-3">
            <button className="btn-quiet" disabled={calBusy || calSaving} onClick={() => (calStep === 0 ? closeCalibrate(false) : setCalStep(calStep - 1))}>{calStep === 0 ? "Cancel" : "Back"}</button>
            {calStep < 7 && <button className="btn-primary flex-1" disabled={calBusy || !canNext} onClick={() => setCalStep(calStep + 1)}>Next</button>}
          </div>
        </Page>);
    }

    if (view === "settings") return (
      <Page><h1 className="font-display text-3xl">Settings</h1>
        <section className="mt-5 rounded-3xl bg-paper p-5 shadow-soft"><h2 className="font-display text-xl">1. Calibrate</h2>
          <p className="mt-1 text-sm text-navy/70">{hasCal ? "Ready: all five movements." : "Not set up yet. Calibrating teaches the game your own comfortable movements."}</p>
          <button className="btn-primary mt-3 w-full" onClick={() => openCalibrate("settings")}>{hasCal ? "Recalibrate" : "Calibrate"}</button></section>
        <section className="mt-3 rounded-3xl bg-paper p-5 shadow-soft"><h2 className="font-display text-xl">2. Run length</h2>
          <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Run length">{LENS.map(v => <button key={v} role="radio" aria-checked={st.len === v} onClick={() => update({ len: v })} className={`min-h-[56px] ${choice(st.len === v)}`}>{v}s</button>)}</div></section>
        <section className="mt-3 rounded-3xl bg-paper p-5 shadow-soft"><h2 className="font-display text-xl">3. Starting speed</h2>
          <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Starting speed">{STARTS.map(x => <button key={x.v} role="radio" aria-checked={st.start === x.v} onClick={() => update({ start: x.v })} className={`min-h-[56px] ${choice(st.start === x.v)}`}>{x.n}</button>)}</div></section>
        <section className="mt-3 rounded-3xl bg-paper p-5 shadow-soft"><h2 className="font-display text-xl">4. How much it speeds up</h2>
          <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Speed increase">{RAMPS.map(x => <button key={x.v} role="radio" aria-checked={st.ramp === x.v} onClick={() => update({ ramp: x.v })} className={`min-h-[56px] ${choice(st.ramp === x.v)}`}>{x.n}</button>)}</div>
          <p className="mt-2 text-xs text-navy/60">By the end of the run you’ll be going about {st.ramp}× your starting speed.</p></section>
        <label className="mt-3 flex items-center justify-between gap-4 rounded-3xl bg-paper p-5 shadow-soft"><span><b>5. Hints</b><br /><span className="text-sm text-navy/60">Show which movement to make for the next obstacle.</span></span>
          <input type="checkbox" className="h-7 w-7 accent-teal" checked={st.hints} onChange={e => update({ hints: e.target.checked })} aria-label="Hints" /></label>
        <label className="mt-3 flex items-center justify-between gap-4 rounded-3xl bg-paper p-5 shadow-soft"><span><b>6. Vibration</b><br /><span className="text-sm text-navy/60">Buzz after calibration steps, at the start, and when you stumble. Works on phones that allow it.</span></span>
          <input type="checkbox" className="h-7 w-7 accent-teal" checked={st.haptics} onChange={e => update({ haptics: e.target.checked })} aria-label="Vibration" /></label>
        <button className="btn-primary mt-4 w-full" onClick={() => setView("hub")}>Done</button></Page>);

    if (view === "stats") {
      const gs = games ?? [], done = gs.length, best = (f: (x: GameRow) => number) => gs.reduce((m, x) => Math.max(m, f(x)), 0);
      const tiles: [string, string][] = [["Runs", String(done)], ["Best distance", `${best(x => x.distance)} m`], ["Best points", String(best(x => x.points))], ["Total coins", String(gs.reduce((n, x) => n + x.coins, 0))], ["Top speed", `${best(x => Number(x.top_speed ?? 0)).toFixed(1)}`], ["Best streak", String(best(x => x.best_streak))]];
      const tot = z5() as Record<M, number>; for (const x of gs) for (const m of MOVES) tot[m] += x.per_move?.counts?.[m] ?? 0; const mx = Math.max(1, ...MOVES.map(m => tot[m]));
      const rows = gs.slice(0, 12).reverse(), dm = Math.max(1, ...rows.map(x => x.distance));
      return (
        <Page><h1 className="font-display text-3xl">Your stats</h1>
          <button className="btn-primary mt-4 min-h-[60px] w-full text-lg" onClick={onPlay}>Play game</button>
          {games === null && <p className="mt-6 text-navy/60">Loading…</p>}
          {games && done === 0 && <p className="mt-6 rounded-2xl bg-paper p-5 text-navy/70 shadow-soft">No runs yet. Your first one will show up here.</p>}
          {done > 0 && <>
            <dl className="mt-5 grid grid-cols-2 gap-3">{tiles.map(([k, v]) => <div key={k} className="rounded-2xl bg-paper p-4 shadow-soft"><dd className="font-display text-3xl">{v}</dd><dt className="text-xs text-navy/60">{k}</dt></div>)}</dl>
            <section className="mt-6 rounded-3xl bg-paper p-5 shadow-soft"><h2 className="font-display text-xl">Distance, last {rows.length} runs</h2>
              <div className="mt-3 grid gap-2">{rows.map(x => <div key={x.id} className="flex items-center gap-3 text-sm"><span className="w-14 text-navy/60">{fmtDate(x.played_at)}</span><div className="h-3 flex-1 rounded-full bg-mist"><div className="h-3 rounded-r-full bg-teal" style={{ width: `${Math.max(2, x.distance / dm * 100)}%` }} /></div><span className="w-14 text-right">{x.distance} m</span></div>)}</div></section>
            <section className="mt-4 rounded-3xl bg-paper p-5 shadow-soft"><h2 className="font-display text-xl">Movements made</h2><p className="text-xs text-navy/60">Total times across all runs.</p>
              <div className="mt-3 grid gap-3">{MOVES.map(m => <div key={m}><div className="flex justify-between text-sm"><span>{INFO[m].icon} {INFO[m].action}</span><span>{tot[m]}</span></div><div className="mt-1 h-2.5 rounded-full bg-mist"><div className="h-2.5 rounded-r-full bg-teal" style={{ width: `${tot[m] / mx * 100}%` }} /></div></div>)}</div></section>
            <section className="mt-4 rounded-3xl bg-paper p-5 shadow-soft"><h2 className="font-display text-xl">Recent runs</h2>
              <ul className="mt-3 grid gap-3 text-sm">{gs.slice(0, 8).map(x => <li key={x.id} className="flex justify-between gap-3"><span>{fmtDate(x.played_at)} · {x.points} pts{x.completed ? "" : " (ended early)"}</span><span className="text-right text-navy/60">{x.distance} m · {x.coins} coins · {x.cleared} cleared · {x.stumbles} stumbles</span></li>)}</ul></section></>}
          <button className="btn-quiet mt-6 w-full" onClick={() => setView("hub")}>Back</button></Page>);
    }

    if (view === "results" && result) {
      const R = result;
      return (
        <Page><h1 className="font-display text-3xl">{R.completed ? "Run complete." : "Run ended early."}</h1>
          <p className="mt-2 text-navy/70">Nice work. Every run counts.</p>
          <div className="mt-5 grid grid-cols-2 gap-3">{([["Points", String(R.points)], ["Distance", `${R.distance} m`], ["Coins", String(R.coins)], ["Obstacles cleared", String(R.cleared)], ["Stumbles", String(R.stumbles)], ["Top speed", `${R.topSpeed.toFixed(1)}`]] as [string, string][]).map(([k, v]) => <div key={k} className="rounded-2xl bg-paper p-4 shadow-soft"><div className="font-display text-3xl">{v}</div><div className="text-xs text-navy/60">{k}</div></div>)}
            <div className="col-span-2 rounded-2xl bg-paper p-4 shadow-soft"><div className="font-display text-3xl">{R.bestStreak}</div><div className="text-xs text-navy/60">Best streak (obstacles cleared in a row)</div></div></div>
          <section className="mt-5 rounded-3xl bg-paper p-5 shadow-soft"><h2 className="font-display text-xl">Movements made</h2>
            <ul className="mt-3 grid gap-2">{MOVES.map(m => <li key={m} className="flex items-center gap-3 text-sm"><span className="text-2xl" aria-hidden>{INFO[m].icon}</span><span className="flex-1">{INFO[m].action}</span><b>{R.counts[m]}</b></li>)}</ul></section>
          {!R.saved && <p role="alert" className="mt-4 rounded-2xl bg-lav/40 p-4 text-sm">{msg ?? "Saving this run…"}</p>}
          <button className="btn-primary mt-6 min-h-[60px] w-full text-lg" onClick={onPlay}>Run again</button>
          <button className="btn-quiet mt-3 w-full" onClick={openStats}>See my stats</button>
          <button className="btn-quiet mt-3 w-full" onClick={() => setView("hub")}>Home</button></Page>);
    }

    if (view === "play") return (
      <div className="fixed inset-0 touch-none bg-[#8fd3f4]" style={{ height: "100dvh" }}>
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ width: box.w, height: box.h }}>
          <canvas ref={cvRef} style={{ width: "100%", height: "100%" }} aria-label="Three-lane runner. Use your facial movements to dodge, jump, duck and fly." />
        </div>
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center">
          <div className="w-full rounded-b-3xl bg-paper/95 shadow-soft" style={{ maxWidth: Math.max(box.w, 320), paddingTop: "env(safe-area-inset-top, 0px)" }}>
            <div className="flex items-center justify-between gap-2 px-4" style={{ height: TOPBAR }} role="status">
              <div><div className="font-display text-3xl leading-none">{ui.dist}<span className="text-base"> m</span></div><div className="text-xs text-navy/60">Speed ×{ui.mul.toFixed(1)}</div></div>
              <div className="text-center"><div className="font-display text-3xl leading-none">🪙 {ui.coins}</div><div className="text-xs text-navy/60">coins</div></div>
              <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full border-4 border-teal text-2xl font-bold" aria-label={`${ui.left} seconds left`}>{ui.left}</div>
            </div></div></div>
        {st.hints && ui.stage === "play" && ui.hint && <div className="pointer-events-none absolute inset-x-0 z-20 flex justify-center px-4" style={{ top: `calc(env(safe-area-inset-top, 0px) + ${TOPBAR + 10}px)` }}><div className="rounded-full bg-navy/85 px-5 py-2 text-lg text-ivory shadow-soft" role="status">{ui.hint}</div></div>}
        {ui.stumble && ui.stage === "play" && <div className="pointer-events-none absolute inset-x-0 z-20 text-center text-sm font-semibold text-navy" style={{ top: `calc(env(safe-area-inset-top, 0px) + ${TOPBAR + 56}px)` }}>Stumble. Keep going!</div>}
        <button aria-label="Pause" onClick={() => { g.current.manual = true; }} className="absolute z-20 grid h-14 w-14 place-items-center rounded-full bg-paper/90 shadow-soft" style={{ left: 12, top: `calc(env(safe-area-inset-top, 0px) + ${TOPBAR + 10}px)` }}>
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden><rect x="4" y="3" width="5" height="16" rx="1.5" fill="#1B2A3A" /><rect x="13" y="3" width="5" height="16" rx="1.5" fill="#1B2A3A" /></svg></button>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center pb-[max(10px,env(safe-area-inset-bottom))]"><div className="grid w-full grid-cols-5 gap-1.5 px-2" style={{ maxWidth: Math.max(box.w, 320) }}>
          {MOVES.map(m => <div key={m} className={`flex flex-col items-center rounded-2xl px-1 py-2 text-center text-[11px] leading-tight shadow-soft ${ui.on[m] ? "bg-teal text-ivory" : "bg-paper/90 text-navy"}`}><span className="text-2xl" aria-hidden>{INFO[m].icon}</span><span className="mt-0.5 whitespace-pre-line">{SHORT[m]}</span>
            <span className="mt-1 h-1.5 w-full rounded-full bg-navy/15"><span className="block h-1.5 rounded-full bg-gold" style={{ width: `${Math.round(ui.lev[m] * 100)}%` }} /></span></div>)}</div></div>
        {ui.stage === "ready" && !ui.paused && !ui.adjust && <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-navy/85 px-6 text-center text-ivory" role="status">
          <h2 className="font-display text-4xl">Get ready</h2>
          <ul className="mt-4 grid w-full max-w-xs gap-2 text-left">{MOVES.map(m => <li key={m} className="flex items-center gap-3 rounded-2xl bg-ivory/10 px-3 py-2"><span className="text-3xl" aria-hidden>{INFO[m].icon}</span><span className="text-lg">{INFO[m].action}</span></li>)}</ul>
          <p className="mt-5 font-display text-3xl">Starting in {ui.ready}</p>
          <button className="btn-primary mt-4 bg-ivory !text-navy" onClick={() => { g.current.readyLeft = 0; }}>I’m ready, start now</button></div>}
        {ui.adjust && !ui.paused && <div className="absolute inset-0 z-40 grid place-items-center bg-navy/70 p-8 text-center text-ivory" role="alert"><div><p className="font-display text-3xl">Let’s adjust your camera</p>
          <p className="mt-3 text-base">We can’t see your face clearly. Center it and add light. The game waits, and nothing is counted against you.</p></div></div>}
        {ui.paused && <div className="absolute inset-0 z-50 grid place-items-center bg-navy/75 p-6 text-ivory" role="dialog" aria-label="Paused"><div className="w-full max-w-xs text-center">
          <p className="font-display text-3xl">Paused</p><p className="mt-1 text-sm text-ivory/75">Take as long as you need.</p>
          <button className="btn-primary mt-5 w-full bg-ivory !text-navy" onClick={() => { g.current.manual = false; }}>Resume</button>
          <div className="mt-4 rounded-2xl bg-ivory/10 p-3 text-sm"><p>Sensitivity {Math.max(1, GAINS.indexOf(gainUi) + 1)} of 5</p><p className="text-xs text-ivory/70">Movements not registering? Try Easier.</p>
            <div className="mt-2 grid grid-cols-2 gap-2"><button className="btn-quiet min-h-[48px]" onClick={() => { const v = GAINS[Math.min(4, Math.max(0, GAINS.indexOf(gainUi)) + 1)]; liveGain.current = v; setGainUi(v); }}>Easier</button>
              <button className="btn-quiet min-h-[48px]" onClick={() => { const v = GAINS[Math.max(0, Math.max(0, GAINS.indexOf(gainUi)) - 1)]; liveGain.current = v; setGainUi(v); }}>Harder</button></div></div>
          <button className="btn-quiet mt-3 w-full" onClick={() => setPreview(p => !p)}>{preview ? "Hide camera preview" : "Show camera preview"}</button>
          <button className="btn-quiet mt-3 w-full" onClick={() => finish(false)}>End run</button></div></div>}
      </div>);

    // hub
    return (
      <Page>
        <a href="/dashboard" className="text-sm text-navy/60">← Home</a>
        <svg viewBox="0 0 240 130" className="mt-4 w-full rounded-3xl shadow-soft" aria-hidden><rect width="240" height="130" fill="#8fd3f4" /><polygon points="90,40 150,40 215,130 25,130" fill="#657384" /><line x1="110" y1="40" x2="95" y2="130" stroke="#fff" strokeOpacity=".6" strokeWidth="2" /><line x1="130" y1="40" x2="145" y2="130" stroke="#fff" strokeOpacity=".6" strokeWidth="2" />
          <rect x="108" y="78" width="24" height="12" fill="#f2994a" stroke="#2b3340" strokeWidth="2" /><circle cx="120" cy="104" r="9" fill="#f2c9a0" stroke="#2b3340" strokeWidth="2" /><rect x="111" y="112" width="18" height="16" rx="4" fill="#4E8A86" stroke="#2b3340" strokeWidth="2" /></svg>
        <h1 className="mt-5 font-display text-4xl">Mirror Dash</h1>
        <p className="mt-2 text-navy/70">A fast three-lane runner for when you’re ready for a challenge. Smile to jump, raise your eyebrows to fly, frown to duck, and pucker left or right to switch lanes.</p>
        {msg && <p role="alert" className="mt-3 rounded-2xl bg-lav/40 p-3 text-sm">{msg}</p>}
        <button className="btn-primary mt-5 min-h-[64px] w-full text-xl" onClick={onPlay}>Play game</button>
        {!hasCal && <p className="mt-2 text-center text-xs text-navy/60">First time? We’ll set up your camera next.</p>}
        <div className="mt-3 grid grid-cols-2 gap-3"><button className="btn-quiet min-h-[56px]" onClick={openStats}>Stats</button><button className="btn-quiet min-h-[56px]" onClick={() => setView("settings")}>Settings</button></div>
        {ios && <p className="mt-6 rounded-2xl bg-lav/30 p-4 text-xs text-navy/70">For the full-screen version on iPhone: tap the Share button in Safari, choose <b>Add to Home Screen</b>, then open SmileQuest from your home screen.</p>}
      </Page>);
  };
  return <>{videoEl}{body()}</>;
}
