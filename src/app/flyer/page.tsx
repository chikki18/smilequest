"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { createTracker, type Frame } from "@/lib/tracking";
import { POLICY_VERSION } from "@/lib/onboarding";

type Move = { threshold: number; range: number; detectable: boolean; nm: number };
const KEYS = ["smile", "brow", "pucker", "close"] as const;
type K = typeof KEYS[number];
const EXPR: Record<K, { name: string; cue: string; tip: string }> = {
  smile: { name: "Gentle smile", cue: "Smile softly", tip: "Like greeting a friend. Never force it." },
  brow: { name: "Eyebrow raise", cue: "Lift your eyebrows", tip: "Raise them gently, as if mildly surprised." },
  pucker: { name: "Lip pucker", cue: "Round your lips", tip: "Gently purse them, like saying “ooo”." },
  close: { name: "Gentle eye closure", cue: "Close your eyes softly", tip: "Soft, like resting. No squeezing. The bird flies by itself while you hold it." },
};
const W = 360, BX = 100, TAU = Math.PI * 2, HOVER = .36, TOP = 150, GROUND_H = 110, BANNER_H = 104;
const GAINS = [1, 1.3, 1.7, 2.2, 3];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const r1 = (v: number) => Math.round(v * 10) / 10;

type Settings = { auto: boolean; exprs: K[]; secs: number; gain: number; gap: number; pace: number };
const AUTO: Settings = { auto: true, exprs: [...KEYS], secs: 20, gain: 1.7, gap: 290, pace: 75 };
const SKEY = "smilequest.flight.settings";
const loadSettings = (): Settings => {
  try { const raw = localStorage.getItem(SKEY); if (raw) { const j = JSON.parse(raw);
    const ex = Array.isArray(j.exprs) ? j.exprs.filter((x: string) => (KEYS as readonly string[]).includes(x)) : AUTO.exprs;
    return { ...AUTO, ...j, exprs: ex.length ? ex : AUTO.exprs }; } } catch { /* ignore */ }
  return AUTO;
};
const saveSettings = (s: Settings) => { try { localStorage.setItem(SKEY, JSON.stringify(s)); } catch { /* ignore */ } };

type Prof = { total: number; kind: string; color: string; acc: string };
const ANIMALS = [{ k: "bird", n: "Songbird", need: 0, col: "#6bb3a8" }, { k: "bunny", n: "Bunny", need: 150, col: "#e8dfd2" }, { k: "fox", n: "Fox", need: 300, col: "#e58a4e" }, { k: "owl", n: "Owl", need: 500, col: "#9b7b5b" }];
const COLORS = [{ n: "Original", c: "", need: 0 }, { n: "Sky", c: "#6fa8dc", need: 25 }, { n: "Rose", c: "#e59aa8", need: 25 }, { n: "Lavender", c: "#b7a7dc", need: 25 }, { n: "Mint", c: "#8fd0b0", need: 50 }, { n: "Coral", c: "#ef8f78", need: 50 }, { n: "Slate", c: "#6b7a8f", need: 50 }];
const ACCS = [{ n: "None", k: "", need: 0 }, { n: "Bow", k: "bow", need: 75 }, { n: "Glasses", k: "glasses", need: 75 }, { n: "Crown", k: "crown", need: 120 }];
const UNLOCKS = [{ need: 25, label: "Bird colors" }, { need: 50, label: "More colors" }, { need: 75, label: "Bow and glasses" }, { need: 120, label: "Crown" }, { need: 150, label: "Bunny" }, { need: 300, label: "Fox" }, { need: 500, label: "Owl" }];

type Per = { k: K; valid: number; on: number; gates: number; coins: number; misses: number };
type Pil = { x: number; c: number; gap: number; passed: boolean; hit: boolean };
type Coin = { x: number; y: number; got: boolean };
const fresh = (plan: K[], wh: number) => {
  const mid = (TOP + wh - GROUND_H) / 2;
  return {
    t: 0, scroll: 0, y: mid, vy: 0, lev: 0, active: false, flap: 0, wh, mid,
    pillars: [] as Pil[], coins: [] as Coin[], spawnX: W + 260, prev: mid,
    gates: 0, coinsGot: 0, misses: 0, streak: 0, best: 0, points: 0,
    plan, si: 0, stage: "ready" as "ready" | "play" | "done", stageT: 0, readyLeft: 6,
    per: plan.map(k => ({ k, valid: 0, on: 0, gates: 0, coins: 0, misses: 0 })) as Per[],
    adjust: false, pauses: 0, lostSince: null as number | null, manual: false,
    assist: null as null | { t: number; from: number; to: number }, invuln: 0, finished: false,
  };
};
type G = ReturnType<typeof fresh>;

function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.arc(x + w - r, y + r, r, -Math.PI / 2, 0); c.lineTo(x + w, y + h - r); c.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  c.lineTo(x + r, y + h); c.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI); c.lineTo(x, y + r); c.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5); c.closePath();
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
function outlined(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, lw: number) {
  c.font = `bold ${size}px system-ui, sans-serif`; c.lineWidth = lw; c.strokeStyle = "#2b3340"; c.strokeText(text, x, y); c.fillStyle = "#fff"; c.fillText(text, x, y);
}
function drawWorld(c: CanvasRenderingContext2D, s: G, now: number, body: string, acc: string, kind: string) {
  const H = s.wh, GROUND = H - GROUND_H, sc = s.scroll;
  const g = c.createLinearGradient(0, 0, 0, GROUND); g.addColorStop(0, "#62c3ee"); g.addColorStop(1, "#cdeef6");
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.fillStyle = "rgba(255,255,255,.92)";
  for (let i = 0; i < 5; i++) { const cx = (((i * 170 - (sc + now * .01) * .15) % (W + 200)) + (W + 200)) % (W + 200) - 100; cloud(c, cx, 190 + ((i * 53) % 150), 24 + (i % 3) * 7); }
  c.fillStyle = "#a9ddd2";
  for (let i = 0; i < 8; i++) { const bx = (((i * 110 - sc * .3) % 880) + 880) % 880 - 110; c.beginPath(); c.ellipse(bx, GROUND, 70, 70 + (i % 3) * 20, 0, Math.PI, TAU); c.fill(); }
  c.fillStyle = "#86d38c";
  for (let i = 0; i < 8; i++) { const bx = (((i * 90 - sc * .6) % 720) + 720) % 720 - 90; c.beginPath(); c.ellipse(bx, GROUND, 44, 26 + (i % 2) * 8, 0, Math.PI, TAU); c.fill(); }
  for (const p of s.pillars) { const px = p.x - sc; if (px < -60 || px > W + 60) continue; pillar(c, px, -4, p.c - p.gap / 2, true); pillar(c, px, p.c + p.gap / 2, GROUND, false); }
  s.coins.forEach((co, i) => {
    if (co.got) return; const sx = co.x - sc; if (sx < -20 || sx > W + 20) return;
    const wd = Math.abs(Math.cos(now / 220 + i)) * 8 + 2;
    c.fillStyle = "#f6c945"; c.strokeStyle = "#a67c12"; c.lineWidth = 2; c.beginPath(); c.ellipse(sx, co.y, wd, 10, 0, 0, TAU); c.fill(); c.stroke();
    c.fillStyle = "rgba(255,255,255,.55)"; c.beginPath(); c.ellipse(sx - wd * .25, co.y - 3, wd * .3, 4, 0, 0, TAU); c.fill();
  });
  c.fillStyle = "#e3d49b"; c.fillRect(0, GROUND, W, H - GROUND);
  c.fillStyle = "#d2c186"; const off = sc % 24;
  for (let x = -24 - off; x < W + 24; x += 24) { c.beginPath(); c.moveTo(x, GROUND + 14); c.lineTo(x + 12, GROUND + 14); c.lineTo(x, H); c.lineTo(x - 12, H); c.closePath(); c.fill(); }
  c.fillStyle = "#8ad06a"; c.fillRect(0, GROUND, W, 14);
  c.strokeStyle = "#4f7a3a"; c.lineWidth = 3; c.beginPath(); c.moveTo(0, GROUND); c.lineTo(W, GROUND); c.moveTo(0, GROUND + 14); c.lineTo(W, GROUND + 14); c.stroke();
  if (!(s.invuln > 0 && Math.floor(now / 120) % 2)) drawCritter(c, BX, s.y, clamp(s.vy / 400, -.5, .7), kind, body, acc, s.flap);
  c.textAlign = "center"; c.lineJoin = "round";
  outlined(c, String(s.points), W / 2, TOP + 64, 54, 7);
  outlined(c, `Streak ${s.streak}   Coins ${s.coinsGot}`, W / 2, TOP + 94, 17, 4);
  // movement meter on the ground strip
  const mx = 60, mw = 240, my = GROUND + 44;
  rr(c, mx, my, mw, 18, 9); c.fillStyle = "rgba(43,51,64,.45)"; c.fill();
  if (s.lev > 0.01) { rr(c, mx, my, Math.max(18, mw * s.lev), 18, 9); c.fillStyle = s.active ? "#4E8A86" : "#a9b8a0"; c.fill(); }
  c.fillStyle = "#fff"; c.fillRect(mx + mw * HOVER - 1.5, my - 5, 3, 28);
  outlined(c, s.active ? "Holding it. Nice." : "Hold past the white line", W / 2, my + 46, 14, 4);
}

function FaceArt({ k, size }: { k: K; size: number }) {
  const ink = "#2b3340", up = k === "brow";
  const hl = k === "smile" ? { cx: 60, cy: 90, rx: 38, ry: 22 } : k === "pucker" ? { cx: 60, cy: 88, rx: 22, ry: 24 } : k === "brow" ? { cx: 60, cy: 32, rx: 46, ry: 17 } : { cx: 60, cy: 60, rx: 48, ry: 17 };
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label={`${EXPR[k].name}: example face`}>
      <circle cx="60" cy="60" r="54" fill="#ffe1b5" stroke={ink} strokeWidth="4" />
      <ellipse cx={hl.cx} cy={hl.cy} rx={hl.rx} ry={hl.ry} fill="none" stroke="#4E8A86" strokeWidth="3.5" strokeDasharray="6 5" />
      <path d={up ? "M24 38 Q38 20 54 34" : "M26 46 Q40 40 54 46"} fill="none" stroke={ink} strokeWidth="5" strokeLinecap="round" />
      <path d={up ? "M66 34 Q82 20 96 38" : "M66 46 Q80 40 94 46"} fill="none" stroke={ink} strokeWidth="5" strokeLinecap="round" />
      {k === "close" ? <><path d="M28 60 Q40 70 52 60" fill="none" stroke={ink} strokeWidth="5" strokeLinecap="round" /><path d="M68 60 Q80 70 92 60" fill="none" stroke={ink} strokeWidth="5" strokeLinecap="round" /></>
        : up ? <><circle cx="40" cy="58" r="10" fill="#fff" stroke={ink} strokeWidth="3" /><circle cx="80" cy="58" r="10" fill="#fff" stroke={ink} strokeWidth="3" /><circle cx="40" cy="58" r="4.5" fill={ink} /><circle cx="80" cy="58" r="4.5" fill={ink} /></>
        : <><circle cx="40" cy="58" r="5.5" fill={ink} /><circle cx="80" cy="58" r="5.5" fill={ink} /></>}
      {k === "smile" ? <path d="M34 80 Q60 104 86 80" fill="none" stroke={ink} strokeWidth="5" strokeLinecap="round" />
        : k === "pucker" ? <ellipse cx="60" cy="88" rx="9" ry="11" fill="#c8606c" stroke={ink} strokeWidth="4" />
        : <path d="M46 90 H74" fill="none" stroke={ink} strokeWidth="5" strokeLinecap="round" />}
    </svg>);
}

type GameRow = { id: string; played_at: string; mode: string; duration_seconds: number; points: number; accuracy: number | null; coins: number; misses: number; best_streak: number; gates: number; completed: boolean; per_expression: { k: K; accuracy: number; seconds: number }[] };
type Result = { points: number; accuracy: number; coins: number; misses: number; bestStreak: number; gates: number; seconds: number; completed: boolean; per: { k: K; accuracy: number; gates: number; coins: number; misses: number; seconds: number }[]; unlocked: string[]; saved: boolean };
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const TOTAL_NOTE = (n: number, secs: number) => { const t = n * secs; return `${n} expression${n === 1 ? "" : "s"} × ${secs} s = about ${Math.floor(t / 60)} min${t % 60 ? ` ${t % 60} s` : ""}`; };
function dayStreak(games: GameRow[]) {
  const days = new Set(games.map(x => new Date(x.played_at).toDateString()));
  let n = 0; const d = new Date(); if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1);
  while (days.has(d.toDateString())) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

function Page({ children }: { children?: any }) { return <main className="mx-auto max-w-md px-6 pb-12 pt-[max(2rem,env(safe-area-inset-top))]">{children}</main>; }

function AccChart({ games }: { games: GameRow[] }) {
  const rows = games.slice(0, 12).reverse(); const [h, setH] = useState<number | null>(null);
  const x0 = 34, pw = 300, slot = pw / 12, bw = 14, base = 120, top = 20, ph = base - top;
  const sel = h != null ? rows[h] : null;
  return (
    <div>
      <svg viewBox="0 0 340 150" className="w-full" role="img" aria-label={`Accuracy for your last ${rows.length} games`}>
        {[0, 50, 100].map(v => <g key={v}><line x1={x0} x2={336} y1={base - ph * v / 100} y2={base - ph * v / 100} stroke="#E8E2D4" strokeWidth="1" /><text x={x0 - 6} y={base - ph * v / 100 + 4} textAnchor="end" fontSize="10" fill="#1B2A3A" opacity=".6">{v}%</text></g>)}
        {rows.map((r, i) => {
          const acc = Number(r.accuracy ?? 0), bh = Math.max(2, ph * acc / 100), x = x0 + i * slot + (slot - bw) / 2, y = base - bh, rad = Math.min(4, bh / 2);
          return (
            <g key={r.id} tabIndex={0} role="img" aria-label={`${fmtDate(r.played_at)}: ${Math.round(acc)} percent accuracy, ${r.points} points`}
              onMouseEnter={() => setH(i)} onFocus={() => setH(i)} onClick={() => setH(i)} style={{ cursor: "pointer", outline: "none" }}>
              <rect x={x - 3} y={top - 6} width={bw + 6} height={ph + 26} fill="transparent" />
              <path d={`M${x},${base} V${y + rad} Q${x},${y} ${x + rad},${y} H${x + bw - rad} Q${x + bw},${y} ${x + bw},${y + rad} V${base} Z`} fill={h === i ? "#1B2A3A" : "#4E8A86"} />
              {i === rows.length - 1 && <text x={x + bw / 2} y={y - 5} textAnchor="middle" fontSize="11" fontWeight="600" fill="#1B2A3A">{Math.round(acc)}%</text>}
            </g>);
        })}
        {rows.length > 0 && <><text x={x0 + (slot) / 2} y="140" fontSize="10" fill="#1B2A3A" opacity=".6" textAnchor="start">{fmtDate(rows[0].played_at)}</text><text x="336" y="140" fontSize="10" fill="#1B2A3A" opacity=".6" textAnchor="end">{fmtDate(rows[rows.length - 1].played_at)}</text></>}
      </svg>
      <p className="min-h-[20px] text-xs text-navy/70" aria-live="polite">{sel ? `${fmtDate(sel.played_at)} · ${Math.round(Number(sel.accuracy ?? 0))}% accuracy · ${sel.points} points · ${sel.coins} coins` : "Tap a bar for details."}</p>
    </div>);
}

export default function Flight() {
  const video = useRef<HTMLVideoElement>(null), cvRef = useRef<HTMLCanvasElement>(null), pvRef = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null), tracker = useRef<Awaited<ReturnType<typeof createTracker>> | null>(null);
  const latest = useRef<Frame | null>(null), g = useRef<G>(fresh(["smile"], 640));
  const cfg = useRef({ secs: 20, gap: 290, pace: 75, auto: true }), liveGain = useRef(1.7);
  const [view, setView] = useState<"loading" | "hub" | "clearance" | "ready" | "settings" | "stats" | "custom" | "play" | "results">("loading");
  const [cal, setCal] = useState<Partial<Record<K, Move>>>({});
  const [clear, setClear] = useState(false), [agree, setAgree] = useState(false);
  const [prof, setProf] = useState<Prof>({ total: 0, kind: "bird", color: "", acc: "" });
  const [st, setSt] = useState<Settings>(AUTO);
  const [msg, setMsg] = useState<string | null>(null), [busy, setBusy] = useState(false), [preview, setPreview] = useState(true), [gainUi, setGainUi] = useState(1.7);
  const [box, setBox] = useState({ w: 360, h: 640 });
  const [ui, setUi] = useState({ stage: "ready" as "ready" | "play" | "done", si: 0, total: 4, ready: 6, left: 20, adjust: false, paused: false, k: "smile" as K });
  const [result, setResult] = useState<Result | null>(null), [games, setGames] = useState<GameRow[] | null>(null);
  const calRef = useRef(cal); calRef.current = cal;
  const P = useRef(prof); P.current = prof;
  const hasCal = Object.keys(cal).length > 0;
  const CAL_URL = "/calibrate?next=" + encodeURIComponent("/flyer?ready=1");

  useEffect(() => { (async () => {
    const sb = supabase(); const { data: { user } } = await sb.auth.getUser();
    if (!user) { location.href = "/"; return; }
    setSt(loadSettings());
    const { data: c } = await sb.from("calibration_profiles").select("summary").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const m: Partial<Record<K, Move>> = {};
    for (const k of KEYS) { const v = c?.summary?.moves?.[k]; if (v?.detectable) m[k] = { ...v, nm: v.threshold - 0.5 * v.range }; }
    setCal(m);
    const { data: cl } = await sb.from("consent_records").select("id").eq("kind", "exercise_clearance").eq("granted", true).limit(1);
    setClear(!!cl?.length);
    const { data: fp } = await sb.from("flyer_profiles").select("total_coins,bird_kind,color,accessory").maybeSingle();
    if (fp) setProf({ total: fp.total_coins, kind: fp.bird_kind, color: fp.color, acc: fp.accessory });
    setView(new URLSearchParams(location.search).get("ready") === "1" && Object.keys(m).length ? "ready" : "hub");
  })(); return () => stop(); }, []);

  function stop() { tracker.current?.stop(); tracker.current = null; stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; latest.current = null; }
  function update(p: Partial<Settings>) { const n = { ...st, ...p }; setSt(n); saveSettings(n); }
  async function bank(earned: number, p: Prof = P.current): Promise<boolean> {
    const sb = supabase(); const { data: { user } } = await sb.auth.getUser(); if (!user) return false;
    const next = { ...p, total: p.total + earned };
    const { error } = await sb.from("flyer_profiles").upsert({ user_id: user.id, total_coins: next.total, bird_kind: next.kind, color: next.color, accessory: next.acc, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) { setMsg(`Couldn’t save: ${error.message}`); return false; }
    setProf(next); return true;
  }
  async function pick(next: Prof) { setProf(next); await bank(0, next); }

  function onPlay() {
    setMsg(null);
    if (!clear) { setView("clearance"); return; }
    if (!hasCal) { location.href = CAL_URL; return; }   // first time on this account: calibrate first
    startGame();
  }
  async function confirmClearance() {
    setBusy(true); setMsg(null);
    const sb = supabase(); const { data: { user } } = await sb.auth.getUser(); if (!user) { location.href = "/"; return; }
    const { error } = await sb.from("consent_records").insert([{ user_id: user.id, kind: "exercise_clearance", granted: true, policy_version: POLICY_VERSION }, { user_id: user.id, kind: "camera_processing", granted: true, policy_version: POLICY_VERSION }]);
    setBusy(false);
    if (error) { setMsg(`Couldn’t save your confirmation: ${error.message}. (Run the 0006 database step in Supabase.)`); return; }
    setClear(true);
    if (!hasCal) location.href = CAL_URL; else setView("ready");
  }

  async function startGame() {
    const eff = st.auto ? AUTO : st;
    const plan = eff.exprs.filter(k => cal[k]);
    if (!plan.length) { setMsg("None of your chosen movements are calibrated yet. Recalibrate or change your settings."); setView("hub"); return; }
    setBusy(true); setMsg(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      stream.current = s; s.getVideoTracks()[0].onended = () => { g.current.adjust = true; };
      const v = video.current!; v.srcObject = s; await v.play();
      tracker.current = await createTracker(v, f => { latest.current = f; });
      const wh = clamp(Math.round(W * innerHeight / innerWidth), 560, 800), sc = Math.min(innerWidth / W, innerHeight / wh);
      cfg.current = { secs: eff.secs, gap: eff.gap, pace: eff.pace, auto: st.auto }; liveGain.current = eff.gain; setGainUi(eff.gain);
      g.current = fresh(plan, wh); setBox({ w: W * sc, h: wh * sc });
      setUi({ stage: "ready", si: 0, total: plan.length, ready: 6, left: eff.secs, adjust: false, paused: false, k: plan[0] }); setView("play");
    } catch (e: any) { stop(); setMsg(e?.name === "NotAllowedError" ? "Camera access is blocked. Allow it in your browser’s site settings, then try again." : `Couldn’t start the camera: ${e?.message ?? e}`); setView("hub"); }
    setBusy(false);
  }

  async function finish(completed: boolean) {
    const s = g.current; if (s.finished) return; s.finished = true; stop();
    const valid = s.per.reduce((a, p) => a + p.valid, 0), on = s.per.reduce((a, p) => a + p.on, 0), acc = valid > 0 ? r1(on / valid * 100) : 0;
    const before = P.current.total;
    const per = s.per.map(p => ({ k: p.k, accuracy: p.valid > 0 ? r1(p.on / p.valid * 100) : 0, gates: p.gates, coins: p.coins, misses: p.misses, seconds: r1(p.valid) }));
    const res: Result = { points: s.points, accuracy: acc, coins: s.coinsGot, misses: s.misses, bestStreak: s.best, gates: s.gates, seconds: s.t, completed, per, saved: true,
      unlocked: UNLOCKS.filter(u => u.need > before && u.need <= before + s.coinsGot).map(u => u.label) };
    setResult(res); setView("results");
    const sb = supabase(); const { data: { user } } = await sb.auth.getUser(); let ok = !!user;
    if (user) {
      const { error } = await sb.from("flight_games").insert({ user_id: user.id, mode: cfg.current.auto ? "auto" : "custom", duration_seconds: Math.round(s.t), points: s.points, accuracy: acc, coins: s.coinsGot, misses: s.misses, best_streak: s.best, gates: s.gates, completed, per_expression: per });
      if (error) { ok = false; setMsg(`Couldn’t save this game: ${error.message}. (Run the 0006 database step in Supabase.)`); }
      if (s.coinsGot > 0 && !(await bank(s.coinsGot))) ok = false;
    }
    if (!ok) setResult(r => (r ? { ...r, saved: false } : r));
  }
  useEffect(() => { if (view === "play" && ui.stage === "done") finish(true); }, [ui.stage]);

  async function openStats() {
    setView("stats"); setGames(null);
    const { data } = await supabase().from("flight_games").select("id,played_at,mode,duration_seconds,points,accuracy,coins,misses,best_streak,gates,completed,per_expression").order("played_at", { ascending: false }).limit(200);
    setGames((data as GameRow[]) ?? []);
  }

  useEffect(() => {
    if (view !== "play") return;
    document.body.style.overflow = "hidden"; document.documentElement.style.overscrollBehavior = "none";
    const cv = cvRef.current!, ctx = cv.getContext("2d")!, wh = g.current.wh, d = Math.min(3, devicePixelRatio || 2);
    cv.width = W * d; cv.height = wh * d; ctx.setTransform(d, 0, 0, d, 0, 0);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fit = () => { const sc = Math.min(innerWidth / W, innerHeight / wh); setBox({ w: W * sc, h: wh * sc }); };
    addEventListener("resize", fit);
    let raf = 0, prev = performance.now();
    const spawn = (s: G) => {
      const half = cfg.current.gap / 2, ground = s.wh - GROUND_H;
      let lo = TOP + 20 + half, hi = ground - 60 - half; if (hi < lo) { lo = (TOP + ground) / 2; hi = lo; }
      const c = clamp(s.prev + (Math.random() * 2 - 1) * 100, lo, hi); s.prev = c;
      s.pillars.push({ x: s.spawnX, c, gap: cfg.current.gap, passed: false, hit: false });
      s.coins.push({ x: s.spawnX, y: c + (Math.random() * 2 - 1) * half * .4, got: false });
      s.spawnX += 260;
    };
    const step = (dt: number, now: number) => {
      const s = g.current, fr = latest.current;
      if (s.manual || s.stage === "done") return;
      if (!(fr && fr.vals && fr.q.face && fr.q.size)) { if (s.lostSince == null) s.lostSince = now; if (now - s.lostSince > 600 && !s.adjust) { s.adjust = true; s.pauses++; } return; }
      s.lostSince = null; s.adjust = false;
      const k = s.plan[s.si], m = calRef.current[k]; if (!m) return;
      let l = clamp(liveGain.current * (fr.vals[k] - m.nm) / m.range, 0, 1); if (l < .12) l = 0;
      s.lev += (l - s.lev) * .3; s.flap += dt * (8 + s.lev * 12); s.active = s.lev >= HOVER;
      const ground = s.wh - GROUND_H;
      if (s.stage === "ready") { s.readyLeft -= dt; s.y = s.mid + Math.sin(now / 400) * 6; s.vy = 0; if (s.readyLeft <= 0) { s.stage = "play"; s.stageT = 0; } return; }
      s.t += dt; s.stageT += dt;
      const p = s.per[s.si]; p.valid += dt; if (s.active) p.on += dt;
      const ahead = s.coins.find(co => !co.got && co.x - s.scroll > BX - 12 && co.x - s.scroll < BX + 170);
      const pil = s.pillars.find(q => q.x - s.scroll + 30 > BX);
      const aim = ahead ? ahead.y : (pil && pil.x - s.scroll < BX + 200 ? pil.c : s.mid);
      if (s.active) s.vy += (clamp((aim - s.y) * 3, -200, 200) - s.vy) * Math.min(1, dt * 6);
      else s.vy += (70 - s.vy) * Math.min(1, dt * 2.5);
      s.scroll += cfg.current.pace * dt; s.invuln = Math.max(0, s.invuln - dt);
      if (s.assist) { s.assist.t += dt; const q = Math.min(1, s.assist.t / .5); s.y = s.assist.from + (s.assist.to - s.assist.from) * (q * q * (3 - 2 * q)); s.vy = 0; if (q >= 1) s.assist = null; }
      else s.y += s.vy * dt;
      if (s.y < TOP + 24) { s.y = TOP + 24; s.vy = Math.max(s.vy, 0); }
      if (s.y > ground - 22) { s.y = ground - 22; s.vy = Math.min(s.vy, -70); }
      while (s.spawnX < s.scroll + W + 80) spawn(s);
      for (const q of s.pillars) {
        const px = q.x - s.scroll;
        if (!q.passed && px + 26 < BX - 14) { q.passed = true; if (!q.hit) { s.gates++; s.points += 10; s.streak++; s.best = Math.max(s.best, s.streak); p.gates++; } }
        if (s.invuln <= 0 && !s.assist && Math.abs(BX - px) < 37 && (s.y - 11 < q.c - q.gap / 2 || s.y + 11 > q.c + q.gap / 2)) { s.assist = { t: 0, from: s.y, to: q.c }; s.invuln = 1.6; q.hit = true; s.misses++; s.streak = 0; p.misses++; }
      }
      for (const co of s.coins) if (!co.got && Math.hypot(co.x - s.scroll - BX, co.y - s.y) < 24) { co.got = true; s.coinsGot++; s.points += 5; p.coins++; }
      if (s.pillars.length > 12) s.pillars = s.pillars.filter(q => q.x - s.scroll > -100);
      if (s.coins.length > 40) s.coins = s.coins.filter(c => c.x - s.scroll > -40);
      if (s.stageT >= cfg.current.secs) { s.si++; if (s.si >= s.plan.length) { s.stage = "done"; s.si = s.plan.length - 1; } else { s.stage = "ready"; s.readyLeft = 5; s.lev = 0; s.active = false; } }
    };
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop); const dt = Math.min(.05, (now - prev) / 1000); prev = now; step(dt, now);
      const an = ANIMALS.find(a => a.k === P.current.kind) ?? ANIMALS[0];
      drawWorld(ctx, g.current, reduce ? 0 : now, P.current.color || an.col, P.current.acc, P.current.kind);
    };
    raf = requestAnimationFrame(loop);
    const id = setInterval(() => { const s = g.current; setUi({ stage: s.stage, si: s.si, total: s.plan.length, ready: Math.max(0, Math.ceil(s.readyLeft)), left: Math.max(0, Math.ceil(cfg.current.secs - s.stageT)), adjust: s.adjust, paused: s.manual, k: s.plan[Math.min(s.si, s.plan.length - 1)] }); }, 100);
    return () => { cancelAnimationFrame(raf); clearInterval(id); removeEventListener("resize", fit); document.body.style.overflow = ""; document.documentElement.style.overscrollBehavior = ""; };
  }, [view]);

  useEffect(() => {
    if (view !== "custom") return; const cv = pvRef.current; if (!cv) return;
    const c = cv.getContext("2d")!; cv.width = 240; cv.height = 150;
    const gr = c.createLinearGradient(0, 0, 0, 150); gr.addColorStop(0, "#62c3ee"); gr.addColorStop(1, "#cdeef6"); c.fillStyle = gr; c.fillRect(0, 0, 240, 150);
    const an = ANIMALS.find(a => a.k === prof.kind) ?? ANIMALS[0];
    drawCritter(c, 120, 82, -.1, prof.kind, prof.color || an.col, prof.acc, 0.6, 2.4);
  }, [view, prof]);

  const nextUnlock = UNLOCKS.find(u => u.need > prof.total);
  const ios = typeof navigator !== "undefined" && /iPhone|iPad/.test(navigator.userAgent) && !(navigator as any).standalone;

  const videoEl = <video ref={video} playsInline muted aria-label="Your camera preview (mirrored)"
    className={view === "play" && preview ? "fixed z-40 -scale-x-100 rounded-2xl object-cover shadow-soft" : "pointer-events-none fixed h-px w-px opacity-0"}
    style={view === "play" && preview ? { right: 12, top: `calc(env(safe-area-inset-top, 0px) + ${BANNER_H + 10}px)`, width: 96, height: 72 } : undefined} />;

  const body = () => {
    if (view === "loading") return <main className="grid min-h-dvh place-items-center text-navy/60">Loading…</main>;

    if (view === "clearance") return (
      <Page><h1 className="font-display text-3xl">Before you start</h1>
        <p className="mt-3 text-navy/70">Mirror Flight asks you to make gentle facial movements. Only continue if your clinician says gentle facial exercises are okay for you, and stop any time you feel discomfort or strain.</p>
        <p className="mt-3 text-navy/70">Your camera is used only while you play. It’s processed on your device, and video is never uploaded or saved.</p>
        <label className="mt-5 flex items-start gap-3 rounded-2xl bg-gold/20 p-4 text-sm"><input type="checkbox" className="mt-1 h-5 w-5 accent-teal" checked={agree} onChange={e => setAgree(e.target.checked)} />
          <span>My clinician has said gentle facial exercises are okay for me, and I understand I can stop at any time.</span></label>
        {msg && <p role="alert" className="mt-3 rounded-2xl bg-lav/40 p-3 text-sm">{msg}</p>}
        <button className="btn-primary mt-5 w-full" disabled={!agree || busy} onClick={confirmClearance}>{busy ? "Saving…" : "Continue"}</button>
        <button className="btn-quiet mt-3 w-full" onClick={() => setView("hub")}>Back</button></Page>);

    if (view === "ready") return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 text-center"><h1 className="font-display text-4xl">Camera is ready.</h1>
        <p className="mt-3 text-navy/70">Your movements are saved. Tap below to start flying.</p>
        {msg && <p role="alert" className="mt-3 rounded-2xl bg-lav/40 p-3 text-sm">{msg}</p>}
        <button className="btn-primary mt-8 min-h-[64px] w-full text-xl" disabled={busy} onClick={startGame}>{busy ? "Starting camera…" : "Start flying"}</button>
        <button className="btn-quiet mt-3 w-full" onClick={() => setView("hub")}>Back</button></main>);

    if (view === "settings") {
      const n = st.auto ? AUTO : st;
      return (
        <Page><h1 className="font-display text-3xl">Settings</h1>
          <label className="mt-5 flex items-center justify-between gap-4 rounded-3xl bg-paper p-5 shadow-soft"><span><b>Automatic settings</b><br /><span className="text-sm text-navy/60">Recommended. Picks everything for you.</span></span>
            <input type="checkbox" className="h-7 w-7 accent-teal" checked={st.auto} onChange={e => update({ auto: e.target.checked })} aria-label="Automatic settings" /></label>
          {st.auto ? <div className="mt-4 rounded-3xl bg-sage/30 p-5 text-sm"><p>All four expressions, in order: gentle smile, eyebrow raise, lip pucker, gentle eye closure.</p>
            <p className="mt-2">20 seconds each. Before each one you get a big picture and a few seconds to get ready.</p><p className="mt-2">{TOTAL_NOTE(KEYS.filter(k => cal[k]).length || 4, 20)}, plus short get-ready breaks.</p></div>
          : <div className="mt-4 grid gap-4">
            <div><h2 className="font-display text-xl">Expressions</h2><div className="mt-2 grid gap-2">{KEYS.map(k => (
              <button key={k} role="checkbox" aria-checked={n.exprs.includes(k)} disabled={!cal[k]} onClick={() => { const has = n.exprs.includes(k); const nx = has ? n.exprs.filter(x => x !== k) : KEYS.filter(x => n.exprs.includes(x) || x === k); if (nx.length) update({ exprs: nx as K[] }); }}
                className={`flex min-h-[64px] items-center gap-3 rounded-2xl border px-3 text-left ${n.exprs.includes(k) ? "border-teal bg-teal/10 shadow-soft" : "border-navy/15 bg-paper"} disabled:opacity-40`}><FaceArt k={k} size={44} /><span>{EXPR[k].name}{!cal[k] && <span className="block text-xs text-navy/60">Not calibrated</span>}</span></button>))}</div></div>
            <div><h2 className="font-display text-xl">Seconds for each</h2><div className="mt-2 grid grid-cols-4 gap-2">{[10, 15, 20, 30].map(v => <button key={v} aria-pressed={n.secs === v} onClick={() => update({ secs: v })} className={`min-h-[52px] rounded-2xl border ${n.secs === v ? "border-teal bg-teal/10 shadow-soft" : "border-navy/15 bg-paper"}`}>{v}</button>)}</div>
              <p className="mt-2 text-xs text-navy/60">{TOTAL_NOTE(n.exprs.filter(k => cal[k]).length, n.secs)}</p></div>
            <label className="text-sm">Sensitivity<select className="field mt-1" value={n.gain} onChange={e => update({ gain: +e.target.value })}>{GAINS.map((v, i) => <option key={v} value={v}>{i + 1} of 5{i === 2 ? " (recommended)" : i === 0 ? " (your exact target)" : i === 4 ? " (tiny movements count)" : ""}</option>)}</select></label>
            <label className="text-sm">Gap size<select className="field mt-1" value={n.gap} onChange={e => update({ gap: +e.target.value })}><option value={250}>Wide</option><option value={290}>Extra wide (recommended)</option><option value={330}>Huge</option></select></label>
            <label className="text-sm">Pace<select className="field mt-1" value={n.pace} onChange={e => update({ pace: +e.target.value })}><option value={60}>Very slow</option><option value={75}>Slow (recommended)</option><option value={100}>Normal</option></select></label></div>}
          <a href={CAL_URL} className="btn-quiet mt-6 inline-flex w-full items-center justify-center">Recalibrate camera</a>
          <button className="btn-primary mt-3 w-full" onClick={() => setView("hub")}>Done</button></Page>);
    }

    if (view === "custom") return (
      <Page><h1 className="font-display text-3xl">Customize your flyer</h1>
        <p className="mt-2 text-sm text-navy/70">You’ve collected <b>{prof.total}</b> coins in total. Coins are never spent, so everything you unlock stays yours.{nextUnlock ? ` Next unlock: ${nextUnlock.label} at ${nextUnlock.need} coins (${nextUnlock.need - prof.total} to go).` : " You’ve unlocked everything."}</p>
        <canvas ref={pvRef} className="mt-4 w-full rounded-3xl shadow-soft" aria-label="Preview of your flyer" />
        <h2 className="mt-6 font-display text-xl">Friend</h2>
        <div className="mt-2 grid grid-cols-2 gap-3">{ANIMALS.map(a => { const ok = prof.total >= a.need; return (
          <button key={a.k} disabled={!ok} aria-pressed={prof.kind === a.k} onClick={() => pick({ ...prof, kind: a.k })} className={`min-h-[56px] rounded-2xl border px-3 text-left ${prof.kind === a.k ? "border-teal bg-teal/10 shadow-soft" : "border-navy/15 bg-paper"} disabled:opacity-50`}>{a.n}<br /><span className="text-xs text-navy/60">{ok ? "Unlocked" : `🔒 ${a.need} coins`}</span></button>); })}</div>
        <h2 className="mt-6 font-display text-xl">Color</h2>
        <div className="mt-2 flex flex-wrap gap-3">{COLORS.map(co => { const ok = prof.total >= co.need; return (
          <button key={co.n} disabled={!ok} aria-label={`${co.n}${ok ? "" : `, unlocks at ${co.need} coins`}`} aria-pressed={prof.color === co.c} onClick={() => pick({ ...prof, color: co.c })} className={`grid h-14 w-14 place-items-center rounded-full border-2 text-xs ${prof.color === co.c ? "border-navy" : "border-navy/15"} disabled:opacity-40`} style={{ background: co.c || "#f4efe4" }}>{ok ? (co.c ? "" : "Auto") : "🔒"}</button>); })}</div>
        <h2 className="mt-6 font-display text-xl">Accessory</h2>
        <div className="mt-2 grid grid-cols-2 gap-3">{ACCS.map(a => { const ok = prof.total >= a.need; return (
          <button key={a.n} disabled={!ok} aria-pressed={prof.acc === a.k} onClick={() => pick({ ...prof, acc: a.k })} className={`min-h-[52px] rounded-2xl border px-3 text-left ${prof.acc === a.k ? "border-teal bg-teal/10 shadow-soft" : "border-navy/15 bg-paper"} disabled:opacity-50`}>{a.n}<br /><span className="text-xs text-navy/60">{ok ? "Unlocked" : `🔒 ${a.need} coins`}</span></button>); })}</div>
        {msg && <p role="alert" className="mt-3 rounded-2xl bg-lav/40 p-3 text-sm">{msg}</p>}
        <button className="btn-primary mt-8 w-full" onClick={() => setView("hub")}>Done</button></Page>);

    if (view === "stats") {
      const gs = games ?? [], done = gs.length;
      const avg = done ? gs.reduce((a, x) => a + Number(x.accuracy ?? 0), 0) / done : 0;
      const per = KEYS.map(k => { let on = 0, tot = 0; for (const x of gs) for (const p of x.per_expression ?? []) if (p.k === k) { on += p.accuracy * p.seconds; tot += p.seconds; } return { k, acc: tot > 0 ? on / tot : null as number | null }; });
      const tiles: [string, string][] = [["Games played", String(done)], ["Best score", done ? String(Math.max(...gs.map(x => x.points))) : "–"], ["Best streak", done ? String(Math.max(...gs.map(x => x.best_streak))) : "–"], ["Average accuracy", done ? `${Math.round(avg)}%` : "–"], ["Coins collected", String(prof.total)], ["Day streak", String(dayStreak(gs))]];
      return (
        <Page><h1 className="font-display text-3xl">Your stats</h1>
          <button className="btn-primary mt-4 min-h-[60px] w-full text-lg" onClick={onPlay}>Play game</button>
          {games === null && <p className="mt-6 text-navy/60">Loading…</p>}
          {games && done === 0 && <p className="mt-6 rounded-2xl bg-paper p-5 text-navy/70 shadow-soft">No games yet. Your first one will show up here.</p>}
          {done > 0 && <>
            <dl className="mt-5 grid grid-cols-2 gap-3">{tiles.map(([k, v]) => <div key={k} className="rounded-2xl bg-paper p-4 shadow-soft"><dd className="font-display text-3xl">{v}</dd><dt className="text-xs text-navy/60">{k}</dt></div>)}</dl>
            <section className="mt-6 rounded-3xl bg-paper p-5 shadow-soft"><h2 className="font-display text-xl">Accuracy, last {Math.min(12, done)} games</h2><p className="text-xs text-navy/60">Share of play time you held the requested movement.</p><AccChart games={gs} /></section>
            <section className="mt-4 rounded-3xl bg-paper p-5 shadow-soft"><h2 className="font-display text-xl">Accuracy by expression</h2>
              <div className="mt-3 grid gap-3">{per.map(p => <div key={p.k}><div className="flex justify-between text-sm"><span>{EXPR[p.k].name}</span><span>{p.acc == null ? "–" : `${Math.round(p.acc)}%`}</span></div>
                <div className="mt-1 h-2.5 rounded-full bg-mist"><div className="h-2.5 rounded-r-full bg-teal" style={{ width: `${p.acc ?? 0}%` }} /></div></div>)}</div></section>
            <section className="mt-4 rounded-3xl bg-paper p-5 shadow-soft"><h2 className="font-display text-xl">Recent games</h2>
              <ul className="mt-3 grid gap-3 text-sm">{gs.slice(0, 8).map(x => <li key={x.id} className="flex justify-between gap-3"><span>{fmtDate(x.played_at)} · {x.points} pts{x.completed ? "" : " (ended early)"}</span><span className="text-right text-navy/60">{Math.round(Number(x.accuracy ?? 0))}% · {x.coins} coins · {x.misses} missed · streak {x.best_streak}</span></li>)}</ul></section></>}
          <button className="btn-quiet mt-6 w-full" onClick={() => setView("hub")}>Back</button></Page>);
    }

    if (view === "results" && result) {
      const R = result;
      return (
        <Page><h1 className="font-display text-3xl">{R.completed ? "Flight complete." : "Flight ended early."}</h1>
          <p className="mt-2 text-navy/70">Thanks for flying. Every flight counts.</p>
          <div className="mt-5 grid grid-cols-2 gap-3">{([["Points", String(R.points)], ["Accuracy", `${Math.round(R.accuracy)}%`], ["Coins", String(R.coins)], ["Missed gates", String(R.misses)]] as [string, string][]).map(([k, v]) => <div key={k} className="rounded-2xl bg-paper p-4 shadow-soft"><div className="font-display text-4xl">{v}</div><div className="text-xs text-navy/60">{k}</div></div>)}
            <div className="col-span-2 rounded-2xl bg-paper p-4 shadow-soft"><div className="font-display text-4xl">{R.bestStreak}</div><div className="text-xs text-navy/60">Best streak (gates in a row)</div></div></div>
          <p className="mt-2 text-xs text-navy/60">Accuracy is the share of play time you held the requested movement. A missed gate is a bump into a pillar. You’re guided back, and nothing is lost.</p>
          <section className="mt-5 rounded-3xl bg-paper p-5 shadow-soft"><h2 className="font-display text-xl">By expression</h2>
            <ul className="mt-3 grid gap-3">{R.per.map(p => <li key={p.k} className="flex items-center gap-3"><FaceArt k={p.k} size={40} /><span className="flex-1 text-sm">{EXPR[p.k].name}<br /><span className="text-xs text-navy/60">{p.gates} gates · {p.coins} coins · {p.misses} missed</span></span><b>{Math.round(p.accuracy)}%</b></li>)}</ul></section>
          {R.unlocked.length > 0 && <p className="mt-4 rounded-2xl bg-gold/20 p-4 text-sm"><b>New unlock:</b> {R.unlocked.join(", ")}. Open “Customize”.</p>}
          {!R.saved && <p role="alert" className="mt-4 rounded-2xl bg-lav/40 p-4 text-sm">{msg ?? "This game couldn’t be saved."}</p>}
          <button className="btn-primary mt-6 min-h-[60px] w-full text-lg" onClick={onPlay}>Play again</button>
          <button className="btn-quiet mt-3 w-full" onClick={openStats}>See my stats</button>
          <button className="btn-quiet mt-3 w-full" onClick={() => setView("custom")}>Customize my flyer</button>
          <button className="btn-quiet mt-3 w-full" onClick={() => setView("hub")}>Home</button></Page>);
    }

    if (view === "play") return (
      <div className="fixed inset-0 touch-none bg-[#62c3ee]" style={{ height: "100dvh" }}>
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ width: box.w, height: box.h }}>
          <canvas ref={cvRef} style={{ width: "100%", height: "100%" }} aria-label="Side-scrolling flight. Hold the requested movement and the bird flies the path." />
        </div>
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center">
          <div className="w-full rounded-b-3xl bg-paper/95 shadow-soft" style={{ maxWidth: Math.max(box.w, 320), paddingTop: "env(safe-area-inset-top, 0px)" }}>
            <div className="flex items-center gap-3 px-4" style={{ height: BANNER_H }}>
              <FaceArt k={ui.k} size={76} />
              <div className="min-w-0 flex-1" role="status"><div className="text-xs text-navy/60">Expression {ui.si + 1} of {ui.total}</div>
                <div className="font-display text-2xl leading-tight">{EXPR[ui.k].name}</div><div className="text-sm text-navy/80">{EXPR[ui.k].cue}</div></div>
              <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full border-4 border-teal text-3xl font-bold" aria-label={`${ui.left} seconds left`}>{ui.left}</div>
            </div></div></div>
        <button aria-label="Pause" onClick={() => { g.current.manual = true; }} className="absolute z-20 grid h-14 w-14 place-items-center rounded-full bg-paper/90 shadow-soft" style={{ left: 12, top: `calc(env(safe-area-inset-top, 0px) + ${BANNER_H + 10}px)` }}>
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden><rect x="4" y="3" width="5" height="16" rx="1.5" fill="#1B2A3A" /><rect x="13" y="3" width="5" height="16" rx="1.5" fill="#1B2A3A" /></svg></button>
        {ui.stage === "ready" && !ui.paused && !ui.adjust && <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-navy/85 px-6 text-center text-ivory" role="status">
          <p className="text-sm text-ivory/70">Expression {ui.si + 1} of {ui.total}</p>
          <div className="mt-3"><FaceArt k={ui.k} size={200} /></div>
          <h2 className="mt-4 font-display text-4xl leading-tight">{EXPR[ui.k].name}</h2>
          <p className="mt-2 text-2xl">{EXPR[ui.k].cue}</p><p className="mt-2 max-w-xs text-sm text-ivory/75">{EXPR[ui.k].tip}</p>
          <p className="mt-5 font-display text-3xl">Starting in {ui.ready}</p>
          <button className="btn-primary mt-4 bg-ivory !text-navy" onClick={() => { g.current.readyLeft = 0; }}>I’m ready, start now</button></div>}
        {ui.adjust && !ui.paused && <div className="absolute inset-0 z-40 grid place-items-center bg-navy/70 p-8 text-center text-ivory" role="alert"><div><p className="font-display text-3xl">Let’s adjust your camera</p>
          <p className="mt-3 text-base">We can’t see your face clearly. Center it and add light. The game waits, and nothing is counted against you.</p></div></div>}
        {ui.paused && <div className="absolute inset-0 z-50 grid place-items-center bg-navy/75 p-6 text-ivory" role="dialog" aria-label="Paused"><div className="w-full max-w-xs text-center">
          <p className="font-display text-3xl">Paused</p><p className="mt-1 text-sm text-ivory/75">Take as long as you need.</p>
          <button className="btn-primary mt-5 w-full bg-ivory !text-navy" onClick={() => { g.current.manual = false; }}>Resume</button>
          <div className="mt-4 rounded-2xl bg-ivory/10 p-3 text-sm"><p>Sensitivity {Math.max(1, GAINS.indexOf(gainUi) + 1)} of 5</p><p className="text-xs text-ivory/70">Not lifting off? Try Easier.</p>
            <div className="mt-2 grid grid-cols-2 gap-2"><button className="btn-quiet min-h-[48px]" onClick={() => { const v = GAINS[Math.min(4, Math.max(0, GAINS.indexOf(gainUi)) + 1)]; liveGain.current = v; setGainUi(v); }}>Easier</button>
              <button className="btn-quiet min-h-[48px]" onClick={() => { const v = GAINS[Math.max(0, Math.max(0, GAINS.indexOf(gainUi)) - 1)]; liveGain.current = v; setGainUi(v); }}>Harder</button></div></div>
          <button className="btn-quiet mt-3 w-full" onClick={() => setPreview(p => !p)}>{preview ? "Hide camera preview" : "Show camera preview"}</button>
          <button className="btn-quiet mt-3 w-full" onClick={() => finish(false)}>End game</button></div></div>}
      </div>);

    // hub
    return (
      <Page>
        <div className="flex items-center justify-between"><a href="/dashboard" className="text-sm text-navy/60">← Home</a><span className="rounded-full bg-paper px-4 py-2 text-sm shadow-soft">🪙 <b>{prof.total}</b></span></div>
        <svg viewBox="0 0 240 130" className="mt-4 w-full rounded-3xl shadow-soft" aria-hidden><rect width="240" height="130" fill="#62c3ee" /><rect x="170" y="0" width="30" height="44" fill="#79c08c" stroke="#35604a" strokeWidth="3" /><rect x="170" y="88" width="30" height="42" fill="#79c08c" stroke="#35604a" strokeWidth="3" />
          <ellipse cx="80" cy="66" rx="26" ry="23" fill="#6bb3a8" stroke="#2b3340" strokeWidth="3" /><circle cx="90" cy="59" r="6" fill="#fff" stroke="#2b3340" strokeWidth="2" /><circle cx="92" cy="59" r="3" fill="#2b3340" /><path d="M104 66 L120 71 L104 76Z" fill="#f29e4c" stroke="#2b3340" strokeWidth="2" />
          <circle cx="185" cy="66" r="9" fill="#f6c945" stroke="#a67c12" strokeWidth="2" /></svg>
        <h1 className="mt-5 font-display text-4xl">Mirror Flight</h1>
        <p className="mt-2 text-navy/70">Make the expression shown on screen and your bird flies through the gaps.</p>
        {msg && <p role="alert" className="mt-3 rounded-2xl bg-lav/40 p-3 text-sm">{msg}</p>}
        <button className="btn-primary mt-5 min-h-[64px] w-full text-xl" onClick={onPlay}>Play game</button>
        <div className="mt-3 grid grid-cols-2 gap-3"><button className="btn-quiet min-h-[56px]" onClick={openStats}>Stats</button><button className="btn-quiet min-h-[56px]" onClick={() => setView("custom")}>Customize</button></div>
        <button className="btn-quiet mt-3 w-full" onClick={() => setView("settings")}>Settings · {st.auto ? "Automatic" : "Custom"}</button>
        {ios && <p className="mt-6 rounded-2xl bg-lav/30 p-4 text-xs text-navy/70">For the full-screen version on iPhone: tap the Share button in Safari, choose <b>Add to Home Screen</b>, then open SmileQuest from your home screen.</p>}
      </Page>);
  };
  return <>{videoEl}{body()}</>;
}
