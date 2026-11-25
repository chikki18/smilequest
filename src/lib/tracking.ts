// Reusable face tracking engine (MediaPipe Face Landmarker). Runs on-device; no video is uploaded or stored.
export type Vals = { smile:number; brow:number; pucker:number; close:number; liftL:number; liftR:number; browL:number; browR:number; closeL:number; closeR:number; frown:number; sideA:number; sideB:number; tongue:number; tonA:number; tonB:number };
export type Quality = { face:boolean; size:boolean; light:boolean; fps:number };
export type AC = { lx:number; ly:number; rx:number; ry:number };
export type Frame = { t:number; vals:Vals|null; q:Quality; pos?:{ x:number; y:number; s:number }; ac?:AC };
const V = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// ---- tongue finder (colour-based; see comments) ----
// Finds the tongue by colour in a small crop around the mouth, and reports which way it is shifted.
// It looks for pink/red pixels inside the open mouth and below the lower lip (the lip ring itself is ignored).
// Nothing is stored; the crop is a tiny 64x48 canvas that is overwritten every frame.
const T_OUTER = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
const T_INNER = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191];
const CW = 64, CH = 48;
type TPt = { x: number; y: number };
type TongueF = { shift: number; area: number; out: number; inn: number };
let tcv: HTMLCanvasElement | null = null, tcx: CanvasRenderingContext2D | null = null, mi: CanvasRenderingContext2D | null = null, mo: CanvasRenderingContext2D | null = null;
function tInit() {
  if (tcx) return true; if (typeof document === "undefined") return false;
  const mk = () => { const c = document.createElement("canvas"); c.width = CW; c.height = CH; return c.getContext("2d", { willReadFrequently: true }); };
  tcv = document.createElement("canvas"); tcv.width = CW; tcv.height = CH; tcx = tcv.getContext("2d", { willReadFrequently: true }); mi = mk(); mo = mk();
  return !!(tcx && mi && mo);
}
const medianT = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const clampT = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// src: the camera video (or any canvas). P: face landmarks (0..1). W,H: source size in pixels. iod: eye distance in pixels.
function tongueFeatures(src: CanvasImageSource, P: TPt[], W: number, H: number, iod: number): TongueF | null {
  if (!tInit() || !tcx || !mi || !mo || iod < 20) return null;
  const mxp = (P[61].x + P[291].x) / 2 * W, myp = (P[13].y + P[14].y) / 2 * H, bw = 2.2 * iod, bh = 1.7 * iod, sx = mxp - bw / 2, sy = myp - 0.4 * bh;
  try { tcx.clearRect(0, 0, CW, CH); tcx.drawImage(src, sx, sy, bw, bh, 0, 0, CW, CH); } catch { return null; }
  const px = tcx.getImageData(0, 0, CW, CH).data;
  const mapx = (p: TPt) => (p.x * W - sx) / bw * CW, mapy = (p: TPt) => (p.y * H - sy) / bh * CH;
  for (const [ctx, ring] of [[mi, T_INNER], [mo, T_OUTER]] as [CanvasRenderingContext2D, number[]][]) {
    ctx.clearRect(0, 0, CW, CH); ctx.fillStyle = "#fff"; ctx.beginPath(); ring.forEach((i, k) => { const x = mapx(P[i]), y = mapy(P[i]); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath(); ctx.fill();
  }
  const ai = mi.getImageData(0, 0, CW, CH).data, ao = mo.getImageData(0, 0, CW, CH).data, lipY = mapy(P[17]) - 1, midY = mapy(P[13]);
  // skin reference: how red the skin below the mouth is
  const ref: number[] = [];
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) { const i = (y * CW + x) * 4; if (y > midY && ao[i + 3] < 40 && px[i + 3] > 200) ref.push(px[i] - px[i + 1]); }
  if (ref.length < 40) return null;
  const skin = medianT(ref); let A = 0, Ax = 0, Aout = 0, Ain = 0;
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
    const i = (y * CW + x) * 4, r = px[i], g = px[i + 1], b = px[i + 2]; if (px[i + 3] < 200 || r < 80) continue;
    let s = 0;
    if (ai[i + 3] > 128) { if ((r + g + b) / 3 > 55) { s = clampT(((r - g) - 30) / 45, 0, 1); Ain += s; } }          // inside the open mouth
    else if (ao[i + 3] < 40 && y > lipY) { s = clampT(((r - g) - skin - 20) / 35, 0, 1); Aout += s; }   // below the lower lip, outside the lip ring
    if (s > 0) { A += s; Ax += s * x; }
  }
  const n = CW * CH, conf = clampT(A / (n * 0.012), 0, 1), cxn = A > 0.5 ? Ax / A / CW - 0.5 : 0;
  return { shift: cxn * (bw / iod) * conf, area: A / n, out: Aout / n, inn: Ain / n };
}

export async function createTracker(video: HTMLVideoElement, onFrame: (f: Frame) => void) {
  const url = `${V}/vision_bundle.mjs`;
  const vision: any = await import(/* webpackIgnore: true */ url);
  const files = await vision.FilesetResolver.forVisionTasks(`${V}/wasm`);
  let lm: any;
  for (const delegate of ["GPU", "CPU"]) {
    try {
      lm = await vision.FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: "VIDEO", numFaces: 1, outputFaceBlendshapes: true });
      break;
    } catch (e) { if (delegate === "CPU") throw e; }
  }
  let running = true, raf = 0, last = 0, lastVT = -1, interval = 33, swap = false, n = 0, light = 0.5;
  const times: number[] = [];
  let frames = 0, fpsT = performance.now(), fps = 0;
  let sm: Vals | null = null, acs: AC | null = null;
  const cv = document.createElement("canvas"); cv.width = 32; cv.height = 24;
  const cx = cv.getContext("2d", { willReadFrequently: true })!;
  const emit = (vals: Vals | null, face: boolean, size: boolean, pos?: { x: number; y: number; s: number }, ac?: AC) =>
    onFrame({ t: Date.now(), vals, pos, ac, q: { face, size, light: light > 0.18 && light < 0.92, fps } });

  const tick = (now: number) => {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    // Skip when backgrounded, not ready, throttled, or no new camera frame
    if (document.hidden || video.readyState < 2 || now - last < interval || video.currentTime === lastVT) return;
    last = now; lastVT = video.currentTime;
    const t0 = performance.now();
    let r: any;
    try { r = lm.detectForVideo(video, now); } catch { return; }
    times.push(performance.now() - t0); if (times.length > 30) times.shift();
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    interval = avg > 28 ? 50 : avg > 18 ? 40 : 33; // adaptive rate for slower/hot phones
    frames++; if (now - fpsT > 1000) { fps = Math.round(frames * 1000 / (now - fpsT)); frames = 0; fpsT = now; }
    if (n++ % 10 === 0) {
      cx.drawImage(video, 0, 0, 32, 24); const d = cx.getImageData(0, 0, 32, 24).data; let s = 0;
      for (let i = 0; i < d.length; i += 4) s += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
      light = s / (d.length / 4) / 255;
    }
    const P = r.faceLandmarks?.[0];
    if (!P) { sm = null; acs = null; emit(null, false, false); return; }
    const W = video.videoWidth, H = video.videoHeight;
    // Head-roll-corrected, face-size-normalised coordinates (units = inter-ocular distance, not millimetres)
    const a = P[33], b = P[263];
    const ex = (b.x - a.x) * W, ey = (b.y - a.y) * H, iod = Math.hypot(ex, ey), roll = Math.atan2(ey, ex);
    const c = Math.cos(-roll), s = Math.sin(-roll);
    const X = (p: any) => ((p.x - a.x) * W * c - (p.y - a.y) * H * s) / iod - 0.5;
    const Y = (p: any) => ((p.x - a.x) * W * s + (p.y - a.y) * H * c) / iod;
    const mid = (Y(P[13]) + Y(P[14])) / 2;
    // Landmark 291/334/386 = person's anatomical LEFT; 61/105/159 = person's RIGHT (camera image is not mirrored here)
    const liftL = mid - Y(P[291]), liftR = mid - Y(P[61]);
    const browL = Y(P[386]) - Y(P[334]), browR = Y(P[159]) - Y(P[105]);
    const bs: Record<string, number> = {};
    for (const k of r.faceBlendshapes?.[0]?.categories ?? []) bs[k.categoryName] = k.score;
    let closeL = bs.eyeBlinkLeft ?? 0, closeR = bs.eyeBlinkRight ?? 0;
    if (swap) [closeL, closeR] = [closeR, closeL];
    // Tongue: the model only reports "tongue out", not which way it points. We gate a sideways jaw/mouth shift by tongue-out.
    const tf = tongueFeatures(video, P, W, H, iod), ev = Math.min(1, Math.max((bs.tongueOut ?? 0) * 1.5, tf ? Math.min(1, tf.out / 0.03) : 0, tf ? Math.min(1, tf.inn / 0.05) * 0.7 : 0)), jawG = Math.min(1, (bs.jawOpen ?? 0) / 0.35), tongue = 0.45 * jawG + 0.55 * ev, tw = 0.6 + 0.4 * Math.min(1, tongue * 3), jA = ((bs.jawLeft ?? 0) + (bs.mouthLeft ?? 0)) / 2, jB = ((bs.jawRight ?? 0) + (bs.mouthRight ?? 0)) / 2;
    // One signed sideways cue (jaw + mouth blendshapes + where the lip centre and lower lip sit relative to the nose); left and right are its two signs.
    const lat0 = (jB - jA) + 6 * ((X(P[13]) + X(P[14])) / 2 - X(P[1])) + 5 * (X(P[17]) - X(P[1])), lat = tf ? 4 * tf.shift + 0.3 * lat0 : lat0;
    const raw: Vals = { liftL, liftR, browL, browR, closeL, closeR, smile: (liftL + liftR) / 2, brow: (browL + browR) / 2, close: (closeL + closeR) / 2, pucker: bs.mouthPucker ?? 0,
      frown: Math.max(0, 1.6 * ((bs.mouthFrownLeft ?? 0) + (bs.mouthFrownRight ?? 0)) / 2 + 0.5 * (bs.mouthShrugLower ?? 0) + 0.3 * ((bs.mouthPressLeft ?? 0) + (bs.mouthPressRight ?? 0)) / 2 - 0.9 * ((bs.browDownLeft ?? 0) + (bs.browDownRight ?? 0)) / 2 - 0.6 * (bs.browInnerUp ?? 0) - 0.4 * ((bs.browOuterUpLeft ?? 0) + (bs.browOuterUpRight ?? 0)) / 2 - 0.6 * ((bs.mouthSmileLeft ?? 0) + (bs.mouthSmileRight ?? 0)) / 2), sideA: bs.mouthLeft ?? 0, sideB: bs.mouthRight ?? 0, tongue, tonA: tw * Math.max(0, lat), tonB: tw * Math.max(0, -lat) };
    const size = iod / W > 0.1 && iod / W < 0.45 && P[1].x > 0.1 && P[1].x < 0.9 && P[1].y > 0.1 && P[1].y < 0.9;
    if (!sm) sm = raw; else for (const k of Object.keys(raw) as (keyof Vals)[]) sm[k] = sm[k] * 0.65 + raw[k] * 0.35; // temporal smoothing
    const acr: AC = { lx: X(P[291]), ly: Y(P[291]), rx: X(P[61]), ry: Y(P[61]) };
    if (!acs) acs = acr; else { acs.lx = acs.lx * 0.5 + acr.lx * 0.5; acs.ly = acs.ly * 0.5 + acr.ly * 0.5; acs.rx = acs.rx * 0.5 + acr.rx * 0.5; acs.ry = acs.ry * 0.5 + acr.ry * 0.5; }
    emit({ ...sm }, true, size, { x: P[1].x, y: P[1].y, s: iod / W }, { ...acs });
  };
  raf = requestAnimationFrame(tick);
  return { stop() { running = false; cancelAnimationFrame(raf); try { lm.close?.(); } catch {} }, setSwap(v: boolean) { swap = v; } };
}
