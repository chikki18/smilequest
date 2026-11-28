"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { createTracker, type Frame, type Vals } from "@/lib/tracking";
import { POLICY_VERSION } from "@/lib/onboarding";
import { dailyDue, dailyUrl } from "@/lib/daily";

// ---------- moves ----------
type M = "tright" | "tleft" | "tout";
const MOVES: M[] = ["tleft", "tout", "tright"];
type SK = "tonA" | "tonB" | "tongue";
type Move = { key: SK; nm: number; std: number; peak: number; range: number; detectable: boolean };
type Cal = Partial<Record<M, Move>>;
const INFO: Record<M, { name: string; action: string; tip: string; short: string }> = {
  tright: { name: "Tongue swipe right", action: "Swipe right", tip: "Point your tongue to the right. It slices the fruit on the right side of the screen.", short: "Swipe\nRight" },
  tleft: { name: "Tongue swipe left", action: "Swipe left", tip: "Point your tongue to the left. It slices the fruit on the left side of the screen.", short: "Swipe\nLeft" },
  tout: { name: "Tongue out", action: "Poke", tip: "Open your mouth and stick your tongue out. It slices the big golden watermelon in the middle.", short: "Tongue\nOut" },
};
const sigs = (v: Vals): Record<SK, number> => ({ tonA: v.tonA, tonB: v.tonB, tongue: v.tongue });
const calOk = (c: Cal | null) => !!c && MOVES.every(m => c[m]?.detectable);

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const buzz = (p: number | number[]) => { try { if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(p); } catch { /* not supported */ } };
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

// ---------- settings ----------
type Settings = { len: number; hints: boolean; haptics: boolean; spiky: boolean };
const LENS = [60, 90, 120];
const GAINS = [1, 1.3, 1.7, 2.2, 3];
const DEF: Settings = { len: 60, hints: true, haptics: true, spiky: true };
const SKEY = "smilequest.slice.settings";
function loadSettings(): Settings { try { const j = JSON.parse(localStorage.getItem(SKEY) || "null"); if (j) return { ...DEF, ...j, len: LENS.includes(j.len) ? j.len : DEF.len }; } catch { /* ignore */ } return DEF; }
function saveSettings(s: Settings) { try { localStorage.setItem(SKEY, JSON.stringify(s)); } catch { /* ignore */ } }

// ---------- world ----------
const W = 360, GRAV = 700, FR = 34;
const bonus = (n: number) => (n >= 2 ? 10 * (n - 1) * n / 2 : 0);   // 2 fruit +10, 3 +30, 4 +60, 5 +100 ...
const KINDS = [
  { rind: "#d93a42", flesh: "#fff1c9", dark: "#9c1f27" },   // apple
  { rind: "#ff9a1f", flesh: "#ffc566", dark: "#c46a00" },   // orange
  { rind: "#2f9e44", flesh: "#ff5a6e", dark: "#1c6b2c" },   // watermelon
  { rind: "#f5d93a", flesh: "#fff7b0", dark: "#b99a00" },   // lemon
  { rind: "#7048e8", flesh: "#d0bfff", dark: "#4527b0" },   // plum
  { rind: "#8a6b3b", flesh: "#94d82d", dark: "#5c4521" },   // kiwi
];
type Fruit = { id: number; kind: number; x: number; y: number; vx: number; vy: number; r: number; rot: number; vr: number; bomb: boolean; big: boolean; half: 0 | 1 | 2; cut: number; life: number };
type Part = { x: number; y: number; vx: number; vy: number; life: number; max: number; col: string; r: number };
type Pop = { x: number; y: number; text: string; t: number; col: string };
type Fx = { kind: "swipe" | "poke"; dir: number; t0: number };
type Per = Record<M, { uses: number; hits: number; fruits: number }>;
const per0 = (): Per => ({ tright: { uses: 0, hits: 0, fruits: 0 }, tleft: { uses: 0, hits: 0, fruits: 0 }, tout: { uses: 0, hits: 0, fruits: 0 } });
type G = {
  wh: number; stage: "ready" | "play" | "done"; readyLeft: number; t: number; fruits: Fruit[]; parts: Part[]; pops: Pop[]; fx: Fx[]; nid: number; nextWave: number; nextBig: number;
  points: number; sliced: number; bestCombo: number; swings: number; hitSwings: number; spiky: number; per: Per;
  lev: Record<M, number>; on: Record<M, boolean>; cd: number; pokeAt: number; manual: boolean; adjust: boolean; lostSince: number | null; hint: string; practice: boolean; flash: number;
};
const fresh = (wh: number): G => ({ wh, stage: "ready", readyLeft: 4, t: 0, fruits: [], parts: [], pops: [], fx: [], nid: 1, nextWave: .6, nextBig: 7, points: 0, sliced: 0, bestCombo: 0, swings: 0, hitSwings: 0, spiky: 0, per: per0(), lev: { tright: 0, tleft: 0, tout: 0 }, on: { tright: false, tleft: false, tout: false }, cd: 0, pokeAt: -1, manual: false, adjust: false, lostSince: null, hint: "", practice: false, flash: 0 });
const BY = (wh: number) => wh * .46, BH = 82, COLW = 68;

// Normal fruit comes up on the left or the right side. Fruit on the left needs a left swipe, fruit on the right needs a right swipe.
function launch(s: G, spiky: boolean) {
  const t = s.t, diff = clamp(t / 60, 0, 1), by = BY(s.wh);
  const both = t > 12 && Math.random() < .25 + .25 * diff;
  const sides: (1 | -1)[] = both ? [-1, 1] : [Math.random() < .5 ? -1 : 1];
  for (const side of sides) {
    const n = both ? (Math.random() < .5 ? 1 : 2) : Math.random() < .3 + .3 * diff ? 3 : Math.random() < .6 ? 2 : 1;
    const apex = by + rnd(-50, 55), spread = 62;
    for (let i = 0; i < n; i++) {
      const d = clamp(rnd(70, 125) + i * (spread * .5) + rnd(-10, 10), 48, W / 2 - 38), xx = W / 2 + side * d, y0 = s.wh + FR + 10, ya = apex + rnd(-22, 22);
      const vy = -Math.sqrt(2 * GRAV * (y0 - ya)), vx = side * rnd(-6, 22);
      const bomb = spiky && t > 10 && Math.random() < .12 + .06 * diff && (n > 1 || both);
      s.fruits.push({ id: s.nid++, kind: Math.floor(Math.random() * KINDS.length), x: xx, y: y0 + i * rnd(0, 16), vx, vy: vy * rnd(.97, 1.03), r: FR * rnd(.92, 1.08), rot: rnd(0, 6.28), vr: rnd(-3, 3), bomb, big: false, half: 0, cut: 0, life: 0 });
    }
  }
}
// The big golden watermelon comes up the middle. Only "tongue out" slices it.
function launchBig(s: G) {
  const by = BY(s.wh), y0 = s.wh + 80, ya = by + rnd(-60, 20), vy = -Math.sqrt(2 * GRAV * (y0 - ya));
  s.fruits.push({ id: s.nid++, kind: 2, x: W / 2 + rnd(-24, 24), y: y0, vx: rnd(-6, 6), vy, r: 62, rot: rnd(0, 6.28), vr: rnd(-1, 1), bomb: false, big: true, half: 0, cut: 0, life: 0 });
}
function juice(s: G, x: number, y: number, col: string, n = 14) { for (let i = 0; i < n; i++) { const a = rnd(0, 6.28), v = rnd(60, 240); s.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: 0, max: rnd(.4, .9), col, r: rnd(2, 5) }); } }

// which fruit does this action reach?
function reach(f: Fruit, kind: M, by: number) {
  if (f.half) return false;
  if (kind === "tout") return f.big && f.y > -20 && f.y < s_wh_guard(by);
  if (f.big) return false;
  const inBand = Math.abs(f.y - by) <= BH + f.r * .4;
  return inBand && (kind === "tright" ? f.x >= W / 2 : f.x < W / 2);
}
const s_wh_guard = (by: number) => by * 2.3;
function doMove(s: G, m: M, now: number, haptics: boolean) {
  const by = BY(s.wh); s.cd = .3; s.swings++; s.per[m].uses++; s.fx.push({ kind: m === "tout" ? "poke" : "swipe", dir: m === "tleft" ? -1 : 1, t0: now });
  const hit = s.fruits.filter(f => reach(f, m, by)), big = hit.filter(f => f.big), good = hit.filter(f => !f.bomb && !f.big), bad = hit.filter(f => f.bomb);
  const n = good.length + big.length;
  for (const f of [...good, ...big]) {
    const col = KINDS[f.kind].flesh, cut = m === "tout" ? 0 : Math.PI / 2;
    s.fruits = s.fruits.filter(q => q !== f);
    for (const h of [1, 2] as const) s.fruits.push({ ...f, id: s.nid++, half: h, cut, vx: f.vx + (m === "tout" ? (h === 1 ? -90 : 90) : (m === "tleft" ? -50 : 50)), vy: f.vy + (m === "tout" ? -40 : (h === 1 ? -110 : 60)), vr: f.vr + (h === 1 ? -2 : 2), life: 0 });
    juice(s, f.x, f.y, col, 16);
  }
  for (const f of bad) { s.fruits = s.fruits.filter(q => q !== f); juice(s, f.x, f.y, "#ff7a9c", 20); s.spiky++; s.flash = .4; }
  let pts = 10 * good.length + bonus(good.length) + 50 * big.length - 10 * bad.length;
  if (bad.length && s.points + pts < 0) pts = -s.points;
  s.points += pts; s.sliced += n; if (n > 0) { s.hitSwings++; s.per[m].hits++; s.per[m].fruits += n; s.bestCombo = Math.max(s.bestCombo, good.length); }
  if (n > 0 || bad.length) {
    const all = hit, cx = all.reduce((a, f) => a + f.x, 0) / all.length, cy = all.reduce((a, f) => a + f.y, 0) / all.length;
    const text = big.length ? `Giant! +${pts}` : bad.length && !n ? "Spiky! −10" : n >= 2 ? `${n} fruit! +${pts}` : `+${pts}`;
    s.pops.push({ x: clamp(cx, 60, W - 60), y: cy - 30, text, t: now, col: bad.length ? "#ff9db4" : big.length || n >= 3 ? "#ffe08a" : "#ffffff" });
  }
  if (haptics) buzz(n >= 3 ? [30, 30, 60] : n > 0 ? 30 : 10);
}

// ---------- drawing ----------
function drawFruit(c: CanvasRenderingContext2D, f: Fruit) {
  const k = KINDS[f.kind]; c.save(); c.translate(f.x, f.y);
  if (f.big && !f.half) { const p = .5 + .5 * Math.sin(f.life * 6); c.save(); c.shadowColor = "#ffd54a"; c.shadowBlur = 24 + 12 * p; c.strokeStyle = `rgba(255,213,74,${.55 + .35 * p})`; c.lineWidth = 6; c.beginPath(); c.arc(0, 0, f.r + 6, 0, 7); c.stroke(); c.restore(); }
  c.rotate(f.rot);
  if (f.bomb) {
    c.fillStyle = "#2b1840"; c.strokeStyle = "#ff7a9c"; c.lineWidth = 2.5;
    c.beginPath(); for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8, rr = i % 2 ? f.r * .8 : f.r * 1.12; c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } c.closePath(); c.fill(); c.stroke();
    c.fillStyle = "#ff7a9c"; c.font = "bold 22px Georgia, serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("!", 0, 1); c.restore(); return;
  }
  if (f.half) {
    c.save(); c.rotate(-f.rot + f.cut); // flat cut edge faces +x after this rotation
    c.beginPath(); if (f.half === 1) c.rect(-f.r - 2, -f.r - 2, f.r + 2, 2 * f.r + 4); else c.rect(0, -f.r - 2, f.r + 2, 2 * f.r + 4); c.clip(); c.rotate(f.rot - f.cut);
  }
  const grad = c.createRadialGradient(-f.r * .3, -f.r * .35, f.r * .1, 0, 0, f.r * 1.05); grad.addColorStop(0, k.rind); grad.addColorStop(1, k.dark);
  c.fillStyle = f.half ? k.dark : grad; c.beginPath(); if (f.kind === 3) c.ellipse(0, 0, f.r * 1.08, f.r * .82, 0, 0, 7); else c.arc(0, 0, f.r, 0, 7); c.fill();
  if (f.half) { c.fillStyle = k.rind; c.beginPath(); c.arc(0, 0, f.r * .93, 0, 7); c.fill(); c.fillStyle = k.flesh; c.beginPath(); c.arc(0, 0, f.r * .8, 0, 7); c.fill();
    c.fillStyle = f.kind === 2 ? "#2b1b17" : "rgba(0,0,0,.16)"; for (let i = 0; i < 7; i++) { const a = i * .9, rr = f.r * .42; c.beginPath(); c.ellipse(Math.cos(a) * rr, Math.sin(a) * rr, 2.2, 3.2, a, 0, 7); c.fill(); } c.restore(); }
  else {
    c.fillStyle = "rgba(255,255,255,.35)"; c.beginPath(); c.ellipse(-f.r * .38, -f.r * .42, f.r * .22, f.r * .12, -.6, 0, 7); c.fill();
    if (f.kind === 2) { c.strokeStyle = "rgba(10,60,20,.55)"; c.lineWidth = 3; for (const a of [-.9, -.3, .3, .9]) { c.beginPath(); c.ellipse(0, 0, f.r * .35, f.r, a, 0, 7); c.stroke(); } }
    if (f.kind === 0) { c.strokeStyle = "#5a3a1a"; c.lineWidth = 3; c.beginPath(); c.moveTo(0, -f.r * .8); c.lineTo(3, -f.r * 1.15); c.stroke(); c.fillStyle = "#4caf50"; c.beginPath(); c.ellipse(9, -f.r * 1.02, 8, 4, .5, 0, 7); c.fill(); }
    if (f.kind === 1) { c.fillStyle = "rgba(140,70,0,.3)"; for (let i = 0; i < 9; i++) { const a = i * 2.4, rr = f.r * (.25 + (i % 3) * .25); c.beginPath(); c.arc(Math.cos(a) * rr, Math.sin(a) * rr, 1.4, 0, 7); c.fill(); } }
  }
  c.restore();
}
function tongue(c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, w: number, a: number) {
  const g = c.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, "rgba(255,157,180,0)"); g.addColorStop(.6, `rgba(255,120,150,${a * .75})`); g.addColorStop(1, `rgba(255,214,224,${a})`);
  c.strokeStyle = g; c.lineWidth = w; c.lineCap = "round"; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
  c.strokeStyle = `rgba(255,255,255,${a * .55})`; c.lineWidth = w * .22; c.beginPath(); c.moveTo(x0, y0 - w * .18); c.lineTo(x1, y1 - w * .18); c.stroke();
}
function drawWorld(c: CanvasRenderingContext2D, s: G, now: number, showZones: boolean) {
  const wh = s.wh, by = BY(wh);
  const bg = c.createLinearGradient(0, 0, 0, wh); bg.addColorStop(0, "#14194a"); bg.addColorStop(.55, "#3a2a6e"); bg.addColorStop(1, "#8a3f6e"); c.fillStyle = bg; c.fillRect(0, 0, W, wh);
  c.strokeStyle = "rgba(255,255,255,.05)"; c.lineWidth = 1; for (let i = 0; i < 9; i++) { const x = ((i * 47 + now * .01) % (W + 40)) - 20; c.beginPath(); c.moveTo(x, 0); c.lineTo(x - 30, wh); c.stroke(); }
  if (showZones) {
    c.fillStyle = "rgba(143,208,255,.06)"; c.fillRect(0, by - BH, W / 2, BH * 2); c.fillStyle = "rgba(255,157,180,.06)"; c.fillRect(W / 2, by - BH, W / 2, BH * 2);
    c.strokeStyle = "rgba(255,255,255,.22)"; c.lineWidth = 1.5; c.setLineDash([6, 8]); c.strokeRect(-2, by - BH, W + 4, BH * 2); c.beginPath(); c.moveTo(W / 2, by - BH); c.lineTo(W / 2, by + BH); c.stroke(); c.setLineDash([]);
    c.fillStyle = "rgba(255,255,255,.55)"; c.font = "600 12px Figtree, Arial, sans-serif"; c.textAlign = "left"; c.fillText("◀ SWIPE LEFT", 10, by - BH + 18); c.textAlign = "right"; c.fillText("SWIPE RIGHT ▶", W - 10, by - BH + 18);
    if (s.fruits.some(f => f.big && !f.half)) { const p = .5 + .5 * Math.sin(now / 160); c.fillStyle = `rgba(255,213,74,${.5 + .4 * p})`; c.font = "700 14px Figtree, Arial, sans-serif"; c.textAlign = "center"; c.fillText("OPEN MOUTH · TONGUE OUT", W / 2, by - BH - 14); }
  }
  for (const f of s.fruits) drawFruit(c, f);
  for (const p of s.parts) { c.globalAlpha = clamp(1 - p.life / p.max, 0, 1); c.fillStyle = p.col; c.beginPath(); c.arc(p.x, p.y, p.r, 0, 7); c.fill(); } c.globalAlpha = 1;
  for (const e of s.fx) { const p = clamp((now - e.t0) / 260, 0, 1), a = 1 - p * p;
    if (e.kind === "swipe") { const xa = e.dir > 0 ? -20 : W + 20, xb = e.dir > 0 ? W + 20 : -20, x1 = xa + (xb - xa) * p, x0 = xa + (xb - xa) * Math.max(0, p - .45); tongue(c, x0, by, x1, by + (e.dir > 0 ? 8 : -8), 26, a); }
    else { const y1 = wh + 20 - (wh + 60) * p, y0 = wh + 20 - (wh + 60) * Math.max(0, p - .5); tongue(c, W / 2, y0, W / 2, y1, 30, a); } }
  for (const p of s.pops) { const a = clamp(1 - (now - p.t) / 900, 0, 1); c.globalAlpha = a; c.fillStyle = p.col; c.font = "700 22px Cinzel, Georgia, serif"; c.textAlign = "center"; c.strokeStyle = "rgba(20,10,50,.8)"; c.lineWidth = 4; const y = p.y - (now - p.t) * .03; c.strokeText(p.text, p.x, y); c.fillText(p.text, p.x, y); } c.globalAlpha = 1;
  if (s.flash > 0) { c.fillStyle = `rgba(255,90,130,${s.flash * .35})`; c.fillRect(0, 0, W, wh); }
}

// ---------- screens ----------
function Rule({ light = false }: { light?: boolean }) { return <div className="my-3 flex items-center gap-2" aria-hidden><span className={`h-px flex-1 bg-gradient-to-r from-transparent ${light ? "to-[#8fd0ff]/60" : "to-teal/60"}`} /><span className={`h-1.5 w-1.5 rotate-45 ${light ? "bg-[#8fd0ff]" : "bg-teal"}`} /><span className={`h-px flex-1 bg-gradient-to-l from-transparent ${light ? "to-[#8fd0ff]/60" : "to-teal/60"}`} /></div>; }
function Page({ children }: { children?: any }) { return <main className="mx-auto max-w-md px-6 pb-12 pt-[max(2rem,env(safe-area-inset-top))]">{children}</main>; }
function Glyph({ m, size = 40, on = false }: { m: M; size?: number; on?: boolean }) {
  const col = on ? "#0f1038" : "#8fd0ff";
  return <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke={col} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="24" cy="24" r="21" strokeOpacity=".4" />
    {m === "tout" ? <><path d="M24 33V12M17 19l7-7 7 7" /><path d="M19 33h10" strokeOpacity=".6" /></> : m === "tright" ? <><path d="M12 24h24M28 16l8 8-8 8" /></> : <><path d="M36 24H12M20 16l-8 8 8 8" /></>}</svg>;
}
type GameRow = { id: string; played_at: string; duration_seconds: number; points: number; fruits: number; best_combo: number; swings: number; hit_swings: number; completed: boolean; per_move: any };
type Result = { points: number; fruits: number; bestCombo: number; swings: number; hitSwings: number; spiky: number; seconds: number; completed: boolean; per: Per; saved: boolean; practice: boolean };

export default function Slice() {
  const video = useRef<HTMLVideoElement>(null), cvRef = useRef<HTMLCanvasElement>(null), hubCv = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null), tracker = useRef<Awaited<ReturnType<typeof createTracker>> | null>(null), latest = useRef<Frame | null>(null), g = useRef<G>(fresh(640));
  const cfg = useRef({ len: 60, haptics: true, spiky: true, hints: true }), liveGain = useRef(1.7);
  const [view, setView] = useState<"loading" | "hub" | "clearance" | "ready" | "settings" | "stats" | "play" | "results">("loading");
  const [cal, setCal] = useState<Cal | null>(null), calRef = useRef<Cal | null>(null); calRef.current = cal;
  const [clear, setClear] = useState(false), [agree, setAgree] = useState(false), [st, setSt] = useState<Settings>(DEF);
  const [msg, setMsg] = useState<string | null>(null), [busy, setBusy] = useState(false), [preview, setPreview] = useState(true), [gainUi, setGainUi] = useState(1.7);
  const [box, setBox] = useState({ w: 360, h: 640 }), [hubBox, setHubBox] = useState({ w: 360, h: 640 });
  const [ui, setUi] = useState({ stage: "ready" as "ready" | "play" | "done", ready: 4, left: 60, points: 0, sliced: 0, adjust: false, paused: false, hint: "", lev: { tright: 0, tleft: 0, tout: 0 } as Record<M, number>, on: { tright: false, tleft: false, tout: false } as Record<M, boolean>, practice: false });
  const [result, setResult] = useState<Result | null>(null), [games, setGames] = useState<GameRow[] | null>(null);
  const hasCal = calOk(cal);

  useEffect(() => { (async () => {
    const sb = supabase(); const { data: { user } } = await sb.auth.getUser();
    if (!user) { location.href = "/"; return; }
    if (await dailyDue()) { location.href = dailyUrl("/slice?ready=1"); return; }
    setSt(loadSettings());
    const { data: c } = await sb.from("dash_calibration").select("summary").maybeSingle();
    const mv = (c as any)?.summary?.moves; if (mv) setCal(mv as Cal);
    const { data: cl } = await sb.from("consent_records").select("id").eq("kind", "exercise_clearance").eq("granted", true).limit(1);
    setClear(!!cl?.length); setView(new URLSearchParams(location.search).get("ready") === "1" && calOk(mv ?? null) ? "ready" : "hub");
  })(); return () => stop(); }, []);

  function stop() { tracker.current?.stop(); tracker.current = null; stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; latest.current = null; }
  function update(p: Partial<Settings>) { const n = { ...st, ...p }; setSt(n); saveSettings(n); }
  function openCalibrate() { location.href = "/calibrate?next=" + encodeURIComponent("/slice?ready=1"); }
  async function onPlay() { setMsg(null); if (!clear) { setView("clearance"); return; } if (!hasCal) { openCalibrate(); return; } setView("ready"); }
  async function confirmClearance() {
    setBusy(true); setMsg(null);
    const sb = supabase(); const { data: { user } } = await sb.auth.getUser(); if (!user) { location.href = "/"; return; }
    const { error } = await sb.from("consent_records").insert([{ user_id: user.id, kind: "exercise_clearance", granted: true, policy_version: POLICY_VERSION }, { user_id: user.id, kind: "camera_processing", granted: true, policy_version: POLICY_VERSION }]);
    setBusy(false);
    if (error) { setMsg(`Couldn’t save your confirmation: ${error.message}.`); return; }
    setClear(true); if (!hasCal) openCalibrate(); else setView("ready");
  }
  async function startGame(practice = false) {
    if (!calOk(cal)) { openCalibrate(); return; }
    setBusy(true); setMsg(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      stream.current = s; s.getVideoTracks()[0].onended = () => { g.current.adjust = true; };
      const v = video.current!; v.srcObject = s; await v.play();
      tracker.current = await createTracker(v, f => { latest.current = f; });
      const wh = clamp(Math.round(W * innerHeight / innerWidth), 560, 800), sc = Math.min(innerWidth / W, innerHeight / wh);
      cfg.current = { len: practice ? 40 : st.len, haptics: st.haptics, spiky: st.spiky && !practice, hints: st.hints || practice }; liveGain.current = 1.7; setGainUi(1.7);
      g.current = fresh(wh); g.current.practice = practice; setBox({ w: W * sc, h: wh * sc });
      setUi(u => ({ ...u, stage: "ready", ready: 4, left: cfg.current.len, points: 0, sliced: 0, adjust: false, paused: false, hint: "", practice })); setView("play");
    } catch (e: any) { stop(); setMsg(e?.name === "NotAllowedError" ? "Camera access is blocked. Allow it in your browser’s site settings, then try again." : `Couldn’t start the camera: ${e?.message ?? e}`); setView("hub"); }
    setBusy(false);
  }
  async function finish(completed: boolean) {
    const s = g.current; stop();
    const r: Result = { points: s.points, fruits: s.sliced, bestCombo: s.bestCombo, swings: s.swings, hitSwings: s.hitSwings, spiky: s.spiky, seconds: Math.round(s.t), completed, per: JSON.parse(JSON.stringify(s.per)), saved: false, practice: s.practice };
    setResult(r); setView("results");
    if (s.practice) return;
    try {
      const sb = supabase(); const { data: { user } } = await sb.auth.getUser(); if (!user) return;
      const { error } = await sb.from("slice_games").insert({ user_id: user.id, duration_seconds: r.seconds, points: r.points, fruits: r.fruits, best_combo: r.bestCombo, swings: r.swings, hit_swings: r.hitSwings, completed, per_move: { per: r.per, spiky: r.spiky }, settings: { len: cfg.current.len, spiky: cfg.current.spiky } });
      if (error) { setMsg(`This run couldn’t be saved: ${error.message}${/relation|does not exist|schema/i.test(error.message) ? " (Run the 0010 database step in Supabase.)" : ""}`); return; }
      setResult(x => x && { ...x, saved: true });
    } catch (e: any) { setMsg(`This run couldn’t be saved: ${e?.message ?? e}`); }
  }
  async function openStats() {
    setView("stats"); setGames(null);
    const { data } = await supabase().from("slice_games").select("id,played_at,duration_seconds,points,fruits,best_combo,swings,hit_swings,completed,per_move").order("played_at", { ascending: false }).limit(200);
    setGames((data as unknown as GameRow[]) ?? []);
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
      const cal = calRef.current; if (!cal) return; const sg = sigs(fr.vals);
      // levels + on/off with hysteresis
      const edge: Record<M, boolean> = { tright: false, tleft: false, tout: false };
      for (const m of MOVES) {
        const c = cal[m]; if (!c) { s.lev[m] = 0; s.on[m] = false; continue; }
        let l = clamp(liveGain.current * ((sg[c.key] ?? 0) - c.nm) / (c.range || 1), 0, 1); if (!(l >= .1)) l = 0;
        s.lev[m] += (l - s.lev[m]) * .6; const was = s.on[m], on = was ? s.lev[m] >= .3 : s.lev[m] >= .5; s.on[m] = on; edge[m] = on && !was;
      }
      if (s.stage === "ready") { s.readyLeft -= dt; if (s.readyLeft <= 0) { s.stage = "play"; s.t = 0; } }
      else {
        s.t += dt; s.cd = Math.max(0, s.cd - dt); s.flash = Math.max(0, s.flash - dt);
        // actions: a swipe wins over a poke (a swipe usually brings the tongue out first, so a poke waits a beat)
        if (s.cd <= 0) {
          const sw: M | null = edge.tright && edge.tleft ? (s.lev.tright >= s.lev.tleft ? "tright" : "tleft") : edge.tright ? "tright" : edge.tleft ? "tleft" : null;
          if (sw) { s.pokeAt = -1; doMove(s, sw, now, cfg.current.haptics); }
          else {
            if (edge.tout && s.pokeAt < 0) s.pokeAt = now;
            if (s.pokeAt >= 0) { if (!s.on.tout) s.pokeAt = -1; else if (now - s.pokeAt > 150) { s.pokeAt = -1; if (s.lev.tright < .5 && s.lev.tleft < .5) doMove(s, "tout", now, cfg.current.haptics); } }
          }
        }
        s.nextBig -= dt; if (s.nextBig <= 0) { launchBig(s); s.nextBig = rnd(9, 13); }
        s.nextWave -= dt; if (s.nextWave <= 0) { launch(s, cfg.current.spiky); s.nextWave = rnd(1.5, 2.1) - .5 * clamp(s.t / 90, 0, 1); }
        // hint
        let hint = ""; const by = BY(s.wh);
        if (cfg.current.hints) {
          if (s.fruits.some(f => f.big && !f.half && f.y < s.wh)) hint = "Tongue out!";
          else { const inB = s.fruits.filter(f => !f.half && !f.bomb && !f.big && Math.abs(f.y - by) <= BH), R = inB.filter(f => f.x >= W / 2).length, L = inB.length - R; if (inB.length) hint = R >= L ? "Swipe right!" : "Swipe left!"; } }
        s.hint = hint;
        if (s.t >= cfg.current.len && !finished) { finished = true; s.stage = "done"; finish(true); }
      }
    };
    const world = (dt: number, now: number) => {
      const s = g.current;
      if (!s.manual && !s.adjust) {
        for (const f of s.fruits) { f.vy += GRAV * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.rot += f.vr * dt; f.life += dt; }
        s.fruits = s.fruits.filter(f => f.y < s.wh + 90 && f.x > -80 && f.x < W + 80);
        for (const p of s.parts) { p.vy += 500 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life += dt; } s.parts = s.parts.filter(p => p.life < p.max);
        s.pops = s.pops.filter(p => now - p.t < 900); s.fx = s.fx.filter(e => now - e.t0 < 300);
      }
    };
    const loop = (now: number) => { raf = requestAnimationFrame(loop); const dt = Math.min(.05, (now - prev) / 1000); prev = now; step(dt, now); world(dt, now); drawWorld(ctx, g.current, now, g.current.stage === "play" || g.current.stage === "ready"); };
    raf = requestAnimationFrame(loop);
    const id = setInterval(() => { const s = g.current; setUi(u => ({ ...u, stage: s.stage, ready: Math.max(0, Math.ceil(s.readyLeft)), left: Math.max(0, Math.ceil(cfg.current.len - s.t)), points: s.points, sliced: s.sliced, adjust: s.adjust, paused: s.manual, hint: s.hint, lev: { ...s.lev }, on: { ...s.on } })); }, 100);
    return () => { cancelAnimationFrame(raf); clearInterval(id); removeEventListener("resize", fit); document.body.style.overflow = prevScroll; };
  }, [view]);

  // hub backdrop
  useEffect(() => {
    if (view !== "hub") return; const cv = hubCv.current; if (!cv) return;
    const wh = clamp(Math.round(W * innerHeight / innerWidth), 560, 800), d = Math.min(2, devicePixelRatio || 1); cv.width = W * d; cv.height = wh * d; const ctx = cv.getContext("2d")!; ctx.setTransform(d, 0, 0, d, 0, 0);
    const fit = () => { const sc = Math.max(innerWidth / W, innerHeight / wh); setHubBox({ w: W * sc, h: wh * sc }); }; fit(); addEventListener("resize", fit);
    const s = fresh(wh); s.stage = "play"; let raf = 0, prev = performance.now(), next = 0;
    const loop = (now: number) => { raf = requestAnimationFrame(loop); const dt = Math.min(.05, (now - prev) / 1000); prev = now; next -= dt; if (next <= 0) { s.t = 30; launch(s, false); next = 1.4; }
      for (const f of s.fruits) { f.vy += GRAV * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.rot += f.vr * dt; } s.fruits = s.fruits.filter(f => f.y < wh + 90); drawWorld(ctx, s, now, false); };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", fit); };
  }, [view]);

  const ios = typeof navigator !== "undefined" && /iPhone|iPad/.test(navigator.userAgent) && !(navigator as any).standalone;
  const videoEl = <video ref={video} playsInline muted aria-label="Your camera preview (mirrored)"
    className={view === "play" && preview ? "fixed z-40 -scale-x-100 rounded-2xl object-cover shadow-soft" : "pointer-events-none fixed left-0 top-0 h-1 w-1 opacity-[0.02]"}
    style={view === "play" && preview ? { right: 12, top: "calc(env(safe-area-inset-top, 0px) + 112px)", width: 84, height: 63 } : undefined} />;
  const choice = (on: boolean) => `rounded-2xl border ${on ? "border-teal bg-teal/10 shadow-soft" : "border-navy/15 bg-paper"}`;

  const body = () => {
    if (view === "loading") return <main className="grid min-h-dvh place-items-center text-navy/60">Loading…</main>;

    if (view === "clearance") return (
      <Page><h1 className="font-display text-3xl">Before you start</h1><Rule />
        <p className="mt-3 text-navy/70">Mirror Slice asks you to move your tongue in gentle, quick motions. Only continue if your clinician says these exercises are okay for you, and stop any time you feel discomfort or strain.</p>
        <p className="mt-3 text-navy/70">Your camera is used only while you play. During play it’s processed on your device, and video is never uploaded or saved. The only exception is the optional recalibration video, which you can turn on or off in the recalibration section.</p>
        <label className="mt-5 flex items-start gap-3 rounded-2xl bg-gold/20 p-4 text-sm"><input type="checkbox" className="mt-1 h-5 w-5 accent-teal" checked={agree} onChange={e => setAgree(e.target.checked)} />
          <span>My clinician has said gentle facial and tongue exercises are okay for me, and I understand I can stop at any time.</span></label>
        {msg && <p role="alert" className="mt-3 rounded-2xl bg-lav/50 p-3 text-sm">{msg}</p>}
        <button className="btn-primary mt-5 w-full" disabled={!agree || busy} onClick={confirmClearance}>{busy ? "Saving…" : "Continue"}</button>
        <button className="btn-quiet mt-3 w-full" onClick={() => setView("hub")}>Back</button></Page>);

    if (view === "ready") return (
      <Page><h1 className="font-display text-3xl">How to play</h1><Rule />
        <p className="mt-2 text-navy/70">Fruit flies up on the left or the right. Swipe your tongue the same way to slice it: left side, swipe left; right side, swipe right. Now and then a big golden watermelon comes up the middle. Open your mouth and stick your tongue out to slice it for 50 points.</p>
        <ul className="mt-4 grid gap-2">{MOVES.map(m => <li key={m} className="flex items-center gap-3 rounded-2xl bg-paper p-3 shadow-soft"><span className="rounded-full bg-[#0f1038] p-1"><Glyph m={m} size={44} /></span><span className="flex-1"><b>{INFO[m].action}</b><br /><span className="text-sm text-navy/70">{INFO[m].tip}</span></span></li>)}</ul>
        <div className="mt-4 rounded-2xl bg-paper p-4 text-sm shadow-soft"><b>Combos</b><p className="mt-1 text-navy/70">1 fruit: 10 points. 2 on the same side at once: +10 bonus. 3: +30. 4: +60. Golden watermelon: 50.</p>
          {st.spiky && <p className="mt-2 text-navy/70">Spiky fruit costs 10 points. Let those fall.</p>}</div>
        <p className="mt-3 text-xs text-navy/60">The dashed band shows where swipes reach. Nothing ends your run, so go at your own pace.</p>
        <button className="btn-primary mt-6 min-h-[60px] w-full text-lg" disabled={busy} onClick={() => startGame()}>{busy ? "Starting camera…" : "I’m ready"}</button>
        <button className="btn-quiet mt-3 w-full" onClick={() => setView("hub")}>Back</button></Page>);

    if (view === "settings") return (
      <Page><h1 className="font-display text-3xl">Settings</h1><Rule />
        <section className="mt-3 rounded-3xl bg-paper p-5 shadow-soft"><h2 className="font-display text-xl">1. Run length</h2>
          <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Run length">{LENS.map(n => <button key={n} role="radio" aria-checked={st.len === n} onClick={() => update({ len: n })} className={`min-h-[52px] ${choice(st.len === n)}`}>{n}s</button>)}</div></section>
        <label className="mt-3 flex items-center justify-between gap-4 rounded-3xl bg-paper p-5 shadow-soft"><span><b>2. Spiky fruit</b><br /><span className="text-sm text-navy/60">Sometimes a spiky one flies up. Slicing it costs 10 points. Turn off for a gentler game.</span></span>
          <input type="checkbox" className="h-7 w-7 accent-teal" checked={st.spiky} onChange={e => update({ spiky: e.target.checked })} aria-label="Spiky fruit" /></label>
        <label className="mt-3 flex items-center justify-between gap-4 rounded-3xl bg-paper p-5 shadow-soft"><span><b>3. Hints</b><br /><span className="text-sm text-navy/60">Show which move to make.</span></span>
          <input type="checkbox" className="h-7 w-7 accent-teal" checked={st.hints} onChange={e => update({ hints: e.target.checked })} aria-label="Hints" /></label>
        <label className="mt-3 flex items-center justify-between gap-4 rounded-3xl bg-paper p-5 shadow-soft"><span><b>4. Vibration</b><br /><span className="text-sm text-navy/60">A small buzz when you slice. Works on phones that allow it.</span></span>
          <input type="checkbox" className="h-7 w-7 accent-teal" checked={st.haptics} onChange={e => update({ haptics: e.target.checked })} aria-label="Vibration" /></label>
        <button className="btn-quiet mt-4 w-full" onClick={openCalibrate}>Recalibrate</button>
        <button className="btn-primary mt-3 w-full" onClick={() => setView("hub")}>Done</button></Page>);

    if (view === "stats") {
      const gs = games ?? [], done = gs.length, best = (f: (x: GameRow) => number) => gs.reduce((m, x) => Math.max(m, f(x)), 0);
      const tiles: [string, string][] = [["Runs", String(done)], ["Best score", String(best(x => x.points))], ["Best combo", `${best(x => x.best_combo)} fruit`], ["Fruit sliced", String(gs.reduce((n, x) => n + x.fruits, 0))]];
      const tot = per0(); for (const x of gs) for (const m of MOVES) { const p = x.per_move?.per?.[m]; if (p) { tot[m].uses += p.uses ?? 0; tot[m].hits += p.hits ?? 0; tot[m].fruits += p.fruits ?? 0; } }
      const rows = gs.slice(0, 12).reverse(), dm = Math.max(1, ...rows.map(x => x.points));
      return (
        <Page><h1 className="font-display text-3xl">Your stats</h1><Rule />
          <button className="btn-primary mt-4 min-h-[60px] w-full text-lg" onClick={onPlay}>Play game</button>
          {games === null && <p className="mt-6 text-navy/60">Loading…</p>}
          {games && done === 0 && <p className="mt-6 rounded-2xl bg-paper p-5 text-navy/70 shadow-soft">No runs yet. Your first one will show up here.</p>}
          {done > 0 && <>
            <dl className="mt-5 grid grid-cols-2 gap-3">{tiles.map(([k, v]) => <div key={k} className="rounded-2xl bg-paper p-4 shadow-soft"><dd className="font-display text-3xl">{v}</dd><dt className="text-xs text-navy/60">{k}</dt></div>)}</dl>
            <section className="mt-6 rounded-3xl bg-paper p-5 shadow-soft"><h2 className="font-display text-xl">Score, last {rows.length} runs</h2>
              <div className="mt-3 grid gap-2">{rows.map(x => <div key={x.id} className="flex items-center gap-3 text-sm"><span className="w-14 text-navy/60">{fmtDate(x.played_at)}</span><div className="h-3 flex-1 rounded-full bg-mist"><div className="h-3 rounded-r-full bg-teal" style={{ width: `${Math.max(2, x.points / dm * 100)}%` }} /></div><span className="w-12 text-right">{x.points}</span></div>)}</div></section>
            <section className="mt-4 rounded-3xl bg-paper p-5 shadow-soft"><h2 className="font-display text-xl">Accuracy by movement</h2><p className="text-xs text-navy/60">The share of times a movement sliced at least one fruit, across all runs.</p>
              <ul className="mt-3 grid gap-3">{MOVES.map(m => { const p = tot[m], pct = p.uses ? Math.round(p.hits / p.uses * 100) : null; return <li key={m}><div className="flex justify-between text-sm"><span>{INFO[m].name}</span><b>{pct == null ? "–" : `${pct}%`}</b></div><div className="mt-1 h-2.5 rounded-full bg-mist"><div className="h-2.5 rounded-r-full bg-teal" style={{ width: `${pct ?? 0}%` }} /></div><div className="mt-1 text-xs text-navy/60">{p.uses} used · {p.fruits} fruit sliced</div></li>; })}</ul></section>
            <section className="mt-4 rounded-3xl bg-paper p-5 shadow-soft"><h2 className="font-display text-xl">Recent runs</h2>
              <ul className="mt-3 grid gap-3 text-sm">{gs.slice(0, 8).map(x => <li key={x.id} className="flex justify-between gap-3"><span>{fmtDate(x.played_at)} · {x.points} pts{x.completed ? "" : " (ended early)"}</span><span className="text-navy/60">{x.fruits} fruit · best {x.best_combo}</span></li>)}</ul></section></>}
          <button className="btn-quiet mt-6 w-full" onClick={() => setView("hub")}>Back</button></Page>);
    }

    if (view === "results" && result) {
      const R = result, hitPct = R.swings ? Math.round(R.hitSwings / R.swings * 100) : null;
      return (
        <Page><h1 className="font-display text-3xl">{R.practice ? "Practice complete." : R.completed ? "Run complete." : "Run ended early."}</h1><Rule />
          <p className="mt-2 text-navy/70">{R.practice ? "Nothing was saved. Ready for a real run when you are." : "Nice work. Every run counts."}</p>
          <div className="mt-5 grid grid-cols-2 gap-3">{([["Score", String(R.points)], ["Fruit sliced", String(R.fruits)], ["Best combo", `${R.bestCombo} fruit`], ["Movements made", String(R.swings)]] as [string, string][]).map(([k, v]) => <div key={k} className="rounded-2xl bg-paper p-4 shadow-soft"><div className="font-display text-3xl">{v}</div><div className="text-xs text-navy/60">{k}</div></div>)}</div>
          <section className="mt-5 rounded-3xl bg-paper p-5 shadow-soft"><h2 className="font-display text-xl">Accuracy by movement</h2>
            <ul className="mt-3 grid gap-4">{MOVES.map(m => { const p = R.per[m], pct = p.uses ? Math.round(p.hits / p.uses * 100) : null; return <li key={m} className="flex items-center gap-3"><span className="rounded-full bg-[#0f1038] p-0.5"><Glyph m={m} size={34} /></span><div className="min-w-0 flex-1"><div className="flex items-baseline justify-between gap-2 text-sm"><span>{INFO[m].name}</span><b>{pct == null ? "–" : `${pct}%`}</b></div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-mist" role="img" aria-label={pct == null ? `${INFO[m].name}: not used` : `${INFO[m].name}: ${pct} percent`}><div className="h-full rounded-full bg-teal" style={{ width: `${pct ?? 0}%` }} /></div>
              <div className="mt-1 text-xs text-navy/60">{p.uses ? `${p.hits} of ${p.uses} sliced fruit · ${p.fruits} fruit total` : "Not used this run"}</div></div></li>; })}</ul>
            <p className="mt-4 text-xs text-navy/60">Accuracy is the share of times a movement sliced at least one fruit.{hitPct != null ? ` Overall: ${hitPct}%.` : ""}</p></section>
          {!R.practice && !R.saved && <p role="alert" className="mt-4 rounded-2xl bg-lav/50 p-4 text-sm">{msg ?? "Saving this run…"}</p>}
          <button className="btn-primary mt-6 min-h-[60px] w-full text-lg" onClick={onPlay}>Play again</button>
          {!R.practice && <button className="btn-quiet mt-3 w-full" onClick={openStats}>See my stats</button>}
          <button className="btn-quiet mt-3 w-full" onClick={() => setView("hub")}>Home</button></Page>);
    }

    if (view === "play") return (
      <div className="fixed inset-0 touch-none bg-[#0b0c2a]" style={{ height: "100dvh" }}>
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ width: box.w, height: box.h }}>
          <canvas ref={cvRef} style={{ width: "100%", height: "100%" }} aria-label="Fruit slicing. Use your tongue: swipe right, swipe left, or poke straight out." />
        </div>
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 10px)" }}>
          <div className="relative w-full" style={{ maxWidth: Math.max(box.w, 320), height: 96 }}>
            <div className="absolute right-3 top-0 min-w-[104px] rounded-2xl border border-[#8fd0ff]/40 bg-[#0f1038]/80 px-3 py-2 text-right shadow-soft backdrop-blur" role="status">
              <div className="dt-h text-3xl leading-none text-[#eceaff]">{ui.points}</div><div className="text-[10px] uppercase tracking-widest text-[#a9a8d6]">{ui.practice ? "Practice" : "Score"}</div>
              <div className="mt-1 text-[10px] uppercase tracking-widest text-[#a9a8d6]">{ui.sliced} fruit · {ui.left}s</div></div></div></div>
        {ui.stage === "ready" && !ui.adjust && !ui.paused && <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center text-center text-[#eceaff]"><div><p className="dt-h text-xl uppercase tracking-[.2em] text-[#8fd0ff]">Get ready</p><p className="dt-h text-8xl font-bold leading-none">{Math.max(1, ui.ready)}</p><p className="mt-2 text-sm text-[#d6d4ff]">Tongue out to slice the fruit.</p></div></div>}
        {ui.hint && ui.stage === "play" && <div className="pointer-events-none absolute inset-x-0 z-20 flex justify-center" style={{ top: "calc(env(safe-area-inset-top, 0px) + 10px)" }}><div className="w-[44%] rounded-2xl border border-[#8fd0ff]/60 bg-[#0f1038]/85 px-3 py-2 text-center dt-h text-sm leading-snug tracking-wide text-[#eceaff] shadow-soft" role="status">{ui.hint}</div></div>}
        <button aria-label="Pause" onClick={() => { g.current.manual = true; }} className="absolute z-20 grid h-14 w-14 place-items-center rounded-full border border-[#8fd0ff]/40 bg-[#0f1038]/80 shadow-soft" style={{ left: 12, top: "calc(env(safe-area-inset-top, 0px) + 10px)" }}>
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden><rect x="4" y="3" width="5" height="16" rx="1.5" fill="#8fd0ff" /><rect x="13" y="3" width="5" height="16" rx="1.5" fill="#8fd0ff" /></svg></button>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center pb-[max(10px,env(safe-area-inset-bottom))]"><div className="grid w-full grid-cols-3 gap-1.5 px-2" style={{ maxWidth: Math.max(box.w, 320) }}>
          {MOVES.map(m => <div key={m} className={`flex flex-col items-center rounded border px-1 py-2 text-center text-[11px] leading-tight shadow-soft ${ui.on[m] ? "border-[#bfe6ff] bg-[#8fd0ff] text-[#0f1038]" : "border-[#8fd0ff]/30 bg-[#0f1038]/80 text-[#d6d4ff]"}`}><Glyph m={m} size={30} on={ui.on[m]} /><span className="mt-0.5 whitespace-pre-line">{INFO[m].short}</span>
            <span className="mt-1 h-1.5 w-full rounded-full bg-black/30"><span className="block h-1.5 rounded-full bg-[#ffffff]" style={{ width: `${Math.round(ui.lev[m] * 100)}%` }} /></span></div>)}</div></div>
        {ui.adjust && !ui.paused && <div className="absolute inset-0 z-40 grid place-items-center bg-[#0b0c2a]/85 p-8 text-center text-[#eceaff]" role="alert"><div><p className="dt-h text-3xl">Let’s adjust your camera</p>
          <p className="mt-3 text-base">We can’t see your face clearly. Center it and add light. The game waits, and nothing is counted against you.</p></div></div>}
        {ui.paused && <div className="absolute inset-0 z-50 grid place-items-center bg-[#0b0c2a]/85 p-6 text-[#eceaff]" role="dialog" aria-label="Paused"><div className="w-full max-w-xs text-center">
          <p className="dt-h text-3xl">Paused</p><p className="mt-1 text-sm text-[#eceaff]/75">Take as long as you need.</p>
          <button className="btn-primary mt-5 w-full" onClick={() => { g.current.manual = false; }}>Resume</button>
          <div className="mt-4 rounded bg-white/10 p-3 text-sm"><p>Sensitivity {Math.max(1, GAINS.indexOf(gainUi) + 1)} of 5</p><p className="text-xs text-[#eceaff]/70">Movements not registering? Try Easier. Triggering by accident? Try Harder.</p>
            <div className="mt-2 grid grid-cols-2 gap-2"><button className="btn-quiet min-h-[48px]" onClick={() => { const v = GAINS[Math.min(4, Math.max(0, GAINS.indexOf(gainUi)) + 1)]; liveGain.current = v; setGainUi(v); }}>Easier</button>
              <button className="btn-quiet min-h-[48px]" onClick={() => { const v = GAINS[Math.max(0, Math.max(0, GAINS.indexOf(gainUi)) - 1)]; liveGain.current = v; setGainUi(v); }}>Harder</button></div></div>
          <button className="btn-quiet mt-3 w-full" onClick={() => setPreview(p => !p)}>{preview ? "Hide camera preview" : "Show camera preview"}</button>
          <button className="btn-quiet mt-3 w-full" onClick={() => finish(false)}>End run</button></div></div>}
      </div>);

    // hub
    return (
      <div className="fixed inset-0 overflow-hidden bg-[#0b0c2a] text-[#eceaff]">
        <canvas ref={hubCv} aria-hidden className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ width: hubBox.w, height: hubBox.h }} />
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/0 to-[#0b0c2a]/95" />
        <div className="relative mx-auto flex h-full max-w-md flex-col justify-between overflow-y-auto px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
          <a href="/dashboard" className="text-xs uppercase tracking-[.3em] text-[#d6d4ff]">← Home</a>
          <div>
            <p className="text-xs uppercase tracking-[.35em] text-[#8fd0ff]">Tongue exercise</p>
            <h1 className="dt-h mt-2 text-5xl font-bold leading-[1.05] text-white">MIRROR<br />SLICE</h1><Rule light />
            <p className="text-[#d6d4ff]">Slice flying fruit with your tongue. Swipe right, swipe left, or poke straight out. Slice several at once for bonus points.</p>
            {msg && <p role="alert" className="mt-3 rounded-2xl bg-[#3f0f7f] p-3 text-sm">{msg}</p>}
            <button className="btn-primary mt-5 min-h-[64px] w-full text-lg uppercase tracking-[.16em]" onClick={onPlay}>Play game</button>
            {!hasCal && <p className="mt-2 text-center text-xs text-[#a9a8d6]">First time? We’ll set up your tongue movements next.</p>}
            <div className="mt-3 grid grid-cols-3 gap-3"><button className="btn-quiet min-h-[56px] !px-2 !border-white/25 !bg-black/40 !text-white" disabled={busy} onClick={() => { if (!clear) setView("clearance"); else if (!hasCal) openCalibrate(); else startGame(true); }}>Practice</button><button className="btn-quiet min-h-[56px] !px-2 !border-white/25 !bg-black/40 !text-white" onClick={openStats}>Stats</button><button className="btn-quiet min-h-[56px] !px-2 !border-white/25 !bg-black/40 !text-white" onClick={() => setView("settings")}>Settings</button></div>
            {ios && <p className="mt-4 rounded-2xl bg-black/50 p-3 text-xs text-[#d6d4ff]">For the full-screen version on iPhone: tap the Share button in Safari, choose <b>Add to Home Screen</b>, then open SmileQuest from your home screen.</p>}
          </div>
        </div>
      </div>);
  };
  return <>{videoEl}<style>{"@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&display=swap');.dt-h{font-family:'Cinzel',Georgia,serif;letter-spacing:.06em}"}</style>{body()}</>;
}
