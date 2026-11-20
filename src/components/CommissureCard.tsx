import type { AcResult } from "@/lib/commissure";

const fmt = (x: number) => x.toFixed(1);

export function CommissureCard({ ac }: { ac: AcResult | null | undefined }) {
  return (
    <section className="mt-5 rounded-3xl bg-paper p-5 shadow-soft" aria-label="Anterior commissure measurement">
      <h2 className="font-display text-xl">Anterior commissure</h2>
      <p className="text-xs text-navy/60">How far each mouth corner moved when you smiled.</p>
      {!ac ? <p className="mt-4 text-sm text-navy/70">No smile was measured this time. Smile during play, and recalibrate if this keeps happening.</p> : <>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {([["Left corner", ac.left], ["Right corner", ac.right]] as const).map(([name, s]) => (
            <div key={name} className="rounded-2xl bg-mist/60 p-4 text-center">
              <div className="font-display text-3xl">{fmt(s.total)}<span className="ml-1 text-base text-navy/60">mm</span></div>
              <div className="text-sm">{name}</div>
              <div className="mt-1 text-xs text-navy/60">up {fmt(s.up)} · out {fmt(s.out)}</div>
            </div>))}
        </div>
        <div className="mt-4">
          <div className="flex justify-between text-sm"><span>Symmetry</span><b>{ac.symmetry == null ? "–" : `${ac.symmetry}%`}</b></div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-mist" role="img" aria-label={ac.symmetry == null ? "Symmetry not available" : `Symmetry ${ac.symmetry} percent`}><div className="h-full rounded-full bg-teal" style={{ width: `${ac.symmetry ?? 0}%` }} /></div>
          <p className="mt-1 text-xs text-navy/60">Smaller side divided by larger side. 100% means both corners moved the same amount.</p>
        </div>
        <p className="mt-3 text-xs text-navy/50">Estimated from your camera (typical eye width of {ac.mmPerUnit} mm, resting position from {ac.baseline === "calibration" ? "your calibration" : "this game"}). Not a clinical measurement.</p>
      </>}
    </section>);
}

export function CommissureHistory({ rows }: { rows: { date: string; ac: AcResult }[] }) {
  if (!rows.length) return (
    <section className="mt-6 rounded-3xl bg-paper p-5 shadow-soft"><h2 className="font-display text-xl">Anterior commissure</h2><p className="mt-2 text-sm text-navy/70">No smile measurements yet. They appear here after a game where you smile.</p></section>);
  const last = rows.slice(0, 5), avg = (f: (a: AcResult) => number | null) => { const v = last.map(r => f(r.ac)).filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const aL = avg(a => a.left.total), aR = avg(a => a.right.total), aS = avg(a => a.symmetry);
  return (
    <section className="mt-6 rounded-3xl bg-paper p-5 shadow-soft"><h2 className="font-display text-xl">Anterior commissure</h2>
      <p className="text-xs text-navy/60">Main measurement. Mouth-corner movement when smiling, average of your last {last.length} game{last.length === 1 ? "" : "s"}.</p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-2xl bg-mist/60 p-3"><div className="font-display text-2xl">{aL == null ? "–" : aL.toFixed(1)}</div><div className="text-xs text-navy/60">Left mm</div></div>
        <div className="rounded-2xl bg-mist/60 p-3"><div className="font-display text-2xl">{aR == null ? "–" : aR.toFixed(1)}</div><div className="text-xs text-navy/60">Right mm</div></div>
        <div className="rounded-2xl bg-mist/60 p-3"><div className="font-display text-2xl">{aS == null ? "–" : `${Math.round(aS)}%`}</div><div className="text-xs text-navy/60">Symmetry</div></div>
      </div>
      <ul className="mt-4 grid gap-2 text-sm">{rows.slice(0, 8).map((r, i) => <li key={i} className="flex justify-between gap-3"><span>{r.date}</span><span className="text-right text-navy/70">L {r.ac.left.total.toFixed(1)} · R {r.ac.right.total.toFixed(1)} mm · {r.ac.symmetry == null ? "–" : `${r.ac.symmetry}%`}</span></li>)}</ul>
      <p className="mt-3 text-xs text-navy/50">Estimates from your camera, not clinical measurements.</p>
    </section>);
}
