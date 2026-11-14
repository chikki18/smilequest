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
  lostSince: number | null; adjust: boolean; manual: boolean; wh: number; py: number; hint: string; run: number; pend: Record<M, number>;
};
const z5 = () => ({ jump: 0, fly: 0, duck: 0, right: 0, left: 0 });
const fresh = (wh: number): G => ({
  stage: "ready", readyLeft: 6, t: 0, dist: 0, lane: 1, lanePos: 1, cd: 0, jumpT: 0, crouchT: 0, jet: 0, fuel: 1,
  on: { jump: false, fly: false, duck: false, right: false, left: false }, lev: z5(), rows: [], coins: [], spawnZ: 60, speed: 0, mul: 1, invuln: 0, coinsGot: 0, points: 0,
  streak: 0, best: 0, cleared: 0, stumbles: 0, top: 0, counts: z5(), clearedBy: {}, stumbledBy: {}, lostSince: null, adjust: false, manual: false, wh, py: wh - BOTBAR - 40, hint: "", run: 0, pend: z5(),
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

type Pal = Record<string, string>;
const PALS: { night: Pal; morning: Pal } = {
  night: { skyTop: "#0a0b2a", skyMid: "#2b1a78", skyLow: "#9a68e0", sunIn: "rgba(215,235,255,.95)", sunMid: "rgba(150,170,255,.5)", sunOut: "rgba(130,110,255,0)", ridge1: "#262a7a", ridge2: "#171a52", temple: "#0c0d2e", templeGlow: "rgba(143,208,255,.95)", floor0: "#1a1f5a", floor1: "#0b0c2a", pathA: "#5a5f9e", pathB: "#51568f", edgeA: "#3d6fb5", edgeB: "#355f9f", crack: "rgba(8,8,32,.5)", groove: "rgba(8,8,40,.35)", ledge: "#23246a", trunk: "#14153f", can1: "#1c2160", can2: "#241a6b", can3: "#12143f", torchPost: "#3b3f7a", flameA: "rgba(170,220,255,.9)", flameB: "rgba(120,140,255,.4)", flameC: "rgba(110,100,255,0)", flameCore: "#d6efff", fog: "rgba(150,110,230,", stone: "#6d73b0", stoneLite: "#8c92cc", stoneDark: "#1f2050", moss: "#4b79c4", vine: "#5a9be0", glyph: "rgba(150,210,255,.95)", gate: "#5a4a8c", gateLite: "#7a68b4", gateGlyph: "rgba(220,140,255,.95)", gateGlow: "rgba(200,110,255,", coinGlow: "rgba(150,210,255,", coin: "#6fb8f5", coinEdge: "#1b4a8c", coinHi: "#e4f5ff", ember: "rgba(170,215,255,.6)", vig: "rgba(4,4,24,.62)", scarf: "#5ab6f0" },
  morning: { skyTop: "#8f8bc8", skyMid: "#c3c1e6", skyLow: "#f2ecfb", sunIn: "rgba(255,255,255,.95)", sunMid: "rgba(255,230,240,.5)", sunOut: "rgba(255,220,240,0)", ridge1: "#a7a4d8", ridge2: "#8a86c6", temple: "#5c58a3", templeGlow: "rgba(255,255,255,.95)", floor0: "#9d9ad4", floor1: "#7773b8", pathA: "#c3c1e6", pathB: "#b8b6de", edgeA: "#8ec5f0", edgeB: "#7fb7e6", crack: "rgba(60,56,120,.35)", groove: "rgba(60,56,120,.25)", ledge: "#6a67b0", trunk: "#4a4790", can1: "#7a76c2", can2: "#8a80d0", can3: "#6560ac", torchPost: "#6f6bb4", flameA: "rgba(255,255,255,.9)", flameB: "rgba(183,156,255,.45)", flameC: "rgba(183,156,255,0)", flameCore: "#ffffff", fog: "rgba(242,236,251,", stone: "#a5a3d2", stoneLite: "#c4c2e8", stoneDark: "#5d5a9e", moss: "#6fb0e6", vine: "#5aa0e0", glyph: "rgba(83,80,154,.95)", gate: "#8d7fc0", gateLite: "#aa9ed6", gateGlyph: "rgba(120,60,200,.95)", gateGlow: "rgba(150,90,230,", coinGlow: "rgba(110,170,240,", coin: "#6fb8f5", coinEdge: "#1b4a8c", coinHi: "#e4f5ff", ember: "rgba(255,255,255,.7)", vig: "rgba(40,36,100,.35)", scarf: "#4aa8ec" },
};
let PAL: Pal = PALS.night;
const refreshPal = () => { PAL = typeof document !== "undefined" && document.documentElement.dataset.theme === "morning" ? PALS.morning : PALS.night; };
function ridge(c: CanvasRenderingContext2D, y: number, col: string, amp: number, f: number, ph: number, sh: number) {
  c.fillStyle = col; c.beginPath(); c.moveTo(0, y);
  for (let x = 0; x <= W + 12; x += 12) c.lineTo(x, y - amp * (.55 + .3 * Math.sin((x + sh) * f + ph) + .15 * Math.sin((x + sh) * f * 2.7 + ph * 2)));
  c.lineTo(W, y); c.closePath(); c.fill();
}
function stoneRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, sc: number, base: string, lite: string) {
  const P = PAL;
  const g = c.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, lite); g.addColorStop(.55, base); g.addColorStop(1, P.stoneDark);
  c.fillStyle = g; c.fillRect(x, y, w, h);
  c.fillStyle = "rgba(255,240,200,.14)"; c.fillRect(x, y, w, Math.max(1, 3 * sc));
  c.strokeStyle = "rgba(12,9,6,.75)"; c.lineWidth = Math.max(1, 1.6 * sc); c.strokeRect(x, y, w, h);
  c.strokeStyle = "rgba(12,9,6,.35)"; c.lineWidth = Math.max(.7, 1 * sc); c.beginPath(); c.moveTo(x + w * .3, y + h * .12); c.lineTo(x + w * .42, y + h * .5); c.lineTo(x + w * .34, y + h * .8); c.stroke();
}
function moss(c: CanvasRenderingContext2D, x: number, y: number, w: number, sc: number) {
  c.fillStyle = PAL.moss; c.beginPath(); c.moveTo(x, y); for (let i = 0; i <= 6; i++) c.lineTo(x + w * i / 6, y + (i % 2 ? 7 : 2) * sc); c.lineTo(x + w, y - 2 * sc); c.lineTo(x, y - 2 * sc); c.closePath(); c.fill();
}
function glyph(c: CanvasRenderingContext2D, x: number, y: number, r: number, col: string) {
  c.strokeStyle = col; c.lineWidth = Math.max(1, r * .22); c.beginPath(); c.arc(x, y, r, 0, 7); c.moveTo(x - r * .5, y); c.lineTo(x + r * .5, y); c.moveTo(x, y - r * .5); c.lineTo(x, y + r * .5); c.stroke();
}
function drawFox(c: CanvasRenderingContext2D, px: number, y0: number, bodyH: number, lift: number, s: G, now: number) {
  const hy = y0 - bodyH - 6, sw = Math.sin(now / 75), tw = Math.sin(now / 150) * 9 * (lift > 5 ? .4 : 1);
  c.lineJoin = "round"; c.strokeStyle = "#20120a"; c.lineWidth = 1.6;
  // tail
  const tg = c.createLinearGradient(px, y0, px + 40, y0 - 50); tg.addColorStop(0, "#c95f25"); tg.addColorStop(.7, "#e0813a"); tg.addColorStop(1, "#f6e6c8");
  c.fillStyle = tg; c.beginPath(); c.moveTo(px + 3, y0 - 20); c.bezierCurveTo(px + 24, y0 - 14, px + 44 + tw, y0 - 34, px + 38 + tw, y0 - 58); c.bezierCurveTo(px + 24 + tw, y0 - 46, px + 14, y0 - 38, px - 2, y0 - 32); c.closePath(); c.fill(); c.stroke();
  // legs
  const run = lift > 5 ? 0 : 1;
  for (const [dx, ph] of [[-9, 0], [3, Math.PI]] as [number, number][]) { const up = Math.max(0, Math.sin(now / 75 + ph)) * 6 * run;
    c.fillStyle = "#3b2616"; c.beginPath(); c.roundRect(px + dx, y0 - 20 - up, 7, 20, 3); c.fill(); c.stroke(); c.fillStyle = "#1e120a"; c.beginPath(); c.roundRect(px + dx - 1, y0 - 5 - up, 9, 5, 2); c.fill(); }
  // pack + jet
  if (s.jet > .05) { const fl = 14 + Math.random() * 12 + s.jet * 14; for (const dx of [-11, 5]) { const fg = c.createLinearGradient(0, y0 - bodyH + 26, 0, y0 - bodyH + 26 + fl); fg.addColorStop(0, "#fff6d6"); fg.addColorStop(.4, "#7fd6ff"); fg.addColorStop(1, "rgba(80,150,255,0)"); c.fillStyle = fg; c.beginPath(); c.moveTo(px + dx, y0 - bodyH + 26); c.lineTo(px + dx + 7, y0 - bodyH + 26); c.lineTo(px + dx + 3.5, y0 - bodyH + 26 + fl); c.closePath(); c.fill(); } }
  // body
  const bg = c.createLinearGradient(px - 17, 0, px + 17, 0); bg.addColorStop(0, "#e07a32"); bg.addColorStop(1, "#a84a1c");
  c.fillStyle = bg; c.beginPath(); c.roundRect(px - 16, y0 - bodyH + 2, 32, bodyH - 14, 12); c.fill(); c.stroke();
  c.fillStyle = s.jet > .05 ? "#b98a3a" : "#5a3a1e"; c.beginPath(); c.roundRect(px - 12, y0 - bodyH + 8, 24, Math.max(14, bodyH * .42), 4); c.fill(); c.stroke();
  if (s.jet > .05) { c.fillStyle = "#3a2a10"; c.fillRect(px - 11, y0 - bodyH + 24, 7, 4); c.fillRect(px + 4, y0 - bodyH + 24, 7, 4); }
  // scarf
  c.fillStyle = PAL.scarf; c.beginPath(); c.ellipse(px, y0 - bodyH + 2, 15, 5, 0, 0, 7); c.fill(); c.stroke();
  c.beginPath(); c.moveTo(px - 12, y0 - bodyH + 3); c.quadraticCurveTo(px - 30 - sw * 3, y0 - bodyH + 6 + sw * 3, px - 40 - sw * 4, y0 - bodyH - 2 + sw * 5); c.lineTo(px - 38 - sw * 4, y0 - bodyH + 8 + sw * 5); c.quadraticCurveTo(px - 26, y0 - bodyH + 12, px - 8, y0 - bodyH + 8); c.closePath(); c.fill(); c.stroke();
  // head and ears
  c.fillStyle = "#d4672a"; for (const sd of [-1, 1]) { c.beginPath(); c.moveTo(px + sd * 13, hy - 6); c.lineTo(px + sd * 12, hy - 28); c.lineTo(px + sd * 2, hy - 13); c.closePath(); c.fill(); c.stroke(); c.fillStyle = "#2a1a0e"; c.beginPath(); c.moveTo(px + sd * 12, hy - 28); c.lineTo(px + sd * 11, hy - 20); c.lineTo(px + sd * 6, hy - 17); c.closePath(); c.fill(); c.fillStyle = "#d4672a"; }
  const hg = c.createRadialGradient(px - 4, hy - 4, 2, px, hy, 16); hg.addColorStop(0, "#f09a50"); hg.addColorStop(1, "#c85c22");
  c.fillStyle = hg; c.beginPath(); c.ellipse(px, hy, 15, 14, 0, 0, 7); c.fill(); c.stroke();
}
function drawWorld(c: CanvasRenderingContext2D, s: G, now: number) {
  refreshPal();
  const wh = s.wh, PY = s.py, cx = W / 2, yOf = (sc: number) => HZ + (PY - HZ) * sc, shift = (s.lanePos - 1) * 14;
  // sky
  const P = PAL, sky = c.createLinearGradient(0, 0, 0, HZ + 6); sky.addColorStop(0, P.skyTop); sky.addColorStop(.55, P.skyMid); sky.addColorStop(1, P.skyLow); c.fillStyle = sky; c.fillRect(0, 0, W, HZ + 6);
  const sg = c.createRadialGradient(cx + 40, HZ - 8, 4, cx + 40, HZ - 8, 130); sg.addColorStop(0, P.sunIn); sg.addColorStop(.25, P.sunMid); sg.addColorStop(1, P.sunOut); c.fillStyle = sg; c.fillRect(0, 0, W, HZ + 6);
  ridge(c, HZ + 2, P.ridge1, 46, .021, 1.2, shift * .3); ridge(c, HZ + 2, P.ridge2, 30, .034, 3.4, shift * .6);
  // distant temple
  c.fillStyle = P.temple; for (let i = 0; i < 4; i++) { const w = 130 - i * 30, h = 11; c.fillRect(cx - 40 - w / 2 + shift * .8, HZ - 6 - (i + 1) * h, w, h); }
  c.fillRect(cx - 40 - 12 + shift * .8, HZ - 6 - 4 * 11 - 14, 24, 14); c.fillStyle = P.templeGlow; c.fillRect(cx - 40 - 3 + shift * .8, HZ - 6 - 4 * 11 - 8, 6, 8);
  // jungle floor
  const fl = c.createLinearGradient(0, HZ, 0, wh); fl.addColorStop(0, P.floor0); fl.addColorStop(1, P.floor1); c.fillStyle = fl; c.fillRect(0, HZ, W, wh - HZ);
  // path
  const b0 = Math.floor(s.dist / 4);
  for (let i = 30; i >= -2; i--) {
    const zn = (b0 + i) * 4 - s.dist, zf = zn + 4, sn = sOf(Math.max(zn, -8)), sf = sOf(zf), odd = (b0 + i) % 2;
    c.fillStyle = odd ? P.pathA : P.pathB; c.beginPath(); c.moveTo(cx - 150 * sf, yOf(sf)); c.lineTo(cx + 150 * sf, yOf(sf)); c.lineTo(cx + 150 * sn, yOf(sn)); c.lineTo(cx - 150 * sn, yOf(sn)); c.closePath(); c.fill();
    for (const sd of [-1, 1]) { c.fillStyle = odd ? P.edgeA : P.edgeB; c.beginPath(); c.moveTo(cx + sd * 150 * sf, yOf(sf)); c.lineTo(cx + sd * 172 * sf, yOf(sf)); c.lineTo(cx + sd * 172 * sn, yOf(sn)); c.lineTo(cx + sd * 150 * sn, yOf(sn)); c.closePath(); c.fill(); }
    c.strokeStyle = P.crack; c.lineWidth = Math.max(.6, 1.6 * sn); c.beginPath(); c.moveTo(cx - 150 * sn, yOf(sn)); c.lineTo(cx + 150 * sn, yOf(sn)); c.stroke();
  }
  c.strokeStyle = P.groove; c.lineWidth = 2; for (const x of [-50, 50]) { c.beginPath(); c.moveTo(cx + x * sOf(120), yOf(sOf(120))); c.lineTo(cx + x * sOf(-8), yOf(sOf(-8))); c.stroke(); }
  c.strokeStyle = P.ledge; c.lineWidth = 3; for (const x of [-150, 150]) { c.beginPath(); c.moveTo(cx + x * sOf(120), yOf(sOf(120))); c.lineTo(cx + x * sOf(-8), yOf(sOf(-8))); c.stroke(); }
  // trees and torches
  const k0 = Math.ceil(s.dist / 9);
  for (let i = 12; i >= 0; i--) for (const side of [-1, 1]) {
    const idx = k0 + i, z = idx * 9 - s.dist, sc = sOf(z); if (sc > 1.35) continue; const y = yOf(sc), h = (idx * 37 + (side > 0 ? 11 : 0)) % 100;
    const x = cx + side * (205 + h % 40) * sc; c.globalAlpha = clamp(1.3 - z / 90, .2, 1);
    c.fillStyle = P.trunk; c.fillRect(x - 9 * sc, y - 210 * sc, 18 * sc, 210 * sc);
    for (const [ox, oy, r, col] of [[0, -215, 62, P.can1], [-34, -190, 46, P.can2], [32, -196, 48, P.can3]] as [number, number, number, string][]) { c.fillStyle = col; c.beginPath(); c.arc(x + ox * sc, y + oy * sc, r * sc, 0, 7); c.fill(); }
    if (idx % 3 === 0) { const tx = cx + side * 164 * sc, ty = y - 40 * sc; c.fillStyle = P.torchPost; c.fillRect(tx - 5 * sc, ty, 10 * sc, 40 * sc); const fr = 22 * sc * (1 + .12 * Math.sin(now / 90 + idx)); const fg = c.createRadialGradient(tx, ty - 6 * sc, 1, tx, ty - 6 * sc, fr * 2); fg.addColorStop(0, P.flameA); fg.addColorStop(.4, P.flameB); fg.addColorStop(1, P.flameC); c.fillStyle = fg; c.beginPath(); c.arc(tx, ty - 6 * sc, fr * 2, 0, 7); c.fill(); c.fillStyle = P.flameCore; c.beginPath(); c.ellipse(tx, ty - 6 * sc, 4.5 * sc, 8 * sc, 0, 0, 7); c.fill(); }
    c.globalAlpha = 1;
  }
  const fog = c.createLinearGradient(0, HZ - 6, 0, HZ + 120); fog.addColorStop(0, P.fog + ".55)"); fog.addColorStop(1, P.fog + "0)"); c.fillStyle = fog; c.fillRect(0, HZ - 6, W, 126);
  // objects far -> near
  type Obj = { d: number; draw: () => void };
  const objs: Obj[] = [];
  for (const r of s.rows) {
    const d = r.z - s.dist; if (d > 95 || d < -6) continue; const sc = sOf(d), y = yOf(sc);
    objs.push({ d, draw: () => { c.globalAlpha = clamp(1.3 - d / 80, .15, 1); for (const l of r.lanes) {
      const x = cx + (l - 1) * LANE * sc;
      if (r.kind === "hurdle") { stoneRect(c, x - 41 * sc, y - 40 * sc, 82 * sc, 40 * sc, sc, P.stone, P.stoneLite); moss(c, x - 41 * sc, y - 40 * sc, 82 * sc, sc); glyph(c, x, y - 18 * sc, 8 * sc, P.glyph); }
      else if (r.kind === "bar") {
        for (const sd of [-1, 1]) stoneRect(c, x + sd * 40 * sc - 8 * sc, y - 96 * sc, 16 * sc, 96 * sc, sc, P.stone, P.stoneLite);
        stoneRect(c, x - 52 * sc, y - 94 * sc, 104 * sc, 28 * sc, sc, P.stone, P.stoneLite); moss(c, x - 52 * sc, y - 94 * sc, 104 * sc, sc); glyph(c, x, y - 80 * sc, 7 * sc, P.glyph);
        c.strokeStyle = P.vine; c.lineWidth = Math.max(1, 2.4 * sc); for (let i = 0; i < 5; i++) { const vx = x - 40 * sc + i * 20 * sc; c.beginPath(); c.moveTo(vx, y - 66 * sc); c.quadraticCurveTo(vx + Math.sin(now / 500 + i) * 4 * sc, y - 56 * sc, vx, y - (46 + (i * 7) % 12) * sc); c.stroke(); } }
      else { const full = r.kind === "full"; stoneRect(c, x - 44 * sc, y - 152 * sc, 88 * sc, 152 * sc, sc, full ? P.gate : P.stone, full ? P.gateLite : P.stoneLite);
        moss(c, x - 44 * sc, y - 152 * sc, 88 * sc, sc); const gl = full ? P.gateGlyph : P.glyph;
        c.fillStyle = gl; c.fillRect(x - 24 * sc, y - 108 * sc, 14 * sc, 5 * sc); c.fillRect(x + 10 * sc, y - 108 * sc, 14 * sc, 5 * sc); c.fillRect(x - 14 * sc, y - 84 * sc, 28 * sc, 5 * sc); glyph(c, x, y - 130 * sc, 9 * sc, gl); glyph(c, x, y - 44 * sc, 9 * sc, gl);
        if (full) { const gg = c.createRadialGradient(x, y - 90 * sc, 4, x, y - 90 * sc, 70 * sc); gg.addColorStop(0, P.gateGlow + ".3)"); gg.addColorStop(1, P.gateGlow + "0)"); c.fillStyle = gg; c.fillRect(x - 70 * sc, y - 160 * sc, 140 * sc, 160 * sc); } }
    } c.globalAlpha = 1; } });
  }
  for (const co of s.coins) {
    if (co.got) continue; const d = co.z - s.dist; if (d > 95 || d < -6) continue; const sc = sOf(d), y = yOf(sc), x = cx + (co.lane - 1) * LANE * sc;
    objs.push({ d, draw: () => { const cyp = y - (16 + co.cy * 90) * sc, wv = .35 + .65 * Math.abs(Math.sin(now / 260 + co.z)); c.globalAlpha = clamp(1.3 - d / 80, .15, 1);
      const gg = c.createRadialGradient(x, cyp, 1, x, cyp, 20 * sc); gg.addColorStop(0, P.coinGlow + ".45)"); gg.addColorStop(1, P.coinGlow + "0)"); c.fillStyle = gg; c.beginPath(); c.arc(x, cyp, 20 * sc, 0, 7); c.fill();
      c.fillStyle = P.coin; c.strokeStyle = P.coinEdge; c.lineWidth = Math.max(1, 1.6 * sc); c.beginPath(); c.ellipse(x, cyp, 11 * sc * wv, 11 * sc, 0, 0, 7); c.fill(); c.stroke();
      c.fillStyle = P.coinHi; c.beginPath(); c.ellipse(x - 1.5 * sc * wv, cyp - 1.5 * sc, 6 * sc * wv, 6 * sc, 0, 0, 7); c.fill(); c.globalAlpha = 1; } });
  }
  objs.sort((a, b) => b.d - a.d);
  for (const o of objs) if (o.d >= 0) o.draw();
  // player
  const px = cx + (s.lanePos - 1) * LANE, jumpH = s.jumpT > 0 ? Math.sin(Math.PI * (1 - s.jumpT / .7)) : 0, lift = jumpH * 80 + s.jet * 120;
  const crouch = s.crouchT > 0 && lift < 5, bodyH = crouch ? 40 : 66, y0 = PY - lift;
  c.fillStyle = "rgba(0,0,0,.32)"; c.beginPath(); c.ellipse(px, PY + 2, 24 - lift * .07, 7, 0, 0, 7); c.fill();
  if (lift < 5) for (let i = 0; i < 4; i++) { const t = (now / 320 + i * .25) % 1; c.fillStyle = `rgba(214,198,160,${(1 - t) * .35})`; c.beginPath(); c.arc(px + (i - 1.5) * 9, PY - t * 10, 3 + t * 6, 0, 7); c.fill(); }
  c.globalAlpha = s.invuln > 0 && Math.floor(now / 110) % 2 ? .55 : 1; drawFox(c, px, y0, bodyH, lift, s, now); c.globalAlpha = 1;
  for (const o of objs) if (o.d < 0) o.draw();
  // embers + vignette
  c.fillStyle = P.ember; for (let i = 0; i < 16; i++) { const x = (i * 67 + Math.sin(now / 900 + i) * 14 + W) % W, y = wh - ((now * .02 * (1 + i % 3) + i * 61) % (wh - HZ)); c.beginPath(); c.arc(x, y, 1 + (i % 3) * .5, 0, 7); c.fill(); }
  const vg = c.createRadialGradient(cx, wh * .55, wh * .25, cx, wh * .55, wh * .75); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, P.vig); c.fillStyle = vg; c.fillRect(0, 0, W, wh);
}


const TONE = "rgb(var(--teal))";
function Rune({ m, size = 36, on = false, tone = TONE }: { m: M; size?: number; on?: boolean; tone?: string }) {
  const P: Record<M, string> = { jump: "M7 17l5-5 5 5M7 11l5-5 5 5", fly: "M12 3c3 4 5 7 5 10a5 5 0 0 1-10 0c0-3 2-6 5-10zM12 13v4", duck: "M7 7l5 5 5-5M7 13l5 5 5-5", right: "M9 5l7 7-7 7", left: "M15 5l-7 7 7 7" };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ color: on ? "#0f1038" : tone }} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="10.5" strokeOpacity=".45" strokeWidth="1.2" /><path d={P[m]} /></svg>;
}
function Face({ m, size = 140 }: { m: M | "rest"; size?: number }) {
  const sx = m === "right" ? 5 : m === "left" ? -5 : 0;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" stroke="currentColor" style={{ color: TONE }} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={m === "rest" ? "Relaxed face" : INFO[m].name}>
      <ellipse cx="50" cy="52" rx="32" ry="38" strokeOpacity=".5" />
      {m === "fly" ? <><path d="M26 34q9-9 18 0M56 34q9-9 18 0" /><circle cx="35" cy="46" r="4" fill="currentColor" /><circle cx="65" cy="46" r="4" fill="currentColor" /></>
        : m === "duck" ? <><path d="M26 34l18 7M74 34l-18 7" /><circle cx="36" cy="48" r="3" fill="currentColor" /><circle cx="64" cy="48" r="3" fill="currentColor" /></>
        : <><path d="M27 38q8-4 16 0M57 38q8-4 16 0" strokeOpacity=".7" /><circle cx="36" cy="47" r="3" fill="currentColor" /><circle cx="64" cy="47" r="3" fill="currentColor" /></>}
      {m === "jump" ? <path d="M33 68q17 14 34 0" /> : m === "duck" ? <path d="M35 76q15-12 30 0" /> : m === "right" || m === "left" ? <circle cx={50 + sx * 2} cy="70" r="6" /> : m === "fly" ? <path d="M40 70h20" /> : <path d="M38 70h24" strokeOpacity=".7" />}
    </svg>);
}
function Rule({ light = false }: { light?: boolean }) { return <div className="my-3 flex items-center gap-2" aria-hidden><span className={`h-px flex-1 bg-gradient-to-r from-transparent ${light ? "to-[#8fd0ff]/60" : "to-teal/60"}`} /><span className={`h-1.5 w-1.5 rotate-45 ${light ? "bg-[#8fd0ff]" : "bg-teal"}`} /><span className={`h-px flex-1 bg-gradient-to-l from-transparent ${light ? "to-[#8fd0ff]/60" : "to-teal/60"}`} /></div>; }
function Coin({ size = 24 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="10" fill="#d9a02c" stroke="#6e4a0c" strokeWidth="1.5" /><circle cx="12" cy="12" r="6" fill="none" stroke="#ffe08a" strokeWidth="1.5" /></svg>; }

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
  const hasCal = !!cal; const hubCv = useRef<HTMLCanvasElement>(null); const [hubBox, setHubBox] = useState({ w: 360, h: 640 });

  useEffect(() => { (async () => {
    const sb = supabase(); const { data: { user } } = await sb.auth.getUser();
    if (!user) { location.href = "/"; return; }
    setSt(loadSettings());
    const { data: c } = await sb.from("dash_calibration").select("summary").maybeSingle();
    const mv = c?.summary?.moves, okCal = !!mv && MOVES.every(m => mv[m]?.detectable); if (okCal) setCal(mv as Cal);
    const { data: cl } = await sb.from("consent_records").select("id").eq("kind", "exercise_clearance").eq("granted", true).limit(1);
    setClear(!!cl?.length); setView(new URLSearchParams(location.search).get("ready") === "1" && okCal ? "ready" : "hub");
  })(); return () => stop(); }, []);

  function stop() { tracker.current?.stop(); tracker.current = null; stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; latest.current = null; }
  function update(p: Partial<Settings>) { const n = { ...st, ...p }; setSt(n); saveSettings(n); }

  // ---- calibration ----
  function openCalibrate(_from: "play" | "settings") { location.href = "/calibrate?next=" + encodeURIComponent("/dash?ready=1"); }
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
      for (const m of MOVES) s.pend[m] = edge[m] ? .35 : Math.max(0, s.pend[m] - dt);
      if (s.cd <= 0 && s.pend.right > 0 && s.lane < 2) { s.lane++; s.cd = .2; s.counts.right++; s.pend.right = 0; }
      else if (s.cd <= 0 && s.pend.left > 0 && s.lane > 0) { s.lane--; s.cd = .2; s.counts.left++; s.pend.left = 0; }
      if (s.pend.jump > 0 && s.jet < .3) { s.crouchT = 0; if (s.jumpT <= 0) { s.jumpT = .7; s.counts.jump++; s.pend.jump = 0; } }
      if (s.pend.duck > 0 && s.jet < .3) { s.jumpT = 0; s.crouchT = .55; s.counts.duck++; s.pend.duck = 0; }
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
          if (hit) { r.hit = true; s.mul = .6; s.invuln = 1.8; s.streak = 0; { const gap = base * 1.4; for (const q of s.rows) if (q !== r && q.z - s.dist > 2) q.z += gap; for (const c2 of s.coins) if (c2.z - s.dist > 2) c2.z += gap; s.spawnZ += gap; } s.stumbles++; s.stumbledBy[r.kind] = (s.stumbledBy[r.kind] ?? 0) + 1; if (cfg.current.haptics) buzz(90); }
        }
        if (!r.done && dd < -1.2) { r.done = true; if (!r.hit && r.threat) { s.cleared++; s.points += 10; s.streak++; s.best = Math.max(s.best, s.streak); s.clearedBy[r.kind] = (s.clearedBy[r.kind] ?? 0) + 1; } }
        if (!hint && !r.done && dd > 0 && dd < 45 && r.lanes.includes(s.lane) && !r.hit) {
          if (r.kind === "hurdle") hint = "Smile to jump";
          else if (r.kind === "bar") hint = "Frown to duck";
          else if (r.kind === "full") hint = "Raise your eyebrows to fly";
          else { const free = [0, 1, 2].filter(l => !r.lanes.includes(l)).sort((a, b) => Math.abs(a - s.lane) - Math.abs(b - s.lane))[0]; hint = free == null ? "Raise your eyebrows to fly" : free > s.lane ? "Pucker to your right" : "Pucker to your left"; }
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
    if (view !== "hub") return; const cv = hubCv.current; if (!cv) return;
    const wh = clamp(Math.round(W * innerHeight / innerWidth), 560, 800), d = Math.min(2, devicePixelRatio || 1); cv.width = W * d; cv.height = wh * d; const ctx = cv.getContext("2d")!; ctx.setTransform(d, 0, 0, d, 0, 0);
    const fit = () => { const sc = Math.max(innerWidth / W, innerHeight / wh); setHubBox({ w: W * sc, h: wh * sc }); }; fit(); addEventListener("resize", fit);
    const s = fresh(wh); s.t = 40; let raf = 0, prev = performance.now();
    const loop = (now: number) => { raf = requestAnimationFrame(loop); const dt = Math.min(.05, (now - prev) / 1000); prev = now; s.dist += dt * 12; s.lanePos = 1 + Math.sin(now / 2200) * .85;
      while (s.spawnZ < s.dist + 95) spawnRow(s, 90); s.rows = s.rows.filter(r => r.z - s.dist > -8); s.coins = s.coins.filter(c => c.z - s.dist > -8); drawWorld(ctx, s, now); };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", fit); };
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
    if (view === "loading") return <main className="grid min-h-dvh place-items-center  text-navy/60">Loading…</main>;

    if (view === "clearance") return (
      <Page><h1 className="font-display text-3xl">Before you start</h1><Rule />
        <p className="mt-3 text-navy/70">Mirror Dash asks you to make quick, gentle facial movements. Only continue if your clinician says facial exercises are okay for you, and stop any time you feel discomfort or strain.</p>
        <p className="mt-3 text-navy/70">Your camera is used only while you play. It’s processed on your device, and video is never uploaded or saved.</p>
        <label className="mt-5 flex items-start gap-3 rounded-2xl bg-gold/20 p-4 text-sm"><input type="checkbox" className="mt-1 h-5 w-5 accent-teal" checked={agree} onChange={e => setAgree(e.target.checked)} />
          <span>My clinician has said gentle facial exercises are okay for me, and I understand I can stop at any time.</span></label>
        {msg && <p role="alert" className="mt-3 rounded-2xl bg-lav/50 p-3 text-sm">{msg}</p>}
        <button className="btn-primary mt-5 w-full" disabled={!agree || busy} onClick={confirmClearance}>{busy ? "Saving…" : "Continue"}</button>
        <button className="btn-quiet mt-3 w-full" onClick={() => setView("hub")}>Back</button></Page>);

    if (view === "ready") return (
      <Page><h1 className="font-display text-3xl">How to play</h1><Rule />
        <p className="mt-2 text-navy/70">Your runner keeps running. Use these five movements to dodge, jump and fly. The run gets faster as it goes.</p>
        <ul className="mt-4 grid gap-2">{MOVES.map(m => <li key={m} className="flex items-center gap-3 rounded-2xl bg-paper p-3 shadow-soft"><Rune m={m} size={44} /><span className="flex-1"><b>{INFO[m].action}</b><br /><span className="text-sm text-navy/70">{INFO[m].name}</span></span></li>)}</ul>
        <p className="mt-3 text-xs text-navy/60">Bumps never end your run. You just stumble and slow down for a moment.</p>
        {msg && <p role="alert" className="mt-3 rounded-2xl bg-lav/50 p-3 text-sm">{msg}</p>}
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
          <h1 className="mt-5 font-display text-3xl">{title}</h1><Rule />
          {calStep <= 6 && <>
            <canvas ref={calCv} className="mt-4 w-full rounded-3xl bg-navy/90 shadow-soft" style={{ aspectRatio: "4 / 3" }} aria-label="Your camera preview (mirrored)" />
            <div className="mt-3 flex flex-wrap gap-2" aria-live="polite">{chip(!!calQ?.face, calQ?.face ? "Face visible" : "No face yet")}{chip(!!calQ?.size, "Distance")}{chip(!!calQ?.light, "Lighting")}</div></>}
          {calStatus && <p role="status" className="mt-3 rounded-2xl bg-teal/15 p-4 text-center font-display text-2xl">{calStatus}</p>}
          {calMsg && <p role="alert" className="mt-3 rounded-2xl bg-lav/50 p-3 text-sm">{calMsg}</p>}
          {calStep === 0 && <section className="mt-4"><p className="text-navy/70">Your camera is processed on this device. Video is never uploaded or saved. We’ll record your relaxed face, then each of the five movements once. Go gently.</p>
            <button className="btn-primary mt-4 min-h-[60px] w-full text-lg" disabled={calCam !== "off"} onClick={startCal}>{calCam === "loading" ? "Starting camera…" : calCam === "on" ? "Camera is on ✓" : "Start camera"}</button></section>}
          {calStep === 1 && <section className="mt-4 flex flex-col items-center text-center"><Face m="rest" size={150} />
            <p className="mt-3 text-lg">Look at the camera with a comfortable, relaxed face.</p>
            <button className="btn-primary mt-4 min-h-[60px] w-full text-lg" disabled={calBusy || calCam !== "on"} onClick={doNeutral}>{calNeutral ? "Record again" : "Record relaxed face (3 seconds)"}</button>
            {calNeutral && !calBusy && <p className="mt-3 text-sm text-navy/70">Got it. Your relaxed face is recorded.</p>}</section>}
          {calStep >= 2 && calStep <= 6 && sm && sm !== "rest" && <section className="mt-4 flex flex-col items-center text-center"><Face m={sm} size={150} />
            <p className="mt-3 text-xl">{INFO[sm].cue}</p><p className="mt-1 text-sm text-navy/70">{INFO[sm].tip}</p>
            <button className="btn-primary mt-4 min-h-[60px] w-full text-lg" disabled={calBusy || calCam !== "on"} onClick={() => doMove(sm)}>{rec ? "Record again" : "Record (4 seconds)"}</button>
            {rec && !calBusy && <p className="mt-3 text-sm text-navy/70">{rec.detectable ? "Great. We picked up a clear movement." : "We couldn’t pick up a clear change this time. That’s okay. Try again, a little more or slower."}</p>}</section>}
          {calStep === 7 && <section className="mt-4"><ul className="grid gap-2">{MOVES.map(m => { const mv = calMoves[m]; return (
            <li key={m} className="flex items-center gap-3 rounded-2xl bg-paper p-3 shadow-soft"><Rune m={m} size={34} /><span className="flex-1">{INFO[m].action}</span><span className="text-sm text-navy/70">{mv?.detectable ? "Ready ✓" : mv ? "Not detected" : "Not recorded"}</span></li>); })}</ul>
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
      <Page><h1 className="font-display text-3xl">Settings</h1><Rule />
                <section className="mt-3 rounded-3xl bg-paper p-5 shadow-soft"><h2 className="font-display text-xl">1. Run length</h2>
          <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Run length">{LENS.map(v => <button key={v} role="radio" aria-checked={st.len === v} onClick={() => update({ len: v })} className={`min-h-[56px] ${choice(st.len === v)}`}>{v}s</button>)}</div></section>
        <section className="mt-3 rounded-3xl bg-paper p-5 shadow-soft"><h2 className="font-display text-xl">2. Starting speed</h2>
          <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Starting speed">{STARTS.map(x => <button key={x.v} role="radio" aria-checked={st.start === x.v} onClick={() => update({ start: x.v })} className={`min-h-[56px] ${choice(st.start === x.v)}`}>{x.n}</button>)}</div></section>
        <section className="mt-3 rounded-3xl bg-paper p-5 shadow-soft"><h2 className="font-display text-xl">3. How much it speeds up</h2>
          <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Speed increase">{RAMPS.map(x => <button key={x.v} role="radio" aria-checked={st.ramp === x.v} onClick={() => update({ ramp: x.v })} className={`min-h-[56px] ${choice(st.ramp === x.v)}`}>{x.n}</button>)}</div>
          <p className="mt-2 text-xs text-navy/60">By the end of the run you’ll be going about {st.ramp}× your starting speed.</p></section>
        <label className="mt-3 flex items-center justify-between gap-4 rounded-3xl bg-paper p-5 shadow-soft"><span><b>4. Hints</b><br /><span className="text-sm text-navy/60">Show which movement to make for the next obstacle.</span></span>
          <input type="checkbox" className="h-7 w-7 accent-teal" checked={st.hints} onChange={e => update({ hints: e.target.checked })} aria-label="Hints" /></label>
        <label className="mt-3 flex items-center justify-between gap-4 rounded-3xl bg-paper p-5 shadow-soft"><span><b>5. Vibration</b><br /><span className="text-sm text-navy/60">Buzz after calibration steps, at the start, and when you stumble. Works on phones that allow it.</span></span>
          <input type="checkbox" className="h-7 w-7 accent-teal" checked={st.haptics} onChange={e => update({ haptics: e.target.checked })} aria-label="Vibration" /></label>
        <button className="btn-primary mt-4 w-full" onClick={() => setView("hub")}>Done</button></Page>);

    if (view === "stats") {
      const gs = games ?? [], done = gs.length, best = (f: (x: GameRow) => number) => gs.reduce((m, x) => Math.max(m, f(x)), 0);
      const tiles: [string, string][] = [["Runs", String(done)], ["Best distance", `${best(x => x.distance)} m`], ["Best points", String(best(x => x.points))], ["Total coins", String(gs.reduce((n, x) => n + x.coins, 0))], ["Top speed", `${best(x => Number(x.top_speed ?? 0)).toFixed(1)}`], ["Best streak", String(best(x => x.best_streak))]];
      const tot = z5() as Record<M, number>; for (const x of gs) for (const m of MOVES) tot[m] += x.per_move?.counts?.[m] ?? 0; const mx = Math.max(1, ...MOVES.map(m => tot[m]));
      const rows = gs.slice(0, 12).reverse(), dm = Math.max(1, ...rows.map(x => x.distance));
      return (
        <Page><h1 className="font-display text-3xl">Your stats</h1><Rule />
          <button className="btn-primary mt-4 min-h-[60px] w-full text-lg" onClick={onPlay}>Play game</button>
          {games === null && <p className="mt-6 text-navy/60">Loading…</p>}
          {games && done === 0 && <p className="mt-6 rounded-2xl bg-paper p-5 text-navy/70 shadow-soft">No runs yet. Your first one will show up here.</p>}
          {done > 0 && <>
            <dl className="mt-5 grid grid-cols-2 gap-3">{tiles.map(([k, v]) => <div key={k} className="rounded-2xl bg-paper p-4 shadow-soft"><dd className="font-display text-3xl">{v}</dd><dt className="text-xs text-navy/60">{k}</dt></div>)}</dl>
            <section className="mt-6 rounded-3xl bg-paper p-5 shadow-soft"><h2 className="font-display text-xl">Distance, last {rows.length} runs</h2>
              <div className="mt-3 grid gap-2">{rows.map(x => <div key={x.id} className="flex items-center gap-3 text-sm"><span className="w-14 text-navy/60">{fmtDate(x.played_at)}</span><div className="h-3 flex-1 rounded-full bg-mist"><div className="h-3 rounded-r-full bg-teal" style={{ width: `${Math.max(2, x.distance / dm * 100)}%` }} /></div><span className="w-14 text-right">{x.distance} m</span></div>)}</div></section>
            <section className="mt-4 rounded-3xl bg-paper p-5 shadow-soft"><h2 className="font-display text-xl">Movements made</h2><p className="text-xs text-navy/60">Total times across all runs.</p>
              <div className="mt-3 grid gap-3">{MOVES.map(m => <div key={m}><div className="flex justify-between text-sm"><span>{INFO[m].action}</span><span>{tot[m]}</span></div><div className="mt-1 h-2.5 rounded-full bg-mist"><div className="h-2.5 rounded-r-full bg-teal" style={{ width: `${tot[m] / mx * 100}%` }} /></div></div>)}</div></section>
            <section className="mt-4 rounded-3xl bg-paper p-5 shadow-soft"><h2 className="font-display text-xl">Recent runs</h2>
              <ul className="mt-3 grid gap-3 text-sm">{gs.slice(0, 8).map(x => <li key={x.id} className="flex justify-between gap-3"><span>{fmtDate(x.played_at)} · {x.points} pts{x.completed ? "" : " (ended early)"}</span><span className="text-right text-navy/60">{x.distance} m · {x.coins} coins · {x.cleared} cleared · {x.stumbles} stumbles</span></li>)}</ul></section></>}
          <button className="btn-quiet mt-6 w-full" onClick={() => setView("hub")}>Back</button></Page>);
    }

    if (view === "results" && result) {
      const R = result;
      return (
        <Page><h1 className="font-display text-3xl">{R.completed ? "Run complete." : "Run ended early."}</h1><Rule />
          <p className="mt-2 text-navy/70">Nice work. Every run counts.</p>
          <div className="mt-5 grid grid-cols-2 gap-3">{([["Points", String(R.points)], ["Distance", `${R.distance} m`], ["Coins", String(R.coins)], ["Obstacles cleared", String(R.cleared)], ["Stumbles", String(R.stumbles)], ["Top speed", `${R.topSpeed.toFixed(1)}`]] as [string, string][]).map(([k, v]) => <div key={k} className="rounded-2xl bg-paper p-4 shadow-soft"><div className="font-display text-3xl">{v}</div><div className="text-xs text-navy/60">{k}</div></div>)}
            <div className="col-span-2 rounded-2xl bg-paper p-4 shadow-soft"><div className="font-display text-3xl">{R.bestStreak}</div><div className="text-xs text-navy/60">Best streak (obstacles cleared in a row)</div></div></div>
          <section className="mt-5 rounded-3xl bg-paper p-5 shadow-soft"><h2 className="font-display text-xl">Movements made</h2>
            <ul className="mt-3 grid gap-2">{MOVES.map(m => <li key={m} className="flex items-center gap-3 text-sm"><Rune m={m} size={30} /><span className="flex-1">{INFO[m].action}</span><b>{R.counts[m]}</b></li>)}</ul></section>
          {!R.saved && <p role="alert" className="mt-4 rounded-2xl bg-lav/50 p-4 text-sm">{msg ?? "Saving this run…"}</p>}
          <button className="btn-primary mt-6 min-h-[60px] w-full text-lg" onClick={onPlay}>Run again</button>
          <button className="btn-quiet mt-3 w-full" onClick={openStats}>See my stats</button>
          <button className="btn-quiet mt-3 w-full" onClick={() => setView("hub")}>Home</button></Page>);
    }

    if (view === "play") return (
      <div className="fixed inset-0 touch-none bg-[#0b0c2a]" style={{ height: "100dvh" }}>
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ width: box.w, height: box.h }}>
          <canvas ref={cvRef} style={{ width: "100%", height: "100%" }} aria-label="Three-lane runner. Use your facial movements to dodge, jump, duck and fly." />
        </div>
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center">
          <div className="w-full rounded-b-2xl border-b border-x border-[#8fd0ff]/40 bg-[#0f1038]/80 shadow-soft backdrop-blur" style={{ maxWidth: Math.max(box.w, 320), paddingTop: "env(safe-area-inset-top, 0px)" }}>
            <div className="flex items-center justify-between gap-2 px-5" style={{ height: TOPBAR }} role="status">
              <div><div className="dt-h text-4xl leading-none text-[#bfe6ff]">{ui.dist}<span className="ml-1 text-sm text-[#a9a8d6]">m</span></div><div className="mt-1 text-[11px] uppercase tracking-widest text-[#a9a8d6]">Speed ×{ui.mul.toFixed(1)}</div></div>
              <div className="text-center"><div className="flex items-center justify-center gap-1.5 dt-h text-3xl leading-none text-[#eceaff]"><Coin size={26} /> {ui.coins}</div><div className="mt-1 text-[11px] uppercase tracking-widest text-[#a9a8d6]">Relics</div></div>
              <div className="relative grid h-16 w-16 shrink-0 place-items-center" aria-label={`${ui.left} seconds left`}>
                <svg width="64" height="64" viewBox="0 0 64 64" className="absolute inset-0 -rotate-90" aria-hidden><circle cx="32" cy="32" r="28" fill="none" stroke="#2c2f78" strokeWidth="5" /><circle cx="32" cy="32" r="28" fill="none" stroke="#8fd0ff" strokeWidth="5" strokeLinecap="round" strokeDasharray={175.9} strokeDashoffset={175.9 * (1 - ui.left / cfg.current.len)} /></svg>
                <span className="dt-h text-xl text-[#eceaff]">{ui.left}</span></div>
            </div></div></div>
        {st.hints && ui.stage === "play" && ui.hint && <div className="pointer-events-none absolute inset-x-0 z-20 flex justify-center px-4" style={{ top: `calc(env(safe-area-inset-top, 0px) + ${TOPBAR + 10}px)` }}><div className="rounded-full border border-[#8fd0ff]/60 bg-[#0f1038]/85 px-5 py-2 dt-h text-lg tracking-wide text-[#eceaff] shadow-soft" role="status">{ui.hint}</div></div>}
        {ui.stumble && ui.stage === "play" && <div className="pointer-events-none absolute inset-x-0 z-20 text-center text-sm font-semibold text-[#eceaff]" style={{ top: `calc(env(safe-area-inset-top, 0px) + ${TOPBAR + 56}px)` }}>Stumble. Keep going!</div>}
        <button aria-label="Pause" onClick={() => { g.current.manual = true; }} className="absolute z-20 grid h-14 w-14 place-items-center rounded-full border border-[#8fd0ff]/40 bg-[#0f1038]/80 shadow-soft" style={{ left: 12, top: `calc(env(safe-area-inset-top, 0px) + ${TOPBAR + 10}px)` }}>
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden><rect x="4" y="3" width="5" height="16" rx="1.5" fill="#8fd0ff" /><rect x="13" y="3" width="5" height="16" rx="1.5" fill="#8fd0ff" /></svg></button>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center pb-[max(10px,env(safe-area-inset-bottom))]"><div className="grid w-full grid-cols-5 gap-1.5 px-2" style={{ maxWidth: Math.max(box.w, 320) }}>
          {MOVES.map(m => <div key={m} className={`flex flex-col items-center rounded border px-1 py-2 text-center text-[11px] leading-tight shadow-soft ${ui.on[m] ? "border-[#bfe6ff] bg-[#8fd0ff] text-[#0f1038]" : "border-[#8fd0ff]/30 bg-[#0f1038]/80 text-[#d6d4ff]"}`}><Rune m={m} size={30} on={ui.on[m]} tone="#8fd0ff" /><span className="mt-0.5 whitespace-pre-line">{SHORT[m]}</span>
            <span className="mt-1 h-1.5 w-full rounded-full bg-black/30"><span className="block h-1.5 rounded-full bg-[#ffffff]" style={{ width: `${Math.round(ui.lev[m] * 100)}%` }} /></span></div>)}</div></div>
        {ui.stage === "ready" && !ui.paused && !ui.adjust && <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#0b0c2a]/90 px-6 text-center text-[#eceaff]" role="status">
          <h2 className="dt-h text-4xl">Get ready</h2>
          <ul className="mt-4 grid w-full max-w-xs gap-2 text-left">{MOVES.map(m => <li key={m} className="flex items-center gap-3 rounded bg-white/10 px-3 py-2"><Rune m={m} size={34} tone="#8fd0ff" /><span className="text-lg">{INFO[m].action}</span></li>)}</ul>
          <p className="mt-5 dt-h text-3xl">Starting in {ui.ready}</p>
          <button className="btn-primary mt-4" onClick={() => { g.current.readyLeft = 0; }}>I’m ready, start now</button></div>}
        {ui.adjust && !ui.paused && <div className="absolute inset-0 z-40 grid place-items-center bg-[#0b0c2a]/85 p-8 text-center text-[#eceaff]" role="alert"><div><p className="dt-h text-3xl">Let’s adjust your camera</p>
          <p className="mt-3 text-base">We can’t see your face clearly. Center it and add light. The game waits, and nothing is counted against you.</p></div></div>}
        {ui.paused && <div className="absolute inset-0 z-50 grid place-items-center bg-[#0b0c2a]/85 p-6 text-[#eceaff]" role="dialog" aria-label="Paused"><div className="w-full max-w-xs text-center">
          <p className="dt-h text-3xl">Paused</p><p className="mt-1 text-sm text-[#eceaff]/75">Take as long as you need.</p>
          <button className="btn-primary mt-5 w-full" onClick={() => { g.current.manual = false; }}>Resume</button>
          <div className="mt-4 rounded bg-white/10 p-3 text-sm"><p>Sensitivity {Math.max(1, GAINS.indexOf(gainUi) + 1)} of 5</p><p className="text-xs text-[#eceaff]/70">Movements not registering? Try Easier.</p>
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
            <p className="text-xs uppercase tracking-[.35em] text-[#8fd0ff]">For advanced practice</p>
            <h1 className="dt-h mt-2 text-5xl font-bold leading-[1.05] text-white">MIRROR<br />DASH</h1><Rule light />
            <p className="text-[#d6d4ff]">Run the ruins. Smile to jump, raise your eyebrows to fly, frown to duck, and pucker left or right to change lanes.</p>
            {msg && <p role="alert" className="mt-3 rounded-2xl bg-[#3f0f7f] p-3 text-sm">{msg}</p>}
            <button className="btn-primary mt-5 min-h-[64px] w-full text-lg uppercase tracking-[.16em]" onClick={onPlay}>Play game</button>
            {!hasCal && <p className="mt-2 text-center text-xs text-[#a9a8d6]">First time? We’ll set up your camera next.</p>}
            <div className="mt-3 grid grid-cols-2 gap-3"><button className="btn-quiet min-h-[56px] !border-white/25 !bg-black/40 !text-white" onClick={openStats}>Stats</button><button className="btn-quiet min-h-[56px] !border-white/25 !bg-black/40 !text-white" onClick={() => setView("settings")}>Settings</button></div>
            {ios && <p className="mt-4 rounded-2xl bg-black/50 p-3 text-xs text-[#d6d4ff]">For the full-screen version on iPhone: tap the Share button in Safari, choose <b>Add to Home Screen</b>, then open SmileQuest from your home screen.</p>}
          </div>
        </div>
      </div>);
  };
  return <>{videoEl}<style>{"@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&display=swap');.dt-h{font-family:'Cinzel',Georgia,serif;letter-spacing:.06em}"}</style>{body()}</>;
}
