// Reusable face tracking engine (MediaPipe Face Landmarker). Runs on-device; no video is uploaded or stored.
export type Vals = { smile:number; brow:number; pucker:number; close:number; liftL:number; liftR:number; browL:number; browR:number; closeL:number; closeR:number; frown:number; sideA:number; sideB:number };
export type Quality = { face:boolean; size:boolean; light:boolean; fps:number };
export type Frame = { t:number; vals:Vals|null; q:Quality; pos?:{ x:number; y:number; s:number } };
const V = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

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
  let sm: Vals | null = null;
  const cv = document.createElement("canvas"); cv.width = 32; cv.height = 24;
  const cx = cv.getContext("2d", { willReadFrequently: true })!;
  const emit = (vals: Vals | null, face: boolean, size: boolean, pos?: { x: number; y: number; s: number }) =>
    onFrame({ t: Date.now(), vals, pos, q: { face, size, light: light > 0.18 && light < 0.92, fps } });

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
    if (!P) { sm = null; emit(null, false, false); return; }
    const W = video.videoWidth, H = video.videoHeight;
    // Head-roll-corrected, face-size-normalised coordinates (units = inter-ocular distance, not millimetres)
    const a = P[33], b = P[263];
    const ex = (b.x - a.x) * W, ey = (b.y - a.y) * H, iod = Math.hypot(ex, ey), roll = Math.atan2(ey, ex);
    const c = Math.cos(-roll), s = Math.sin(-roll);
    const Y = (p: any) => ((p.x - a.x) * W * s + (p.y - a.y) * H * c) / iod;
    const mid = (Y(P[13]) + Y(P[14])) / 2;
    // Landmark 291/334/386 = person's anatomical LEFT; 61/105/159 = person's RIGHT (camera image is not mirrored here)
    const liftL = mid - Y(P[291]), liftR = mid - Y(P[61]);
    const browL = Y(P[386]) - Y(P[334]), browR = Y(P[159]) - Y(P[105]);
    const bs: Record<string, number> = {};
    for (const k of r.faceBlendshapes?.[0]?.categories ?? []) bs[k.categoryName] = k.score;
    let closeL = bs.eyeBlinkLeft ?? 0, closeR = bs.eyeBlinkRight ?? 0;
    if (swap) [closeL, closeR] = [closeR, closeL];
    const raw: Vals = { liftL, liftR, browL, browR, closeL, closeR, smile: (liftL + liftR) / 2, brow: (browL + browR) / 2, close: (closeL + closeR) / 2, pucker: bs.mouthPucker ?? 0,
      frown: ((bs.mouthFrownLeft ?? 0) + (bs.mouthFrownRight ?? 0)) / 2, sideA: bs.mouthLeft ?? 0, sideB: bs.mouthRight ?? 0 };
    const size = iod / W > 0.1 && iod / W < 0.45 && P[1].x > 0.1 && P[1].x < 0.9 && P[1].y > 0.1 && P[1].y < 0.9;
    if (!sm) sm = raw; else for (const k of Object.keys(raw) as (keyof Vals)[]) sm[k] = sm[k] * 0.65 + raw[k] * 0.35; // temporal smoothing
    emit({ ...sm }, true, size, { x: P[1].x, y: P[1].y, s: iod / W });
  };
  raf = requestAnimationFrame(tick);
  return { stop() { running = false; cancelAnimationFrame(raf); try { lm.close?.(); } catch {} }, setSwap(v: boolean) { swap = v; } };
}
