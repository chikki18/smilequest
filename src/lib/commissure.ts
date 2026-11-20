// Anterior (oral) commissure measurement: how far each mouth corner travels during a smile.
// Coordinates come from tracking.ts: roll-corrected, in units of outer-eye distance, origin at the midpoint between the outer eye corners.
export type AC = { lx: number; ly: number; rx: number; ry: number };   // l = person's left corner, r = right corner
export type Side = { up: number; out: number; total: number };          // millimetres (estimated)
export type AcResult = { n: number; left: Side; right: Side; symmetry: number | null; baseline: "calibration" | "in-game"; mmPerUnit: number };
export const MM_PER_UNIT = 90; // typical adult outer-canthal distance; makes the mm figures estimates, not clinical measurements
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r1 = (x: number) => Math.round(x * 10) / 10;
export function meanAC(a: AC[]): AC | null { if (a.length < 10) return null; return { lx: med(a.map(x => x.lx)), ly: med(a.map(x => x.ly)), rx: med(a.map(x => x.rx)), ry: med(a.map(x => x.ry)) }; }

export class AcRecorder {
  private rest: AC[] = []; private smile: AC[] = [];
  constructor(private saved: AC | null) {}
  addRest(a: AC) { this.rest.push(a); if (this.rest.length > 300) this.rest.shift(); }
  addSmile(a: AC) { if (this.smile.length < 4000) this.smile.push(a); }
  result(): AcResult | null {
    const base = this.saved ?? meanAC(this.rest); if (!base || this.smile.length < 15) return null;
    const side = (get: (a: AC) => { up: number; out: number }): Side => {
      const v = this.smile.map(a => { const e = get(a); return { ...e, t: Math.hypot(e.up, e.out) }; }).sort((x, y) => y.t - x.t).slice(0, Math.max(5, Math.floor(this.smile.length * .15)));
      const m = (k: "up" | "out" | "t") => v.reduce((s, x) => s + x[k], 0) / v.length * MM_PER_UNIT;
      return { up: r1(m("up")), out: r1(m("out")), total: r1(m("t")) };
    };
    const left = side(a => ({ up: base.ly - a.ly, out: a.lx - base.lx })), right = side(a => ({ up: base.ry - a.ry, out: -(a.rx - base.rx) }));
    const hi = Math.max(left.total, right.total), lo = Math.min(left.total, right.total);
    return { n: this.smile.length, left, right, symmetry: hi > 0.5 ? Math.round(lo / hi * 100) : null, baseline: this.saved ? "calibration" : "in-game", mmPerUnit: MM_PER_UNIT };
  }
}
export function acFromSaved(s: any): AC | null { return s && typeof s.lx === "number" && typeof s.rx === "number" ? s : null; }
