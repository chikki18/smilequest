// Finds the tongue by colour in a small crop around the mouth, and reports which way it is shifted.
// It looks for pink/red pixels inside the open mouth and below the lower lip (the lip ring itself is ignored).
// Nothing is stored; the crop is a tiny 64x48 canvas that is overwritten every frame.
const OUTER = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
const INNER = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191];
const CW = 64, CH = 48;
type Pt = { x: number; y: number };
export type TongueF = { shift: number; area: number; out: number };
let cv: HTMLCanvasElement | null = null, cx: CanvasRenderingContext2D | null = null, mi: CanvasRenderingContext2D | null = null, mo: CanvasRenderingContext2D | null = null;
function init() {
  if (cx) return true; if (typeof document === "undefined") return false;
  const mk = () => { const c = document.createElement("canvas"); c.width = CW; c.height = CH; return c.getContext("2d", { willReadFrequently: true }); };
  cv = document.createElement("canvas"); cv.width = CW; cv.height = CH; cx = cv.getContext("2d", { willReadFrequently: true }); mi = mk(); mo = mk();
  return !!(cx && mi && mo);
}
const median = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// src: the camera video (or any canvas). P: face landmarks (0..1). W,H: source size in pixels. iod: eye distance in pixels.
export function tongueFeatures(src: CanvasImageSource, P: Pt[], W: number, H: number, iod: number): TongueF | null {
  if (!init() || !cx || !mi || !mo || iod < 20) return null;
  const mxp = (P[61].x + P[291].x) / 2 * W, myp = (P[13].y + P[14].y) / 2 * H, bw = 2.2 * iod, bh = 1.7 * iod, sx = mxp - bw / 2, sy = myp - 0.4 * bh;
  try { cx.clearRect(0, 0, CW, CH); cx.drawImage(src, sx, sy, bw, bh, 0, 0, CW, CH); } catch { return null; }
  const px = cx.getImageData(0, 0, CW, CH).data;
  const mapx = (p: Pt) => (p.x * W - sx) / bw * CW, mapy = (p: Pt) => (p.y * H - sy) / bh * CH;
  for (const [ctx, ring] of [[mi, INNER], [mo, OUTER]] as [CanvasRenderingContext2D, number[]][]) {
    ctx.clearRect(0, 0, CW, CH); ctx.fillStyle = "#fff"; ctx.beginPath(); ring.forEach((i, k) => { const x = mapx(P[i]), y = mapy(P[i]); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath(); ctx.fill();
  }
  const ai = mi.getImageData(0, 0, CW, CH).data, ao = mo.getImageData(0, 0, CW, CH).data, lipY = mapy(P[17]) - 1, midY = mapy(P[13]);
  // skin reference: how red the skin below the mouth is
  const ref: number[] = [];
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) { const i = (y * CW + x) * 4; if (y > midY && ao[i + 3] < 40 && px[i + 3] > 200) ref.push(px[i] - px[i + 1]); }
  if (ref.length < 40) return null;
  const skin = median(ref); let A = 0, Ax = 0, Aout = 0;
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
    const i = (y * CW + x) * 4, r = px[i], g = px[i + 1], b = px[i + 2]; if (px[i + 3] < 200 || r < 80) continue;
    let s = 0;
    if (ai[i + 3] > 128) { if ((r + g + b) / 3 > 55) s = clamp(((r - g) - 30) / 45, 0, 1); }          // inside the open mouth
    else if (ao[i + 3] < 40 && y > lipY) { s = clamp(((r - g) - skin - 20) / 35, 0, 1); Aout += s; }   // below the lower lip, outside the lip ring
    if (s > 0) { A += s; Ax += s * x; }
  }
  const n = CW * CH, conf = clamp(A / (n * 0.012), 0, 1), cxn = A > 0.5 ? Ax / A / CW - 0.5 : 0;
  return { shift: cxn * (bw / iod) * conf, area: A / n, out: Aout / n };
}
