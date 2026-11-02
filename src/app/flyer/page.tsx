"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { createTracker, type Frame } from "@/lib/tracking";
import { POLICY_VERSION } from "@/lib/onboarding";

type Move = { threshold: number; range: number; detectable: boolean; nm: number };
const KEYS = ["smile", "brow", "pucker", "close"] as const;
type K = typeof KEYS[number];
const NAMES: Record<K, string> = { smile: "Gentle smile", brow: "Eyebrow raise", pucker: "Soft lip pucker", close: "Gentle eye closure" };
const W = 360, H = 640, GROUND = 520, BX = 100, TAU = Math.PI * 2, HOVER = .36;
const GAINS = [1, 1.3, 1.7, 2.2, 3];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

type Prof = { total: number; kind: string; color: string; acc: string };
const ANIMALS = [{ k: "bird", n: "Songbird", need: 0, col: "#6bb3a8" }, { k: "bunny", n: "Bunny", need: 150, col: "#e8dfd2" }, { k: "fox", n: "Fox", need: 300, col: "#e58a4e" }, { k: "owl", n: "Owl", need: 500, col: "#9b7b5b" }];
const COLORS = [{ n: "Original", c: "", need: 0 }, { n: "Sky", c: "#6fa8dc", need: 25 }, { n: "Rose", c: "#e59aa8", need: 25 }, { n: "Lavender", c: "#b7a7dc", need: 25 }, { n: "Mint", c: "#8fd0b0", need: 50 }, { n: "Coral", c: "#ef8f78", need: 50 }, { n: "Slate", c: "#6b7a8f", need: 50 }];
const ACCS = [{ n: "None", k: "", need: 0 }, { n: "Bow", k: "bow", need: 75 }, { n: "Glasses", k: "glasses", need: 75 }, { n: "Crown", k: "crown", need: 120 }];
const UNLOCKS = [{ need: 25, label: "Bird colors" }, { need: 50, label: "More colors" }, { need: 75, label: "Bow and glasses" }, { need: 120, label: "Crown" }, { need: 150, label: "Bunny" }, { need: 300, label: "Fox" }, { need: 500, label: "Owl" }];

type Pil = { x: number; c: number; gap: number; passed: boolean };
type Coin = { x: number; y: number; got: boolean };
type Rest = { x0: number; x1: number; warm?: boolean };
const fresh = () => ({
  t: 0, scroll: 0, y: GROUND / 2 - 40, vy: 0, lev: 0, ready: true,
  pillars: [] as Pil[], coins: [] as Coin[], rests: [] as Rest[], spawnX: W + 160, prev: GROUND / 2 - 40, dist: 0,
  score: 0, got: 0, cur: 0, longest: 0, holds: 0, pauses: 0, adjust: false, lostSince: null as number | null, manual: false,
  assist: null as null | { t: number; from: number; to: number }, invuln: 0, bumps: 0, restsSeen: 0, inRest: false, wasRest: false, inWarm: false,
  ease: 2.5, rotT: 0, key: "smile" as K, flap: 0, done: false, finished: false, used: {} as Record<string, number>,
});
type G = ReturnType<typeof fresh>;
function warmUp(s: G, speed: number) {
  const len = speed * 9; s.rests.push({ x0: 0, x1: len, warm: true });
  for (let i = 0; i < 8; i++) s.coins.push({ x: 150 + i * (len - 210) / 7, y: GROUND / 2 + (i % 2 ? 1 : -1) * 70, got: false });
  s.spawnX = len + 200; s.prev = GROUND / 2 - 40;
}

function drawCritter(c: CanvasRenderingContext2D, x: number, y: number, ang: number, kind: string, body: string, acc: string, flap: number, sc = 1) {
  const dark = "#2b3340";
  c.save(); c.translate(x, y); c.rotate(ang); c.scale(sc, sc); c.lineWidth = 2.5; c.strokeStyle = dark; c.lineJoin = "round";
  const ell = (cx: number, cy: number, rx: number, ry: number, fill: string, rot = 0, stroke = true) => { c.fillStyle = fill; c.beginPath(); c.ellipse(cx, cy, rx, ry, rot, 0, TAU); c.fill(); if (stroke) c.stroke(); };
  const tri = (a: number[], fill: string) => { c.fillStyle = fill; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(a[2], a[3]); c.lineTo(a[4], a[5]); c.closePath(); c.fill(); c.stroke(); };
  if (kind === "bunny") { ell(-6, -25, 5, 12, body, -.2); ell(4, -26, 5, 12, body, .15); ell(-6, -25, 2.5, 8, "#f3b6c2", -.2, false); ell(4, -26, 2.5, 8, "#f3b6c2", .15, false); ell(-22, 5, 6, 6, "#fff"); }
  if (kind === "fox") { ell(-24, 6, 14, 7, body, -.5); ell(-33, 2, 6, 5, "#fff", -.5); tri([-8, -12, -12, -30, 2, -17], body); tri([5, -15, 10, -31, 15, -12], body); }
  if (kind === "owl") { tri([-10, -12, -12, -27, 0, -15], body); tri([6, -15, 14, -28, 16, -10], body); }
  if (kind === "bird") { ell(-22, 3, 10, 5, body, .3); ell(-22, 3, 10, 5, "rgba(0,0,0,.15)", .3, false); }
  ell(0, 0, 18, 16, body);
  ell(3, 5, 11, 9, "rgba(255,255,255,.55)", 0, false);
  c.save(); c.translate(-6, 2); c.rotate(Math.sin(flap) * .7 - .2); ell(-5, 0, 11, 5.5, "rgba(0,0,0,.22)"); c.restore();
  if (kind === "owl") { ell(2, -4, 6, 6, "#fff"); ell(13, -4, 5.5, 5.5, "#fff"); ell(4, -4, 2.5, 2.5, dark, 0, false); ell(14, -4, 2.5, 2.5, dark, 0, false); }
  else { ell(8, -5, 5, 5.5, "#fff"); ell(10, -5, 2.4, 2.4, dark, 0, false); }
  if (kind === "bird") tri([15, -1, 26, 3, 15, 7], "#f29e4c");
  if (kind === "bunny") ell(17, 0, 3, 2.5, "#f08fa3", 0, false);
  if (kind === "fox") { ell(14, 5, 8, 5, "#fff"); ell(21, 3, 3, 2.5, dark, 0, false); }
  if (kind === "owl") tri([15, 0, 22, 4, 15, 8], "#f2b84c");
  if (acc === "bow") { tri([-2, -18, -12, -25, -12, -11], "#f08fa3"); tri([-2, -18, 8, -25, 8, -11], "#f08fa3"); ell(-2, -18, 3, 3, "#d9667f"); }
  if (acc === "glasses") { c.lineWidth = 2; c.beginPath(); c.arc(kind === "owl" ? 2 : 8, -5, 7, 0, TAU); c.stroke(); if (kind === "owl") { c.beginPath(); c.arc(13, -4, 7, 0, TAU); c.stroke(); } else { c.beginPath(); c.moveTo(1, -5); c.lineTo(-10, -7); c.stroke(); } }
  if (acc === "crown") { c.fillStyle = "#f6c945"; c.beginPath(); c.moveTo(-8, -14); c.lineTo(-8, -26); c.lineTo(-3, -20); c.lineTo(2, -28); c.lineTo(7, -20); c.lineTo(12, -26); c.lineTo(12, -14); c.closePath(); c.fill(); c.stroke(); }
  c.restore();
}

function cloud(c: CanvasRenderingContext2D, x: number, y: number, r: number) {
  c.beginPath(); c.arc(x, y, r, 0, TAU); c.arc(x + r * .9, y + r * .15, r * .8, 0, TAU); c.arc(x - r * .9, y + r * .2, r * .7, 0, TAU); c.arc(x + r * .1, y - r * .45, r * .75, 0, TAU); c.fill();
}
function pillar(c: CanvasRenderingContext2D, px: number, yA: number, yB: number, capAtB: boolean) {
  const w = 52, cw = 64, ch = 24;
  c.fillStyle = "#79c08c"; c.strokeStyle = "#35604a"; c.lineWidth = 3;
  c.fillRect(px - w / 2, yA, w, yB - yA); c.strokeRect(px - w / 2, yA, w, yB - yA);
  c.fillStyle = "rgba(255,255,255,.28)"; c.fillRect(px - w / 2 + 6, yA, 8, yB - yA);
  const cy = capAtB ? yB - ch : yA;
  c.fillStyle = "#8fd09f"; c.fillRect(px - cw / 2, cy, cw, ch); c.strokeRect(px - cw / 2, cy, cw, ch);
  c.fillStyle = "rgba(255,255,255,.3)"; c.fillRect(px - cw / 2 + 6, cy + 3, 8, ch - 6);
}

function drawWorld(c: CanvasRenderingContext2D, s: G, now: number, body: string, acc: string, kind: string) {
  const sc = s.scroll;
  const g = c.createLinearGradient(0, 0, 0, GROUND); g.addColorStop(0, "#62c3ee"); g.addColorStop(1, "#cdeef6");
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.fillStyle = "rgba(255,255,255,.92)";
  for (let i = 0; i < 5; i++) { const cx = (((i * 170 - sc * .15) % (W + 200)) + (W + 200)) % (W + 200) - 100; cloud(c, cx, 70 + ((i * 53) % 150), 24 + (i % 3) * 7); }
  c.fillStyle = "#a9ddd2";
  for (let i = 0; i < 8; i++) { const bx = (((i * 110 - sc * .3) % 880) + 880) % 880 - 110; c.beginPath(); c.ellipse(bx, GROUND, 70, 70 + (i % 3) * 20, 0, Math.PI, TAU); c.fill(); }
  c.fillStyle = "#86d38c";
  for (let i = 0; i < 8; i++) { const bx = (((i * 90 - sc * .6) % 720) + 720) % 720 - 90; c.beginPath(); c.ellipse(bx, GROUND, 44, 26 + (i % 2) * 8, 0, Math.PI, TAU); c.fill(); }
  for (const p of s.pillars) {
    const px = p.x - sc; if (px < -60 || px > W + 60) continue;
    pillar(c, px, -4, p.c - p.gap / 2, true); pillar(c, px, p.c + p.gap / 2, GROUND, false);
  }
  s.coins.forEach((co, i) => {
    if (co.got) return; const sx = co.x - sc; if (sx < -20 || sx > W + 20) return;
    const wd = Math.abs(Math.cos(now / 220 + i)) * 8 + 2;
    c.fillStyle = "#f6c945"; c.strokeStyle = "#a67c12"; c.lineWidth = 2; c.beginPath(); c.ellipse(sx, co.y, wd, 10, 0, 0, TAU); c.fill(); c.stroke();
    c.fillStyle = "rgba(255,255,255,.55)"; c.beginPath(); c.ellipse(sx - wd * .25, co.y - 3, wd * .3, 4, 0, 0, TAU); c.fill();
  });
  c.fillStyle = "#e3d49b"; c.fillRect(0, GROUND, W, H - GROUND);
  c.fillStyle = "#d2c186";
  const off = sc % 24;
  for (let x = -24 - off; x < W + 24; x += 24) { c.beginPath(); c.moveTo(x, GROUND + 14); c.lineTo(x + 12, GROUND + 14); c.lineTo(x, H); c.lineTo(x - 12, H); c.closePath(); c.fill(); }
  c.fillStyle = "#8ad06a"; c.fillRect(0, GROUND, W, 14);
  c.fillStyle = "#a3de84"; for (let x = -24 - off; x < W + 24; x += 24) { c.beginPath(); c.moveTo(x, GROUND); c.lineTo(x + 10, GROUND); c.lineTo(x, GROUND + 14); c.lineTo(x - 10, GROUND + 14); c.closePath(); c.fill(); }
  c.strokeStyle = "#4f7a3a"; c.lineWidth = 3; c.beginPath(); c.moveTo(0, GROUND); c.lineTo(W, GROUND); c.moveTo(0, GROUND + 14); c.lineTo(W, GROUND + 14); c.stroke();
  if (!(s.invuln > 0 && Math.floor(now / 120) % 2)) drawCritter(c, BX, s.y, clamp(s.vy / 400, -.5, .7), kind, body, acc, s.flap);
  c.textAlign = "center"; c.lineJoin = "round";
  c.font = "bold 54px system-ui, sans-serif"; c.lineWidth = 7; c.strokeStyle = "#2b3340"; c.strokeText(String(s.score), W / 2, 96); c.fillStyle = "#fff"; c.fillText(String(s.score), W / 2, 96);
  if (s.inRest) { const t1 = s.inWarm ? "Warm-up" : "Rest meadow", t2 = s.inWarm ? "Try your movement. Coins are up and down." : "Relax your face and float";
    c.font = "bold 22px system-ui, sans-serif"; c.lineWidth = 5; c.strokeText(t1, W / 2, 150); c.fillText(t1, W / 2, 150); c.font = "bold 15px system-ui, sans-serif"; c.lineWidth = 4; c.strokeText(t2, W / 2, 174); c.fillText(t2, W / 2, 174); }
}

export default function Flyer() {
  const video = useRef<HTMLVideoElement>(null), cvRef = useRef<HTMLCanvasElement>(null), pvRef = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null), tracker = useRef<Awaited<ReturnType<typeof createTracker>> | null>(null);
  const latest = useRef<Frame | null>(null), g = useRef<G>(fresh());
  const [phase, setPhase] = useState<"loading" | "nocal" | "menu" | "custom" | "play" | "done">("loading");
  const [cal, setCal] = useState<Partial<Record<K, Move>>>({});
  const [prof, setProf] = useState<Prof>({ total: 0, kind: "bird", color: "", acc: "" });
  const [dbMsg, setDbMsg] = useState<string | null>(null);
  const [sel, setSel] = useState<K>("smile"), [rotate, setRotate] = useState(false), [rotSec, setRotSec] = useState(20);
  const [mode, setMode] = useState<"path" | "hold" | "pulse">("path"), [minutes, setMinutes] = useState(6), [gap, setGap] = useState(290), [restEvery, setRestEvery] = useState(15), [gain, setGain] = useState(1.7), [pace, setPace] = useState(75);
  const [preview, setPreview] = useState(true), [msg, setMsg] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [ui, setUi] = useState({ lev: 0, adjust: false, paused: false, done: false, score: 0, got: 0, inRest: false, key: "smile" as K, ease: 0 });
  const [result, setResult] = useState({ score: 0, got: 0, time: 0, longest: 0, holds: 0, pauses: 0, bumps: 0, rests: 0, unlocked: [] as string[], keys: [] as string[], saved: true });
  const R = useRef({ cal, sel, rotate, rotSec, mode, gap, restEvery, gain, minutes, prof, speed: pace });
  R.current = { cal, sel, rotate, rotSec, mode, gap, restEvery, gain, minutes, prof, speed: pace };

  useEffect(() => { (async () => {
    const sb = supabase();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { setMsg("Please log in on the home page first."); setPhase("nocal"); return; }
    const { data } = await sb.from("calibration_profiles").select("summary").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const m: Partial<Record<K, Move>> = {};
    for (const k of KEYS) { const v = data?.summary?.moves?.[k]; if (v?.detectable) m[k] = { ...v, nm: v.threshold - 0.5 * v.range }; }
    if (!Object.keys(m).length) { setPhase("nocal"); return; }
    setCal(m); setSel((Object.keys(m)[0] as K));
    const { data: fp, error } = await sb.from("flyer_profiles").select("total_coins,bird_kind,color,accessory").maybeSingle();
    if (error) setDbMsg("Coins can’t be saved yet. Run the 0004_flyer.sql step in Supabase, then reload.");
    else if (fp) setProf({ total: fp.total_coins, kind: fp.bird_kind, color: fp.color, acc: fp.accessory });
    setPhase("menu");
  })(); return () => stop(); }, []);

  function stop() { tracker.current?.stop(); tracker.current = null; stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; latest.current = null; }
  async function bank(earned: number, p: Prof = R.current.prof): Promise<boolean> {
    const sb = supabase(); const { data: { user } } = await sb.auth.getUser(); if (!user) return false;
    const next = { ...p, total: p.total + earned };
    const { error } = await sb.from("flyer_profiles").upsert({ user_id: user.id, total_coins: next.total, bird_kind: next.kind, color: next.color, accessory: next.acc, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) { setDbMsg(`Couldn’t save: ${error.message}`); return false; }
    setProf(next); return true;
  }
  async function pick(next: Prof) { setProf(next); await bank(0, next); }

  async function begin() {
    setBusy(true); setMsg(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      stream.current = s; s.getVideoTracks()[0].onended = () => { g.current.adjust = true; };
      const v = video.current!; v.srcObject = s; await v.play();
      tracker.current = await createTracker(v, f => { latest.current = f; });
      const sb = supabase(); const { data: { user } } = await sb.auth.getUser();
      if (user) await sb.from("consent_records").insert({ user_id: user.id, kind: "camera_processing", granted: true, policy_version: POLICY_VERSION });
      g.current = fresh(); g.current.key = sel; warmUp(g.current, pace); setUi(u => ({ ...u, done: false, score: 0, got: 0 })); setPhase("play");
    } catch (e: any) { stop(); setMsg(e?.name === "NotAllowedError" ? "Camera access is blocked. Allow it in your browser’s site settings, then try again." : `Couldn’t start the camera: ${e?.message ?? e}`); }
    setBusy(false);
  }
  async function finish() {
    const s = g.current; if (s.finished) return; s.finished = true;
    if (s.cur >= .5) s.holds++;
    const before = R.current.prof.total, earned = s.got; s.got = 0; stop();
    setResult({ score: s.score, got: earned, time: s.t, longest: s.longest, holds: s.holds, pauses: s.pauses, bumps: s.bumps, rests: s.restsSeen,
      unlocked: UNLOCKS.filter(u => u.need > before && u.need <= before + earned).map(u => u.label), keys: Object.keys(s.used).map(k => NAMES[k as K]), saved: true });
    setPhase("done");
    const ok = earned > 0 ? await bank(earned) : true;
    if (!ok) setResult(r => ({ ...r, saved: false }));
  }
  async function leave(to: "menu" | "dashboard") {
    const e = g.current.got; g.current.got = 0; g.current.finished = true; stop();
    if (e > 0) await bank(e);
    if (to === "dashboard") location.href = "/dashboard"; else setPhase("menu");
  }
  useEffect(() => { if (ui.done && phase === "play") finish(); }, [ui.done]);

  useEffect(() => {
    if (phase !== "play") return;
    const cv = cvRef.current!, ctx = cv.getContext("2d")!; cv.width = W * 2; cv.height = H * 2; ctx.setTransform(2, 0, 0, 2, 0, 0);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, prev = performance.now();
    const spawn = (s: G, o: typeof R.current) => {
      if (o.restEvery > 0 && s.dist >= o.restEvery * o.speed) {
        const len = o.speed * 4; s.rests.push({ x0: s.spawnX, x1: s.spawnX + len });
        for (let i = 0; i < 8; i++) s.coins.push({ x: s.spawnX + len * (i + .5) / 8, y: clamp(s.prev + Math.sin(i / 7 * TAU) * 60, 60, GROUND - 60), got: false });
        s.spawnX += len + 90; s.dist = 0; return;
      }
      const half = o.gap / 2, lo = 70 + half, hi = GROUND - 70 - half;
      const c = clamp(s.prev + (Math.random() * 2 - 1) * 100, lo, hi); s.prev = c;
      s.pillars.push({ x: s.spawnX, c, gap: o.gap, passed: false });
      s.coins.push({ x: s.spawnX, y: c + (Math.random() * 2 - 1) * half * .4, got: false });
      s.spawnX += 260; s.dist += 260;
    };
    const step = (dt: number, now: number) => {
      const s = g.current, o = R.current, fr = latest.current;
      if (s.manual || s.done) return;
      if (!(fr && fr.vals && fr.q.face && fr.q.size)) { if (s.lostSince == null) s.lostSince = now; if (now - s.lostSince > 600 && !s.adjust) { s.adjust = true; s.pauses++; } return; }
      s.lostSince = null; s.adjust = false;
      const avail = KEYS.filter(k => o.cal[k]); if (!avail.length) return;
      if (o.rotate && avail.length > 1) { s.rotT += dt; if (s.rotT >= o.rotSec) { s.rotT = 0; s.key = avail[(avail.indexOf(s.key) + 1) % avail.length]; s.ease = 2.5; } }
      else s.key = avail.includes(o.sel) ? o.sel : avail[0];
      const m = o.cal[s.key]!;
      let l = clamp(o.gain * (fr.vals[s.key] - m.nm) / m.range, 0, 1); if (l < .12) l = 0;
      s.lev += (l - s.lev) * .3;
      s.t += dt; s.used[s.key] = (s.used[s.key] || 0) + dt; s.flap += dt * (8 + s.lev * 12);
      if (s.ease > 0) s.ease = Math.max(0, s.ease - dt);
      if (s.lev >= HOVER) { s.cur += dt; s.longest = Math.max(s.longest, s.cur); } else { if (s.cur >= .5) s.holds++; s.cur = 0; }
      const e = s.ease > 0 ? .25 : 1;
      if (o.mode === "path") {
        const ahead = s.coins.find(c => !c.got && c.x - s.scroll > BX - 12 && c.x - s.scroll < BX + 170);
        const pil = s.pillars.find(q => q.x - s.scroll + 30 > BX);
        const aim = ahead ? ahead.y : (pil && pil.x - s.scroll < BX + 200 ? pil.c : GROUND / 2 - 40);
        if (s.lev >= HOVER) s.vy += (clamp((aim - s.y) * 3, -200, 200) - s.vy) * Math.min(1, dt * 6);
        else s.vy += ((s.ease > 0 ? 0 : 70) - s.vy) * Math.min(1, dt * 2.5);
      } else if (o.mode === "hold") { const tv = (HOVER - s.lev) * (s.ease > 0 ? 70 : 222); s.vy += (tv - s.vy) * Math.min(1, dt * 4); }
      else { if (s.lev > .45 && s.ready) { s.vy = -250; s.ready = false; } if (s.lev < .25) s.ready = true; s.vy = clamp(s.vy + 520 * e * dt, -260, 300); }
      s.scroll += o.speed * dt; s.invuln = Math.max(0, s.invuln - dt);
      if (s.assist) { s.assist.t += dt; const k = Math.min(1, s.assist.t / .5); s.y = s.assist.from + (s.assist.to - s.assist.from) * (k * k * (3 - 2 * k)); s.vy = 0; if (k >= 1) s.assist = null; }
      else s.y += s.vy * dt;
      if (s.y < 24) { s.y = 24; s.vy = Math.max(s.vy, 0); }
      if (s.y > GROUND - 22) { s.y = GROUND - 22; s.vy = Math.min(s.vy, -70); }
      while (s.spawnX < s.scroll + W + 80) spawn(s, o);
      for (const p of s.pillars) {
        const px = p.x - s.scroll;
        if (!p.passed && px + 26 < BX - 14) { p.passed = true; s.score++; }
        if (s.invuln <= 0 && !s.assist && Math.abs(BX - px) < 26 + 11 && (s.y - 11 < p.c - p.gap / 2 || s.y + 11 > p.c + p.gap / 2)) { s.assist = { t: 0, from: s.y, to: p.c }; s.invuln = 1.6; s.bumps++; }
      }
      for (const co of s.coins) if (!co.got && Math.hypot(co.x - s.scroll - BX, co.y - s.y) < 24) { co.got = true; s.got++; }
      const wx = s.scroll + BX, cr = s.rests.find(r => wx >= r.x0 && wx <= r.x1); s.inRest = !!cr; s.inWarm = !!cr?.warm;
      if (s.inRest && !s.wasRest && !s.inWarm) s.restsSeen++; s.wasRest = s.inRest;
      if (s.pillars.length > 12) s.pillars = s.pillars.filter(p => p.x - s.scroll > -100);
      if (s.coins.length > 40) s.coins = s.coins.filter(c => c.x - s.scroll > -40);
      if (o.minutes > 0 && s.t >= o.minutes * 60) s.done = true;
    };
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop); const dt = Math.min(.05, (now - prev) / 1000); prev = now; step(dt, now);
      const o = R.current, an = ANIMALS.find(a => a.k === o.prof.kind) ?? ANIMALS[0];
      drawWorld(ctx, g.current, reduce ? 0 : now, o.prof.color || an.col, o.prof.acc, o.prof.kind);
    };
    raf = requestAnimationFrame(loop);
    const id = setInterval(() => { const s = g.current; setUi({ lev: s.lev, adjust: s.adjust, paused: s.manual, done: s.done, score: s.score, got: s.got, inRest: s.inRest, key: s.key, ease: s.ease }); }, 100);
    return () => { cancelAnimationFrame(raf); clearInterval(id); };
  }, [phase]);

  useEffect(() => {
    if (phase !== "custom") return; const cv = pvRef.current; if (!cv) return;
    const c = cv.getContext("2d")!; cv.width = 240; cv.height = 150;
    const gr = c.createLinearGradient(0, 0, 0, 150); gr.addColorStop(0, "#62c3ee"); gr.addColorStop(1, "#cdeef6"); c.fillStyle = gr; c.fillRect(0, 0, 240, 150);
    const an = ANIMALS.find(a => a.k === prof.kind) ?? ANIMALS[0];
    drawCritter(c, 120, 82, -.1, prof.kind, prof.color || an.col, prof.acc, 0.6, 2.4);
  }, [phase, prof]);

  const videoEl = <video ref={video} playsInline muted aria-label="Your camera preview (mirrored)"
    className={phase === "play" && preview ? "fixed right-3 top-3 z-40 h-20 w-28 -scale-x-100 rounded-2xl object-cover shadow-soft" : "pointer-events-none fixed h-px w-px opacity-0"} />;
  const next = UNLOCKS.find(u => u.need > prof.total);
  const body = () => {
    if (phase === "loading") return <main className="grid min-h-dvh place-items-center text-navy/60">Loading…</main>;
    if (phase === "nocal") return (<main className="mx-auto max-w-md px-6 pt-24"><h1 className="font-display text-3xl">Let’s set up your camera first.</h1>
      <p className="mt-4 text-navy/70">{msg ?? "Mirror Flight uses your saved calibration so it fits your own comfortable movements."}</p>
      <a className="btn-primary mt-8 inline-flex w-full items-center justify-center" href="/calibrate">Go to camera setup</a></main>);
    if (phase === "done") return (
      <main className="mx-auto max-w-md px-6 pb-12 pt-20">
        <h1 className="font-display text-3xl">Lovely flight.</h1>
        <p className="mt-3 text-navy/70">{result.holds > 0 ? `You completed ${result.holds} comfortable ${result.holds === 1 ? "hold" : "holds"} while flying.` : "You took part in today’s exercise."}</p>
        <ul className="mt-6 grid gap-2 rounded-3xl bg-paper p-5 text-sm shadow-soft">
          <li>Flying time: {Math.floor(result.time / 60)} min {Math.round(result.time % 60)} s</li><li>Pillars passed: {result.score}</li>
          <li>Coins collected: {result.got}{result.saved ? "" : " (not saved)"}</li><li>Longest comfortable hold: {result.longest.toFixed(1)} s</li>
          <li>Rest meadows: {result.rests}</li><li>Soft bumps (no penalty): {result.bumps}</li><li>Camera adjustments needed: {result.pauses}</li>
          <li>Movements used: {result.keys.join(", ") || "none"}</li></ul>
        {result.unlocked.length > 0 && <p className="mt-4 rounded-2xl bg-gold/20 p-4 text-sm"><b>New unlock:</b> {result.unlocked.join(", ")}. Visit “Customize your flyer”.</p>}
        {dbMsg && <p role="alert" className="mt-3 rounded-2xl bg-lav/40 p-3 text-sm">{dbMsg}</p>}
        <p className="mt-3 text-xs text-navy/50">Camera-derived estimates of game engagement, not a clinical measure. This session isn’t saved to your history yet; that comes with the session-tracking milestone.</p>
        <button className="btn-primary mt-6 w-full" onClick={() => setPhase("menu")}>Fly again</button>
        <a className="btn-quiet mt-3 inline-flex w-full items-center justify-center" href="/dashboard">Back to dashboard</a></main>);
    if (phase === "custom") return (
      <main className="mx-auto max-w-md px-6 pb-12 pt-[max(2rem,env(safe-area-inset-top))]">
        <h1 className="font-display text-3xl">Customize your flyer</h1>
        <p className="mt-2 text-sm text-navy/70">You’ve collected <b>{prof.total}</b> coins in total. Coins are never spent, so everything you unlock stays yours.{next ? ` Next unlock: ${next.label} at ${next.need} coins (${next.need - prof.total} to go).` : " You’ve unlocked everything."}</p>
        <canvas ref={pvRef} className="mt-4 w-full rounded-3xl shadow-soft" aria-label="Preview of your flyer" />
        <h2 className="mt-6 font-display text-xl">Friend</h2>
        <div className="mt-2 grid grid-cols-2 gap-3">{ANIMALS.map(a => { const ok = prof.total >= a.need; return (
          <button key={a.k} disabled={!ok} aria-pressed={prof.kind === a.k} onClick={() => pick({ ...prof, kind: a.k })}
            className={`min-h-[56px] rounded-2xl border px-3 text-left ${prof.kind === a.k ? "border-teal bg-teal/10 shadow-soft" : "border-navy/15 bg-paper"} disabled:opacity-50`}>{a.n}<br /><span className="text-xs text-navy/60">{ok ? "Unlocked" : `🔒 ${a.need} coins`}</span></button>); })}</div>
        <h2 className="mt-6 font-display text-xl">Color</h2>
        <div className="mt-2 flex flex-wrap gap-3">{COLORS.map(co => { const ok = prof.total >= co.need; return (
          <button key={co.n} disabled={!ok} aria-label={`${co.n}${ok ? "" : `, unlocks at ${co.need} coins`}`} aria-pressed={prof.color === co.c} onClick={() => pick({ ...prof, color: co.c })}
            className={`grid h-14 w-14 place-items-center rounded-full border-2 text-xs ${prof.color === co.c ? "border-navy" : "border-navy/15"} disabled:opacity-40`} style={{ background: co.c || "#f4efe4" }}>{ok ? (co.c ? "" : "Auto") : "🔒"}</button>); })}</div>
        <h2 className="mt-6 font-display text-xl">Accessory</h2>
        <div className="mt-2 grid grid-cols-2 gap-3">{ACCS.map(a => { const ok = prof.total >= a.need; return (
          <button key={a.n} disabled={!ok} aria-pressed={prof.acc === a.k} onClick={() => pick({ ...prof, acc: a.k })}
            className={`min-h-[52px] rounded-2xl border px-3 text-left ${prof.acc === a.k ? "border-teal bg-teal/10 shadow-soft" : "border-navy/15 bg-paper"} disabled:opacity-50`}>{a.n}<br /><span className="text-xs text-navy/60">{ok ? "Unlocked" : `🔒 ${a.need} coins`}</span></button>); })}</div>
        {dbMsg && <p role="alert" className="mt-3 rounded-2xl bg-lav/40 p-3 text-sm">{dbMsg}</p>}
        <button className="btn-primary mt-8 w-full" onClick={() => setPhase("menu")}>Done</button>
      </main>);
    if (phase === "menu") return (
      <main className="mx-auto max-w-md px-6 pb-12 pt-[max(2rem,env(safe-area-inset-top))]">
        <h1 className="font-display text-3xl">Mirror Flight</h1>
        <p className="mt-3 text-navy/70">Glide through the gaps and collect coins using your own gentle movements. Hold your movement and the bird flies the path for you. Relax and it drifts down gently. If you bump a pillar you’re simply guided back on track. Only use movements your clinician has approved.</p>
        <div className="mt-4 flex items-center justify-between rounded-2xl bg-paper p-4 shadow-soft"><span>🪙 <b>{prof.total}</b> coins</span><button className="btn-quiet min-h-[44px] px-4" onClick={() => setPhase("custom")}>Customize your flyer</button></div>
        <h2 className="mt-6 font-display text-xl">Your movement</h2>
        <div className="mt-2 grid gap-3" role="radiogroup">{KEYS.filter(k => cal[k]).map(k => (
          <button key={k} role="radio" aria-checked={sel === k} onClick={() => setSel(k)} className={`min-h-[56px] rounded-2xl border px-4 text-left ${sel === k ? "border-teal bg-teal/10 shadow-soft" : "border-navy/15 bg-paper"}`}>{NAMES[k]}</button>))}</div>
        {Object.keys(cal).length > 1 && <label className="mt-3 flex items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 accent-teal" checked={rotate} onChange={e => setRotate(e.target.checked)} />Rotate through all my calibrated movements</label>}
        {rotate && <label className="mt-2 block text-sm">Change movement every<select className="field mt-1" value={rotSec} onChange={e => setRotSec(+e.target.value)}>{[10, 20, 30].map(n => <option key={n} value={n}>{n} seconds</option>)}</select></label>}
        <div className="mt-5 grid gap-3 text-sm">
          <label>Control style<select className="field mt-1" value={mode} onChange={e => setMode(e.target.value as "path" | "hold" | "pulse")}><option value="path">Hold to stay on the path (recommended)</option><option value="hold">Hold to rise, relax to sink</option><option value="pulse">Pulse to flap</option></select></label>
          <label>Flight length<select className="field mt-1" value={minutes} onChange={e => setMinutes(+e.target.value)}><option value={3}>3 minutes</option><option value={6}>6 minutes</option><option value={10}>10 minutes</option><option value={0}>No limit (stop when I rest)</option></select></label>
          <label>Gap size<select className="field mt-1" value={gap} onChange={e => setGap(+e.target.value)}><option value={250}>Wide</option><option value={290}>Extra wide (recommended)</option><option value={330}>Huge</option></select></label>
          <label>Rest meadow<select className="field mt-1" value={restEvery} onChange={e => setRestEvery(+e.target.value)}><option value={10}>Every 10 seconds</option><option value={15}>Every 15 seconds (recommended)</option><option value={25}>Every 25 seconds</option><option value={0}>Off</option></select></label>
          <label>Pace<select className="field mt-1" value={pace} onChange={e => setPace(+e.target.value)}><option value={60}>Very slow</option><option value={75}>Slow (recommended)</option><option value={100}>Normal</option></select></label>
          <label>Sensitivity (you can change this during the flight too)<select className="field mt-1" value={gain} onChange={e => setGain(+e.target.value)}><option value={1}>1. Standard (your calibrated target)</option><option value={1.3}>2. Easy</option><option value={1.7}>3. Very easy (recommended)</option><option value={2.2}>4. Extra easy</option><option value={3}>5. Tiny movements count</option></select></label>
        </div>
        <p className="mt-4 text-xs text-navy/60">Your camera is processed on this device. Video is never uploaded or saved. The game never gets harder on its own.</p>
        {dbMsg && <p role="alert" className="mt-3 rounded-2xl bg-lav/40 p-3 text-sm">{dbMsg}</p>}
        {msg && <p role="alert" className="mt-3 rounded-2xl bg-lav/40 p-3 text-sm">{msg}</p>}
        <button className="btn-primary mt-5 w-full" disabled={busy} onClick={begin}>{busy ? "Starting camera…" : "Start camera and fly"}</button>
      </main>);
    return (
      <div className="fixed inset-0 flex flex-col bg-navy">
        <div className="relative min-h-0 flex-1">
          <canvas ref={cvRef} className="h-full w-full" style={{ objectFit: "contain" }} aria-label="Side-scrolling flight. Hold your movement to rise and relax to sink." />
          <div className="absolute left-3 top-3 rounded-full bg-paper/90 px-4 py-2 text-sm shadow-soft" role="status">🪙 {ui.got}</div>
          <div className="absolute inset-x-3 top-14 rounded-2xl bg-paper/85 p-2 text-center text-xs shadow-soft" role="status">
            {ui.ease > 0 ? `Now: ${NAMES[ui.key]}. Take a moment to get ready.` : `${NAMES[ui.key]}: ${mode === "path" ? "hold past the line and the bird flies the path. Relax and it drifts down" : "hold past the line to rise, relax to sink"}`}</div>
          {(ui.adjust || ui.paused) && <div className="absolute inset-0 z-30 grid place-items-center bg-navy/60 p-8 text-center text-ivory" role="alert"><div>
            <p className="font-display text-2xl">{ui.paused ? "Paused" : "Let’s adjust your camera"}</p>
            <p className="mt-2 text-sm">{ui.paused ? "Take as long as you need." : "We can’t see your face clearly. Center it and add light. The game waits and nothing is counted against you."}</p>
            {ui.paused && <button className="btn-primary mt-5" onClick={() => { g.current.manual = false; }}>Resume</button>}</div></div>}
        </div>
        <div className="shrink-0 bg-paper p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="relative h-3 rounded-full bg-mist" role="progressbar" aria-label="Your movement" aria-valuenow={Math.round(ui.lev * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-3 rounded-full bg-teal transition-[width] duration-100" style={{ width: `${ui.lev * 100}%` }} /><div className="absolute -top-1 h-5 w-0.5 bg-navy/60" style={{ left: `${HOVER * 100}%` }} /></div>
          <p className="mt-1 text-xs text-navy/60">{ui.inRest ? "Rest meadow: relax and float." : (mode === "path" ? "Past the line = the bird stays on the path. Relaxed = drifts down gently." : "Past the line = rise. Relaxed = glide down gently.")}</p>
          <div className="mt-2 flex items-center gap-2 text-xs"><span className="flex-1">Sensitivity {Math.max(1, GAINS.indexOf(gain) + 1)} of 5. Not rising? Try Easier. Rising too fast? Try Harder.</span>
            <button className="btn-quiet min-h-[44px] px-4" onClick={() => setGain(GAINS[Math.min(GAINS.length - 1, Math.max(0, GAINS.indexOf(gain)) + 1)])}>Easier</button>
            <button className="btn-quiet min-h-[44px] px-4" onClick={() => setGain(GAINS[Math.max(0, Math.max(0, GAINS.indexOf(gain)) - 1)])}>Harder</button></div>
          <div className="mt-2 grid grid-cols-4 gap-2">
            <button className="btn-quiet min-h-[44px] px-2" onClick={() => { g.current.manual = true; }}>Pause</button>
            <button className="btn-quiet min-h-[44px] px-2" onClick={() => leave("menu")}>Rest</button>
            <button className="btn-quiet min-h-[44px] px-2" onClick={() => setPreview(p => !p)}>{preview ? "Hide cam" : "Show cam"}</button>
            <button className="btn-quiet min-h-[44px] px-2" onClick={() => leave("dashboard")}>Exit</button></div>
        </div>
      </div>);
  };
  return <>{videoEl}{body()}</>;
}
