"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { createTracker, type Frame, type Vals } from "@/lib/tracking";
import { meanAC, acFromSaved, type AC } from "@/lib/commissure";
import { VIDEO_CONSENT_VERSION } from "@/lib/daily";

// ---------- what we measure ----------
type Id = "smile" | "brow" | "frown" | "pucker" | "right" | "left" | "tright" | "tleft" | "tout" | "close";
type SK = "smile" | "brow" | "frown" | "pucker" | "close" | "sideA" | "sideB" | "tonA" | "tonB" | "tongue" | "jaw" | "lnA" | "lnB";
type Step = "intro" | "align" | "rest" | Id | "review";
const ORDER: Step[] = ["intro", "align", "rest", "smile", "brow", "frown", "pucker", "right", "left", "close", "tright", "tleft", "tout", "review"];
const MOVES: Id[] = ["smile", "brow", "frown", "pucker", "right", "left", "close", "tright", "tleft", "tout"];
const COPY: Record<Id, { title: string; cue: string; tip: string; games: string }> = {
  smile: { title: "Smile", cue: "Close-mouth smile or smile with teeth", tip: "Either style works. Never force it.", games: "Flight · Dash" },
  brow: { title: "Eyebrow raise", cue: "Lift your eyebrows", tip: "Raise them gently, as if mildly surprised.", games: "Flight · Dash" },
  frown: { title: "Frown", cue: "Frown", tip: "Turn the corners of your mouth down. Keep your brows relaxed.", games: "Dash" },
  pucker: { title: "Lip pucker", cue: "Round your lips like “ooo”", tip: "Gently purse them and hold.", games: "Flight" },
  right: { title: "Pucker to your right", cue: "Pucker, then nudge your lips to your right", tip: "Round your lips, then shift them toward your right cheek.", games: "Dash" },
  left: { title: "Pucker to your left", cue: "Pucker, then nudge your lips to your left", tip: "Round your lips, then shift them toward your left cheek.", games: "Dash" },
  tright: { title: "Tongue swipe right", cue: "Tongue out, sweep it to your right", tip: "Stick your tongue out and point it to the right corner of your mouth. Watch the “Detected” bar fill, then hold.", games: "Fruit Slice" },
  tleft: { title: "Tongue swipe left", cue: "Tongue out, sweep it to your left", tip: "Stick your tongue out and point it to the left corner of your mouth. Watch the “Detected” bar fill, then hold.", games: "Fruit Slice" },
  tout: { title: "Tongue out", cue: "Open your mouth and stick your tongue out", tip: "Open your mouth wide, then stick your tongue out and hold. Watch the “Detected” bar fill.", games: "Fruit Slice" },
  close: { title: "Gentle eye closure", cue: "Close your eyes softly", tip: "Soft, like resting. No squeezing.", games: "Flight" },
};
const MINSK: Record<SK, number> = { smile: .015, brow: .015, frown: .04, pucker: .08, close: .08, sideA: .08, sideB: .08, tonA: .02, tonB: .02, tongue: .1, jaw: .1, lnA: .03, lnB: .03 };
const EASYK: SK[] = ["tonA", "tonB", "tongue", "jaw", "lnA", "lnB"], PARTNER: Partial<Record<SK, SK>> = { tonA: "tonB", tonB: "tonA", lnA: "lnB", lnB: "lnA" };
const CAL_KEYS = ["smile", "brow", "pucker", "close", "liftL", "liftR", "browL", "browR", "closeL", "closeR"] as (keyof Vals)[];
const FSIDES: Record<string, (keyof Vals)[] | null> = { smile: ["liftL", "liftR"], brow: ["browL", "browR"], pucker: null, close: ["closeL", "closeR"] };
const sig = (v: Vals): Record<SK, number> => ({ smile: v.smile, brow: v.brow, frown: v.frown, pucker: v.pucker, close: v.close, sideA: v.sideA - 0.6 * v.sideB + 0.3 * v.pucker, sideB: v.sideB - 0.6 * v.sideA + 0.3 * v.pucker, tonA: v.tonA, tonB: v.tonB, tongue: v.tongue, jaw: v.jaw, lnA: v.lnA, lnB: v.lnB });
const SKS: SK[] = ["smile", "brow", "frown", "pucker", "close", "sideA", "sideB", "tonA", "tonB", "tongue", "jaw", "lnA", "lnB"];
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
const topMean = (a: number[]) => mean([...a].sort((x, y) => y - x).slice(0, Math.max(5, Math.floor(a.length / 4))));
const buzz = (p: number | number[]) => { try { if ("vibrate" in navigator) navigator.vibrate(p); } catch { /* not supported */ } };
type Neutral = { sk: Record<SK, { mean: number; std: number }>; raw: Record<string, { mean: number; std: number }> };
const CW = 360, CH = 480, CX = CW / 2, CY = CH * .46, RX = CW * .34, RY = CH * .36, IOD = RX * 2 / 2.4;
const BLUE = "#8fd0ff", PURPLE = "#b79cff";

function Guide({ id, size = 64 }: { id: Id | "rest" | "pucker"; size?: number }) {
  const sx = id === "right" ? 5 : id === "left" ? -5 : 0, tg = id === "tright" || id === "tleft", td = id === "tright" ? 1 : -1;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" stroke={BLUE} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <ellipse cx="50" cy="52" rx="31" ry="38" strokeOpacity=".5" />
      {id === "brow" ? <><path d="M26 33q9-9 18 0M56 33q9-9 18 0" /><circle cx="35" cy="46" r="4" fill={BLUE} /><circle cx="65" cy="46" r="4" fill={BLUE} /></>
        : id === "close" ? <><path d="M27 46q8 7 16 0M57 46q8 7 16 0" /><path d="M27 36q8-4 16 0M57 36q8-4 16 0" strokeOpacity=".6" /></>
        : <><path d="M27 37q8-4 16 0M57 37q8-4 16 0" strokeOpacity=".7" /><circle cx="36" cy="47" r="3" fill={BLUE} /><circle cx="64" cy="47" r="3" fill={BLUE} /></>}
      {id === "smile" ? <path d="M33 68q17 14 34 0" /> : id === "frown" ? <path d="M35 77q15-12 30 0" /> : id === "tout" ? <><path d="M40 66h20q0 7-10 7t-10-7z" fill={BLUE} fillOpacity=".15" /><path d="M45 71q5 17 10 0" stroke="#ff9db4" fill="#ff9db4" fillOpacity=".5" /></> : tg ? <><path d="M42 66h16q0 6-8 6t-8-6z" /><path d={`M${50 + td * 2} 70q${td * 4} 9 ${td * 9} 7`} stroke="#ff9db4" /></> : id === "pucker" || id === "right" || id === "left" ? <circle cx={50 + sx * 2.4} cy="70" r="6.5" /> : id === "brow" ? <path d="M40 70h20" /> : <path d="M38 70h24" strokeOpacity=".7" />}
      {(id === "right" || id === "left" || tg) && <path d={id === "right" || id === "tright" ? "M68 70h14m-5-5l5 5-5 5" : "M32 70H18m5-5l-5 5 5 5"} />}
    </svg>);
}

type Built = { flight: Record<string, any>; dash: Record<string, any>; neutral: Record<string, { mean: number; std: number }>; status: Record<Id, "ok" | "weak" | "skipped"> };

export default function Calibrate() {
  const video = useRef<HTMLVideoElement>(null), cv = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null), tracker = useRef<Awaited<ReturnType<typeof createTracker>> | null>(null), latest = useRef<Frame | null>(null);
  const [step, setStep] = useState<Step>("intro"), [cam, setCam] = useState<"off" | "loading" | "on">("off"), [err, setErr] = useState<string | null>(null);
  const [built, setBuilt] = useState<Built | null>(null), [saving, setSaving] = useState(false), [saved, setSaved] = useState(false);
  const [hud, setHud] = useState({ aligned: false, locked: false, hint: "Looking for your face…", progress: 0, phase: "brief" as "brief" | "count" | "hold" | "flash", skipHint: false, face: false, count: 0 as number, live: 0 });
  const S = useRef({ step: "intro" as Step, alignedSince: 0, lostSince: 0, locked: false, enteredAt: 0, phase: "brief" as "brief" | "count" | "hold" | "flash", phaseStart: 0, lostAt: 0, fails: 0, skipBrief: false, over: 0, holdStart: 0, weakSince: 0, buf: [] as Vals[], restBuf: [] as Vals[], restMs: 0, last: 0, flashUntil: 0, bestKey: "sideA" as SK, rightKey: null as SK | null, trightKey: null as SK | null, lockTRight: null as SK | null, neutral: null as Neutral | null, redo: false, samples: {} as Partial<Record<Id, Vals[]>>, progress: 0, hint: "", face: false, aligned: false, rough: false, one: null as Id | null, lockRight: null as SK | null, acBuf: [] as AC[], ac0: null as AC | null });
  type Prev = { flight: Record<string, any>; dash: Record<string, any>; neutral: Record<string, any>; ac0: AC | null };
  const [prev, setPrev] = useState<Prev | null | undefined>(undefined), [one, setOne] = useState<Id | null>(null);
  const [first, setFirst] = useState(false); useEffect(() => { setFirst(new URLSearchParams(location.search).get("first") === "1"); }, []);
  const [daily, setDaily] = useState(false); useEffect(() => { setDaily(new URLSearchParams(location.search).get("daily") === "1"); }, []);
  // ---- daily recalibration settings + optional video for the care team ----
  type RS = { daily: boolean; video: boolean; consentAt: string | null; ok: boolean };
  const [rs, setRs] = useState<RS>({ daily: true, video: false, consentAt: null, ok: true }), [rsMsg, setRsMsg] = useState<string | null>(null), [consentOpen, setConsentOpen] = useState(false), [nVideos, setNVideos] = useState(0), [confirmDel, setConfirmDel] = useState(false);
  const rec = useRef<{ mr: MediaRecorder; chunks: Blob[]; t0: number; mime: string } | null>(null), parts = useRef<{ blob: Blob; seconds: number }[]>([]), upN = useRef(0), sessId = useRef("");
  const [recOn, setRecOn] = useState(false), [vid, setVid] = useState<"idle" | "uploading" | "done" | "failed">("idle"), [nParts, setNParts] = useState(0);
  useEffect(() => { (async () => {
    const sb = supabase(); const { data: { user } } = await sb.auth.getUser(); if (!user) return;
    const r = await sb.from("recal_settings").select("daily,video,video_consent_at").maybeSingle();
    if (r.error) { setRs(x => ({ ...x, ok: false })); return; }
    const d: any = r.data; if (d) setRs({ daily: !!d.daily, video: !!d.video, consentAt: d.video_consent_at ?? null, ok: true });
    const c = await sb.from("calibration_videos").select("id", { count: "exact", head: true }); setNVideos(c.count ?? 0);
  })(); }, []);
  async function saveRs(p: Partial<RS>) {
    const n = { ...rs, ...p }; setRs(n); const sb = supabase(); const { data: { user } } = await sb.auth.getUser(); if (!user) return;
    const { error } = await sb.from("recal_settings").upsert({ user_id: user.id, daily: n.daily, video: n.video, video_consent_at: n.consentAt, video_consent_version: n.consentAt ? VIDEO_CONSENT_VERSION : null, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    setRsMsg(error ? `Couldn’t save this setting: ${error.message}. (Run the 0011 database step in Supabase.)` : null);
  }
  async function deleteVideos() {
    const sb = supabase(); const { data: { user } } = await sb.auth.getUser(); if (!user) return;
    const { data } = await sb.from("calibration_videos").select("path"); const paths = ((data as any[]) ?? []).map(x => x.path as string);
    if (paths.length) { const r = await sb.storage.from("calibration-videos").remove(paths); if (r.error) { setRsMsg(`Couldn’t delete: ${r.error.message}`); return; } }
    await sb.from("calibration_videos").delete().eq("user_id", user.id); setNVideos(0); setConfirmDel(false); setRsMsg("Your recordings were deleted.");
  }
  function startRec() {
    if (!(rs.video && rs.consentAt) || S.current.one || !stream.current || rec.current || typeof MediaRecorder === "undefined") return;
    const mime = ["video/webm;codecs=vp8", "video/webm", "video/mp4"].find(t => { try { return MediaRecorder.isTypeSupported(t); } catch { return false; } }) ?? "";
    try {
      const mr = new MediaRecorder(stream.current, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 900000 }), chunks: Blob[] = [];
      mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data); }; mr.start(1000);
      rec.current = { mr, chunks, t0: Date.now(), mime: mr.mimeType || mime || "video/webm" }; setRecOn(true);
    } catch { setRecOn(false); }
  }
  function endRec(keep: boolean): Promise<void> {
    const r = rec.current; rec.current = null; setRecOn(false); if (!r) return Promise.resolve();
    return new Promise(res => {
      r.mr.onstop = () => { if (keep && r.chunks.length) { parts.current.push({ blob: new Blob(r.chunks, { type: r.mime }), seconds: Math.round((Date.now() - r.t0) / 1000) }); setNParts(parts.current.length); } res(); };
      try { if (r.mr.state !== "inactive") r.mr.stop(); else res(); } catch { res(); }
    });
  }
  async function uploadParts(): Promise<boolean> {
    const ps = parts.current; if (!ps.length || upN.current >= ps.length) { setVid("done"); return true; }
    setVid("uploading"); setErr(null);
    try {
      const sb = supabase(); const { data: { user } } = await sb.auth.getUser(); if (!user) return false;
      if (!sessId.current) sessId.current = new Date().toISOString().replace(/[:.]/g, "-");
      for (let i = upN.current; i < ps.length; i++) {
        const p = ps[i], base = (p.blob.type || "video/webm").split(";")[0], ext = base.includes("mp4") ? "mp4" : "webm", path = `${user.id}/${sessId.current}-p${i + 1}.${ext}`;
        const up = await sb.storage.from("calibration-videos").upload(path, p.blob, { contentType: base, upsert: true }); if (up.error) throw up.error;
        const ins = await sb.from("calibration_videos").insert({ user_id: user.id, path, mime: base, size_bytes: p.blob.size, duration_seconds: p.seconds, kind: daily ? "daily" : "recalibration", app_version: "m11", device: navigator.userAgent.slice(0, 200),
          summary: { session: sessId.current, part: i + 1, parts: ps.length, full: true, status: built?.status ?? null, flight: built?.flight ?? null, dash: built?.dash ?? null, ac0: S.current.ac0 ?? prev?.ac0 ?? null } });
        if (ins.error) throw ins.error; upN.current = i + 1;
      }
      setVid("done"); setNVideos(n => n + ps.length); return true;
    } catch (e: any) { setVid("failed"); setErr(`Your calibration saved, but the video didn’t upload: ${e?.message ?? e}. Check your connection and try again. (If this keeps happening, run the 0011 database step in Supabase.)`); return false; }
  }


  useEffect(() => { (async () => { const { data: { user } } = await supabase().auth.getUser(); if (!user) { location.href = "/"; return; }
    const sb = supabase(); const a = await sb.from("calibration_profiles").select("summary").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle(); const b = await sb.from("dash_calibration").select("summary").eq("user_id", user.id).maybeSingle();
    const fl = (a.data as any)?.summary, da = (b.data as any)?.summary;
    setPrev(fl || da ? { flight: fl?.moves ?? {}, dash: da?.moves ?? {}, neutral: fl?.neutral ?? {}, ac0: acFromSaved(fl?.ac0) ?? acFromSaved(da?.ac0) } : null); })(); return () => stop(); }, []);
  function stop() { if (rec.current) void endRec(false); tracker.current?.stop(); tracker.current = null; stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; latest.current = null; }
  function nextUrl() { const n = new URLSearchParams(location.search).get("next"); return n && n.startsWith("/") && !n.startsWith("//") ? n : "/dashboard"; }

  function enter(s: Step) {
    const r = S.current; r.step = s; r.enteredAt = performance.now(); r.phase = "brief"; r.phaseStart = performance.now(); r.lostAt = 0; r.fails = 0; r.skipBrief = false; r.over = 0; r.buf = []; r.progress = 0; r.weakSince = 0; r.restBuf = []; r.restMs = 0; r.flashUntil = 0;
    if (s === "review") { S.current.redo = false; setBuilt(build()); void endRec(true); stop(); setCam("off"); }
    setStep(s);
  }
  function goBack() {
    const i = ORDER.indexOf(S.current.step), o = S.current.one, n = o && (S.current.step === "review" || (MOVES as string[]).includes(S.current.step)) ? (S.current.step === "review" ? o : "rest") : ORDER[i - 1];
    if (!n) { location.href = "/dashboard"; return; }
    if (n === "intro") { stop(); setCam("off"); enter("intro"); return; }
    if (cam === "off") { startCam(n); return; }
    delete S.current.samples[n as Id]; if (n === "rest") S.current.neutral = null; if (n === "right" && !S.current.one) S.current.rightKey = null; if (n === "tright" && !S.current.one) S.current.trightKey = null;
    enter(n);
  }
  async function startCam(goTo: Step = "align") {
    setCam("loading"); setErr(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      stream.current = s; s.getVideoTracks()[0].onended = () => { setCam("off"); setErr("The camera was interrupted. Tap Start camera to resume."); };
      const v = video.current!; v.srcObject = s; await v.play();
      tracker.current = await createTracker(v, f => { latest.current = f; });
      setCam("on"); if (goTo === "align") { parts.current = []; upN.current = 0; sessId.current = ""; setNParts(0); setVid("idle"); } startRec(); enter(goTo);
    } catch (e: any) { stop(); setCam("off"); setErr(e?.name === "NotAllowedError" ? "Camera access is blocked. Allow it in your browser’s site settings (the lock icon by the address), then try again." : `Couldn’t start the camera: ${e?.message ?? e}`); }
  }

  function build(): Built {
    const nu = S.current.neutral, sm = S.current.samples;
    const status = {} as Record<Id, "ok" | "weak" | "skipped">; const flight: Record<string, any> = {}, dash: Record<string, any> = {};
    if (!nu) { for (const m of MOVES) status[m] = "skipped"; return { flight, dash, neutral: {}, status }; }
    const mv = (s: Vals[], k: SK, key?: SK) => { const kk = key ?? k, a = s.map(v => sig(v)[kk]), n = nu.sk[kk], peak = topMean(a), range = peak - n.mean; return { key: kk, nm: n.mean, std: n.std, peak, range, detectable: EASYK.includes(kk) ? range > Math.max(2 * n.std, MINSK[kk]) : range > Math.max(3 * n.std, MINSK[kk]) }; };
    const best = (s: Vals[], keys: SK[]) => keys.map(k => mv(s, k)).reduce((a, b) => (b.range / MINSK[b.key as SK] > a.range / MINSK[a.key as SK] ? b : a));
    for (const k of ["smile", "brow", "pucker", "close"] as const) {
      const s = sm[k]; if (!s?.length) { status[k] = "skipped"; continue; }
      const n = nu.raw[k], peak = topMean(s.map(v => v[k] as number)), range = peak - n.mean, detectable = range > Math.max(3 * n.std, MINSK[k]);
      const top = [...s].sort((a, b) => (b[k] as number) - (a[k] as number)).slice(0, Math.max(5, Math.floor(s.length / 4))), sides = FSIDES[k];
      flight[k] = { peak, range, threshold: n.mean + .5 * range, detectable, sideDelta: sides ? sides.map(x => mean(top.map(t => t[x] as number)) - nu.raw[x as string].mean) : null };
      status[k] = detectable ? "ok" : "weak";
    }
    for (const [d, k] of [["jump", "smile"], ["fly", "brow"], ["duck", "frown"]] as [string, SK][]) { const s = sm[k === "smile" ? "smile" : k === "brow" ? "brow" : "frown"]; if (s?.length) dash[d] = mv(s, k); }
    if (sm.frown?.length) status.frown = dash.duck.detectable ? "ok" : "weak"; else status.frown = "skipped";
    let rk: SK | null = S.current.lockRight;
    if (sm.right?.length) { const lk = S.current.lockRight, a = mv(sm.right, "sideA"), b = mv(sm.right, "sideB"), win = lk ? mv(sm.right, lk) : a.range / MINSK.sideA >= b.range / MINSK.sideB ? a : b; rk = win.key; dash.right = win; status.right = win.detectable ? "ok" : "weak"; } else status.right = "skipped";
    if (sm.left?.length && rk) { const w = mv(sm.left, "sideA", rk === "sideA" ? "sideB" : "sideA"); dash.left = w; status.left = w.detectable ? "ok" : "weak"; } else status.left = "skipped";
    let tk: SK | null = S.current.lockTRight;
    if (sm.tright?.length) { const lk = S.current.lockTRight, win = lk ? mv(sm.tright, lk) : best(sm.tright, ["tonA", "tonB", "lnA", "lnB"]); tk = win.key as SK; dash.tright = win; status.tright = win.detectable ? "ok" : "weak"; } else status.tright = "skipped";
    if (sm.tleft?.length && tk) { const w = mv(sm.tleft, tk, PARTNER[tk] ?? "tonB"); dash.tleft = w; status.tleft = w.detectable ? "ok" : "weak"; } else status.tleft = "skipped";
    if (sm.tout?.length) { const w = best(sm.tout, ["tongue", "jaw"]); dash.tout = w; status.tout = w.detectable ? "ok" : "weak"; } else status.tout = "skipped";
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
        const isRest = r.step === "rest", id = r.step as Id, BRIEF = 3500, easy = id === "tright" || id === "tleft" || id === "tout", HOLD = easy ? 2200 : 3000;
        if (r.phase === "flash") { hint = isRest ? "Baseline saved" : "Got it"; r.progress = 1; if (now > r.flashUntil) { if (isRest) enter(S.current.one ?? "smile"); else enter(r.redo ? "review" : ORDER[ORDER.indexOf(r.step) + 1]); } }
        else if (!rough || !good) {
          if (!r.lostAt) r.lostAt = now;
          if ((r.phase === "count" || r.phase === "hold") && now - r.lostAt > 500) { r.phase = "brief"; r.phaseStart = now; r.buf = []; r.acBuf = []; }
          if (r.phase === "brief") { r.phaseStart = now; r.skipBrief = false; }
          r.progress = 0; if (!face) hint = "Looking for your face…";
        } else {
          r.lostAt = 0; const el = now - r.phaseStart;
          if (r.phase === "brief") { hint = r.fails ? "Let’s try that once more" : "Press I’m ready"; r.progress = 0; if (r.skipBrief) { r.skipBrief = false; r.phase = "count"; r.phaseStart = now; } }
          else if (r.phase === "count") { count = Math.max(1, 3 - Math.floor(el / 1000)); hint = isRest ? "Relax your face" : COPY[id].title; r.progress = 0; if (el >= 3000) { r.phase = "hold"; r.phaseStart = now; r.buf = []; r.acBuf = []; buzz(40); } }
          else if (r.phase === "hold") {
            hint = isRest ? "Stay relaxed…" : "Hold it…"; r.buf.push(fr!.vals!); if (isRest && fr!.ac) r.acBuf.push(fr!.ac); r.progress = Math.min(1, el / HOLD);
            if (el >= HOLD) {
              if (isRest) {
                if (r.buf.length > 25) {
                  const nu: Neutral = { sk: {} as any, raw: {} }; for (const k of SKS) { const a = r.buf.map(b => sig(b)[k]); nu.sk[k] = { mean: mean(a), std: sd(a) }; }
                  for (const k of CAL_KEYS) { const a = r.buf.map(b => b[k] as number); nu.raw[k as string] = { mean: mean(a), std: sd(a) }; }
                  r.neutral = nu; r.ac0 = meanAC(r.acBuf); r.phase = "flash"; r.flashUntil = now + 1100; buzz(100);
                } else { r.fails++; r.phase = "brief"; r.phaseStart = now; }
              } else if (r.neutral) {
                const nu = r.neutral, tng = id === "tright" || id === "tleft", fam: SK[] = tng ? ["tonA", "tonB", "lnA", "lnB"] : ["sideA", "sideB"], isR = id === "right" || id === "tright", isL = id === "left" || id === "tleft", rkey = tng ? (r.trightKey ?? r.lockTRight) : (r.rightKey ?? r.lockRight), lockK = tng ? r.lockTRight : r.lockRight, cands: SK[] = isR ? (lockK ? [lockK] : fam) : isL ? (rkey ? [(tng ? PARTNER[rkey] : (rkey === "sideA" ? "sideB" : "sideA")) ?? fam[0]] : fam) : id === "tout" ? ["tongue", "jaw"] : [id as SK];
                let bk = cands[0], br = -9;
                for (const k of cands) { const a = r.buf.map(q => sig(q)[k]), n = nu.sk[k], ratio = (topMean(a) - n.mean) / Math.max(3 * n.std, MINSK[k]); if (ratio > br) { br = ratio; bk = k; } }
                if (br > (easy ? (r.fails >= 2 ? 0.12 : 0.4) : 1)) { r.samples[id] = r.buf; if (id === "right") r.rightKey = bk; if (id === "tright") r.trightKey = bk; r.phase = "flash"; r.flashUntil = now + 1200; buzz(110); }
                else { r.fails++; r.phase = "brief"; r.phaseStart = now; r.buf = []; }
              } else enter("rest");
            }
          }
        }
        hudSkip = r.fails >= 2 && !isRest;
      }
      let live = 0;
      if ((r.step === "tright" || r.step === "tleft" || r.step === "tout") && r.neutral && good) {
        const nu = r.neutral, v = sig(fr!.vals!), rk = r.trightKey ?? r.lockTRight, keys: SK[] = r.step === "tout" ? ["tongue", "jaw"] : r.step === "tleft" ? (rk ? [PARTNER[rk] ?? "tonB"] : ["tonA", "tonB", "lnA", "lnB"]) : (r.lockTRight ? [r.lockTRight] : ["tonA", "tonB", "lnA", "lnB"]);
        live = Math.max(...keys.map(k => Math.max(0, Math.min(1, (v[k] - nu.sk[k].mean) / (Math.max(2 * nu.sk[k].std, MINSK[k]) * 1.5)))));
      }
      if (now - hudT > 100) { hudT = now; setHud({ aligned: r.aligned, locked: r.locked, hint, progress: r.progress, phase: r.phase, skipHint: hudSkip, face, count, live }); }
      drawHud(x, now, face, nx, ny, ok, r.locked, r.step);
    };
    let hudSkip = false;
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [cam]);

  async function save() {
    if (!built) return; setSaving(true); setErr(null);
    const sb = supabase(); const { data: { user } } = await sb.auth.getUser(); if (!user) { location.href = "/"; return; }
    const fm = { ...(one ? prev?.flight : {}), ...built.flight }, dm = { ...(one ? prev?.dash : {}), ...built.dash }, nm = { ...(one ? prev?.neutral : {}), ...built.neutral };
    const ac0 = S.current.ac0 ?? prev?.ac0 ?? null;
    const e1 = (await sb.from("calibration_profiles").insert({ user_id: user.id, summary: { version: 2, full: !one, neutral: nm, moves: fm, ac0, swapLR: false, note: "Camera-derived estimates in face-size-normalised units; not clinical measurements." } })).error;
    if (e1) { setSaving(false); setErr(`Couldn’t save: ${e1.message}`); return; }
    const e2 = (await sb.from("dash_calibration").upsert({ user_id: user.id, summary: { version: 1, moves: dm, ac0, note: "Camera-derived estimates; not clinical measurements." }, updated_at: new Date().toISOString() }, { onConflict: "user_id" })).error;
    setSaving(false);
    if (e2) { setErr(`Your main calibration saved, but Mirror Dash’s didn’t: ${e2.message}. (Run the 0007 database step in Supabase.)`); return; }
    buzz([100, 80, 100]); setSaved(true);
    if (!one && parts.current.length) { const ok = await uploadParts(); if (!ok) return; }
    setTimeout(() => { location.href = nextUrl(); }, 900);
  }

  const idx = ORDER.indexOf(step), total = ORDER.length - 2; const isMove = (MOVES as string[]).includes(step); const c = isMove ? COPY[step as Id] : null;
  const seq: Step[] = one ? ["align", "rest", one] : ORDER.slice(1, -1), sidx = step === "review" ? seq.length : seq.indexOf(step) + 1, stotal = seq.length;
  const dots = <div className="flex gap-1" role="progressbar" aria-valuemin={1} aria-valuemax={stotal} aria-valuenow={Math.min(stotal, Math.max(1, sidx))} aria-label={`Step ${Math.max(1, sidx)} of ${stotal}`}>{seq.map((s, n) => <div key={s} className={`h-1 flex-1 rounded-full ${n < sidx ? "bg-teal" : "bg-navy/15"}`} />)}</div>;
  const videoEl = <video ref={video} playsInline muted className="pointer-events-none fixed left-0 top-0 h-1 w-1 opacity-[0.02]" aria-hidden />;

  const settingsBlock = rs.ok ? (
    <section className="mt-5 w-full rounded-2xl bg-paper p-4 text-left shadow-soft"><h2 className="font-display text-lg">Daily recalibration</h2>
      <label className="mt-3 flex items-center justify-between gap-4 text-sm"><span><b>Recalibrate every day</b><br /><span className="text-xs text-navy/60">The games ask you to recalibrate once a day so the measurements stay accurate.</span></span>
        <input type="checkbox" className="h-7 w-7 shrink-0 accent-teal" checked={rs.daily} onChange={e => saveRs({ daily: e.target.checked })} aria-label="Recalibrate every day" /></label>
      <label className="mt-4 flex items-center justify-between gap-4 text-sm"><span><b>Save a video of my recalibration</b><br /><span className="text-xs text-navy/60">Records only the recalibration, never game play. Off unless you choose it.</span></span>
        <input type="checkbox" className="h-7 w-7 shrink-0 accent-teal" checked={rs.video && !!rs.consentAt} onChange={e => { if (!e.target.checked) saveRs({ video: false }); else if (rs.consentAt) saveRs({ video: true }); else setConsentOpen(true); }} aria-label="Save a video of my recalibration" /></label>
      {consentOpen && <div className="mt-3 rounded-xl bg-gold/20 p-3 text-xs text-navy/80" role="group" aria-label="Video consent"><b>Before you turn this on</b>
        <p className="mt-1">Your recalibration will be recorded on video and uploaded to a private, secure account. The SmileQuest team can use it to check that the app’s measurements match how your face really moves.</p>
        <p className="mt-1">The video shows your face, so it can identify you. Game play is never recorded. You can turn this off at any time and delete your recordings here.</p>
        <div className="mt-3 grid grid-cols-2 gap-2"><button className="btn-primary min-h-[44px]" onClick={() => { setConsentOpen(false); saveRs({ video: true, consentAt: new Date().toISOString() }); }}>I agree</button><button className="btn-quiet min-h-[44px]" onClick={() => setConsentOpen(false)}>Not now</button></div></div>}
      {nVideos > 0 && <div className="mt-3 text-xs text-navy/70">{nVideos} recording{nVideos === 1 ? "" : "s"} saved. {confirmDel ? <span>Delete them all? <button className="underline" onClick={deleteVideos}>Yes, delete</button> · <button className="underline" onClick={() => setConfirmDel(false)}>Cancel</button></span> : <button className="underline" onClick={() => setConfirmDel(true)}>Delete my recordings</button>}</div>}
      {rsMsg && <p role="status" className="mt-2 text-xs text-navy/70">{rsMsg}</p>}
    </section>) : null;

  if (step === "intro" && prev === undefined && !first) return <main className="min-h-dvh" />;
  if (step === "intro" && !first && !daily && prev) {
    const ok = (m: Id) => { const d = m === "frown" ? prev.dash.duck : m === "right" ? prev.dash.right : m === "left" ? prev.dash.left : m === "tright" ? prev.dash.tright : m === "tleft" ? prev.dash.tleft : m === "tout" ? prev.dash.tout : m === "pucker" || m === "close" ? prev.flight[m] : prev.flight[m] ?? prev.dash.jump; return d ? (d.detectable ? "ready" : "weak") : "none"; };
    const choose = (m: Id) => { const r = S.current; r.one = m; r.redo = true; r.lockRight = m === "right" ? (prev.dash.left ? prev.dash.right?.key ?? null : null) : m === "left" ? prev.dash.right?.key ?? null : null; r.lockTRight = m === "tright" ? (prev.dash.tleft ? prev.dash.tright?.key ?? null : null) : m === "tleft" ? prev.dash.tright?.key ?? null : null; setOne(m); startCam("align"); };
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))]">{videoEl}
        <button className="self-start text-sm text-navy/60" onClick={() => (location.href = nextUrl())} aria-label="Back">← Back</button>
        <h1 className="mt-5 font-display text-4xl">Recalibrate</h1>
        <p className="mt-1 text-navy/60">Pick one movement</p>
        <ul className="mt-5 grid gap-2">{MOVES.map(m => { const s = ok(m), off = (m === "left" && !prev.dash.right) || (m === "tleft" && !prev.dash.tright); return <li key={m}><button disabled={cam === "loading" || off} onClick={() => choose(m)} className="flex w-full items-center gap-3 rounded-2xl bg-paper p-3 text-left shadow-soft transition active:scale-[.99] disabled:opacity-40">
          <Guide id={m} size={44} /><span className="flex-1"><b>{COPY[m].title}</b><br /><span className="text-xs text-navy/60">{off ? (m === "tleft" ? "Do tongue right first" : "Do pucker right first") : COPY[m].games}</span></span>
          <span className={`rounded-full px-3 py-1 text-xs ${s === "ready" ? "bg-sage/40" : "bg-gold/30"}`}>{s === "ready" ? "Ready" : s === "weak" ? "Weak" : "Not set"}</span></button></li>; })}</ul>
        {err && <p role="alert" className="mt-3 rounded-xl bg-lav/50 p-3 text-sm">{err}</p>}
        {settingsBlock}
        <div className="mt-auto pt-6"><button className="btn-quiet w-full" disabled={cam === "loading"} onClick={() => { S.current.one = null; S.current.lockRight = null; S.current.lockTRight = null; setOne(null); startCam("align"); }}>{cam === "loading" ? "Starting camera…" : "Recalibrate everything"}</button>
          <p className="mt-3 text-center text-xs text-navy/50">Glasses off · good light · eye level</p></div>
      </main>);
  }

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
        <h1 className="mt-6 font-display text-4xl">{daily ? "Daily recalibration" : first ? "Let’s calibrate" : "Calibrate"}</h1>
        <p className="mt-1 text-navy/60">{daily ? "About 3 minutes. Once a day keeps your measurements accurate." : "About 3 minutes"}</p>
        <ul className="mt-7 grid w-full grid-cols-3 gap-3 text-xs text-navy/80">
          <li className="rounded-2xl bg-paper px-2 py-4 shadow-soft"><svg viewBox="0 0 32 32" className="mx-auto h-8 w-8 text-teal" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><circle cx="9" cy="19" r="5" /><circle cx="23" cy="19" r="5" /><path d="M14 19h4M4 19L6 10M28 19l-2-9M5 28L27 8" /></svg><span className="mt-2 block">Glasses off</span></li>
          <li className="rounded-2xl bg-paper px-2 py-4 shadow-soft"><svg viewBox="0 0 32 32" className="mx-auto h-8 w-8 text-teal" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><circle cx="16" cy="16" r="5" /><path d="M16 4v3M16 25v3M4 16h3M25 16h3M7.5 7.5l2 2M22.5 22.5l2 2M24.5 7.5l-2 2M9.5 22.5l-2 2" /></svg><span className="mt-2 block">Good light</span></li>
          <li className="rounded-2xl bg-paper px-2 py-4 shadow-soft"><svg viewBox="0 0 32 32" className="mx-auto h-8 w-8 text-teal" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="9" y="3" width="14" height="26" rx="3" /><circle cx="16" cy="10" r="2" /><path d="M13 25h6" /></svg><span className="mt-2 block">Eye level</span></li>
        </ul>
      </div>
      {settingsBlock}
      {err && <p role="alert" className="mb-3 mt-3 rounded-xl bg-lav/50 p-3 text-sm">{err}</p>}
      <button className="btn-primary mt-4 min-h-[60px] w-full text-lg" disabled={cam === "loading"} onClick={() => startCam("align")}>{cam === "loading" ? "Starting camera…" : "Start"}</button>
      {first && <p className="mt-3 text-center text-xs text-navy/50"><button className="underline" onClick={() => { try { sessionStorage.setItem("sq-skipcal", "1"); } catch { /* ignore */ } location.href = "/dashboard"; }}>Skip for now</button></p>}
    </main>);

  if (step === "review") {
    const b = built; const st = (m: Id) => b?.status[m] ?? "skipped";
    const flightOk = (["smile", "brow", "pucker", "close"] as Id[]).some(m => st(m) === "ok"), dashOk = (["smile", "brow", "frown", "right", "left"] as Id[]).every(m => st(m) === "ok"), sliceOk = (["tright", "tleft", "tout"] as Id[]).every(m => st(m) === "ok");
    if (one) { const good = st(one) === "ok"; return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">{videoEl}
        {dots}<h1 className="mt-5 font-display text-3xl">{COPY[one].title}</h1>
        <div className="mt-6 flex flex-col items-center rounded-3xl bg-paper p-8 text-center shadow-soft"><Guide id={one} size={96} />
          <span className={`mt-4 rounded-full px-4 py-1.5 text-sm ${good ? "bg-sage/40" : "bg-gold/30"}`}>{good ? "Ready" : st(one) === "weak" ? "Not detected" : "Skipped"}</span>
          {!good && <p className="mt-3 text-sm text-navy/70">Try a little more this time.</p>}</div>
        {err && <p role="alert" className="mt-3 rounded-xl bg-lav/50 p-3 text-sm">{err}</p>}
        <div className="mt-auto grid gap-3 pt-6">
          {good ? <button className="btn-primary min-h-[60px] w-full text-lg" disabled={saving || saved} onClick={save}>{saved ? "Saved ✓" : saving ? "Saving…" : "Save"}</button>
            : <button className="btn-primary min-h-[60px] w-full text-lg" onClick={() => { S.current.redo = true; startCam(one); }}>Try again</button>}
          <button className="btn-quiet w-full" disabled={saving} onClick={() => { stop(); location.href = location.pathname + location.search; }}>Pick another</button></div>
      </main>); }
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">{videoEl}
        {dots}<h1 className="mt-5 font-display text-3xl">All set?</h1>
        <ul className="mt-4 grid gap-2">{MOVES.map(m => <li key={m} className="flex items-center gap-3 rounded-xl bg-paper p-3 shadow-soft"><Guide id={m} size={44} /><span className="flex-1"><b>{COPY[m].title}</b><br /><span className="text-xs text-navy/60">{COPY[m].games}</span></span>
          <span className={`rounded-full px-3 py-1 text-xs ${st(m) === "ok" ? "bg-sage/40" : "bg-gold/30"}`}>{st(m) === "ok" ? "Ready" : st(m) === "weak" ? "Not detected" : "Skipped"}</span>
          <button className="text-sm text-teal underline" onClick={() => { S.current.redo = true; startCam(m); }}>Redo</button></li>)}</ul>
        <div className="mt-4 grid gap-2 text-sm"><p className={`rounded-xl p-3 ${flightOk ? "bg-sage/25" : "bg-gold/25"}`}>Mirror Flight: {flightOk ? "ready" : "needs at least one movement"}</p>
          <p className={`rounded-xl p-3 ${dashOk ? "bg-sage/25" : "bg-gold/25"}`}>Mirror Dash: {dashOk ? "ready" : "not ready yet"}</p>
          <p className={`rounded-xl p-3 ${sliceOk ? "bg-sage/25" : "bg-gold/25"}`}>Fruit Slice: {sliceOk ? "ready" : "needs all three tongue movements"}</p></div>
        {err && <p role="alert" className="mt-3 rounded-xl bg-lav/50 p-3 text-sm">{err}</p>}
        {nParts > 0 && vid === "idle" && <p className="mt-3 rounded-xl bg-paper p-3 text-sm text-navy/70 shadow-soft">Your recalibration video will be uploaded when you save.</p>}
        {vid === "uploading" && <p role="status" className="mt-3 rounded-xl bg-paper p-3 text-sm text-navy/70 shadow-soft">Uploading your recalibration video. Please keep this page open…</p>}
        {vid === "failed" && <div className="mt-3 grid gap-2"><button className="btn-primary min-h-[52px]" onClick={async () => { if (await uploadParts()) setTimeout(() => { location.href = nextUrl(); }, 600); }}>Try upload again</button><button className="btn-quiet" onClick={() => { location.href = nextUrl(); }}>Continue without the video</button></div>}
        <div className="mt-auto pt-6"><button className="btn-primary w-full min-h-[60px] text-lg" disabled={saving || saved || !(flightOk || dashOk || sliceOk)} onClick={save}>{saved ? "Saved ✓" : saving ? "Saving…" : "Save calibration"}</button>
          <button className="btn-quiet mt-3 w-full" disabled={saving || saved || vid === "uploading"} onClick={() => goBack()}>Back</button></div>
      </main>);
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">{videoEl}
      <div className="px-1">{dots}</div>
      <div className="relative mt-3 overflow-hidden rounded-2xl border border-sage/40 bg-black shadow-soft" style={{ aspectRatio: `${CW} / ${CH}` }}>
        <canvas ref={cv} className="absolute inset-0 h-full w-full" aria-label="Your camera preview (mirrored) with a head-position outline" />
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3 text-white">
          <span className="rounded bg-[#0f1038]/70 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[.2em] text-[#8fd0ff] backdrop-blur">{step === "align" ? "Align" : step === "rest" ? "Baseline" : one ? "Recalibrate" : `Move ${Math.max(1, idx - 2)}/${MOVES.length}`}</span>
          {(isMove || step === "rest") && <span className="rounded-lg bg-[#0f1038]/70 p-1.5 backdrop-blur"><Guide id={isMove ? (step as Id) : "rest"} size={58} /></span>}
        </div>
        {recOn && <div className="pointer-events-none absolute left-3 top-[58px] flex items-center gap-1.5 rounded bg-[#0f1038]/70 px-2 py-1 text-[11px] text-[#ffb3c4]" role="status"><span className="h-2 w-2 rounded-full bg-[#ff5a7a]" />Recording this recalibration</div>}
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
            {(step === "tright" || step === "tleft" || step === "tout") && <div className="mt-2 flex items-center gap-2 text-xs text-white/80"><span className="w-16">Detected</span><div className="h-2.5 flex-1 rounded-full bg-white/15"><div className="h-2.5 rounded-full bg-[#ffb3c4] transition-[width] duration-100" style={{ width: `${Math.round(hud.live * 100)}%` }} /></div></div>}
            <div className="mt-2.5 h-1 rounded-full bg-white/15"><div className="h-1 rounded-full bg-[#8fd0ff] transition-[width] duration-100" style={{ width: `${Math.round(hud.progress * 100)}%` }} /></div>
          </div></div>
      </div>
      {err && <p role="alert" className="mt-3 rounded-xl bg-lav/50 p-3 text-sm">{err}</p>}
      <div className="mt-4 grid gap-3">
        {(isMove || step === "rest") && hud.phase === "brief" && <button className="btn-primary min-h-[60px] w-full text-lg" onClick={() => { S.current.skipBrief = true; }}>I’m ready</button>}
        <div className="flex items-center gap-3">
          <button className="btn-quiet" onClick={() => goBack()}>Back</button>
          {isMove && !one && <button className={`btn-quiet flex-1 ${hud.skipHint ? "!border-teal" : ""}`} onClick={() => enter(S.current.redo ? "review" : ORDER[ORDER.indexOf(step) + 1])}>Skip this one</button>}
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
