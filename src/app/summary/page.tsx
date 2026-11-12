"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { GAME_NAMES, QUESTIONS } from "@/lib/workflow";

type S = { id: string; mode: string; status: string; started_at: string; ended_at: string | null; game: string | null; duration_seconds: number | null; discomfort_reported: boolean; summary: Record<string, any> | null };
type Resp = { question_key: string; value: number };
const fmt = (s: number) => `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;

export default function Summary() {
  const [s, setS] = useState<S | null>(null), [r, setR] = useState<Resp[]>([]), [state, setState] = useState<"loading" | "none" | "ok">("loading");
  useEffect(() => { (async () => {
    const sb = supabase(); const { data: { user } } = await sb.auth.getUser(); if (!user) { location.href = "/"; return; }
    const id = new URLSearchParams(location.search).get("id");
    let q = sb.from("sessions").select("*").in("status", ["completed", "abandoned"]).order("ended_at", { ascending: false }).limit(1);
    if (id) q = sb.from("sessions").select("*").eq("id", id).limit(1);
    const { data } = await q; const row = (data?.[0] as S | undefined);
    if (!row) { setState("none"); return; }
    const { data: rs } = await sb.from("checkin_responses").select("question_key,value").eq("session_id", row.id);
    setS(row); setR((rs as Resp[]) ?? []); setState("ok");
  })(); }, []);
  if (state === "loading") return <main className="grid min-h-dvh place-items-center text-navy/60">Loading…</main>;
  if (state === "none" || !s) return (<main className="mx-auto max-w-md px-6 pt-24"><h1 className="font-display text-3xl">No finished sessions yet.</h1><a href="/dashboard" className="btn-primary mt-8 inline-flex w-full items-center justify-center">Back to dashboard</a></main>);
  const m = s.summary ?? {}, exercise = s.mode === "exercise";
  const moves: string[] = m.movements ?? [];
  const lines: string[] = [];
  if (s.status === "abandoned") lines.push("You chose to rest today. That’s a good decision.");
  else if ((m.holds ?? 0) > 0) lines.push(`You completed ${m.holds} comfortable hold${m.holds === 1 ? "" : "s"} today.`);
  else lines.push("You took part in today’s session. Showing up counts.");
  if ((m.longest ?? 0) > 0) lines.push(`Your longest comfortable hold was ${Number(m.longest).toFixed(1)} seconds.`);
  if (m.artworks_saved) lines.push(`You saved ${m.artworks_saved} artwork${m.artworks_saved === 1 ? "" : "s"} to your gallery.`);
  const rows: [string, string][] = [
    ["Date", new Date(s.started_at).toLocaleString()], ["Game", s.game ? GAME_NAMES[s.game] : "None"],
    ["Session type", exercise ? "Exercise session" : "Free play (not counted as exercise)"],
    ["Duration", s.duration_seconds ? fmt(s.duration_seconds) : "n/a"],
    ["Movements used", moves.length ? moves.join(", ") : "n/a"],
    ["Comfortable holds", m.holds != null ? String(m.holds) : "n/a"],
    ["Rest breaks", m.rests != null ? String(m.rests) : "n/a"],
    ["Reported discomfort", s.discomfort_reported ? "Yes, high at check-in" : "No"],
    ["Tracking", m.tracking_adjustments == null ? "n/a" : m.tracking_adjustments === 0 ? "Clear throughout" : `Camera adjustments needed: ${m.tracking_adjustments}`],
  ];
  return (
    <main className="mx-auto max-w-md px-6 pb-16 pt-[max(2rem,env(safe-area-inset-top))]">
      <h1 className="font-display text-3xl">Session summary</h1>
      <div className="mt-4 rounded-3xl bg-sage/30 p-5">{lines.map(l => <p key={l} className="text-navy/90">{l}</p>)}</div>
      <dl className="mt-5 grid gap-2 rounded-3xl bg-paper p-5 text-sm shadow-soft">{rows.map(([k, v]) => <div key={k} className="flex justify-between gap-4"><dt className="text-navy/60">{k}</dt><dd className="text-right">{v}</dd></div>)}</dl>
      {r.length > 0 && <section className="mt-5 rounded-3xl bg-paper p-5 text-sm shadow-soft"><h2 className="font-display text-lg">Daily check-in</h2>
        <ul className="mt-2 grid gap-1">{QUESTIONS.map(q => { const x = r.find(y => y.question_key === q.key); return <li key={q.key} className="flex justify-between"><span className="text-navy/60">{q.short}</span><span>{x ? `${x.value} / 10` : "n/a"}</span></li>; })}</ul>
        <p className="mt-2 text-xs text-navy/50">Higher isn’t always better: 10 means a lot of difficulty, discomfort, or bother, but a lot of satisfaction or confidence.</p></section>}
      <p className="mt-4 text-xs text-navy/50">Movement numbers are camera-derived estimates of game engagement. They aren’t clinical measurements of nerve recovery or muscle function.</p>
      <a href="/dashboard" className="btn-primary mt-6 inline-flex w-full items-center justify-center">Back to dashboard</a>
      <a href="/history" className="btn-quiet mt-3 inline-flex w-full items-center justify-center">See all sessions</a>
    </main>);
}
