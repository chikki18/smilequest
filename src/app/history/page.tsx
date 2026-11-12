"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { GAME_NAMES, QUESTIONS } from "@/lib/workflow";

type S = { id: string; mode: string; status: string; started_at: string; game: string | null; duration_seconds: number | null };
type Resp = { session_id: string; question_key: string; value: number };
export default function History() {
  const [rows, setRows] = useState<S[] | null>(null), [resp, setResp] = useState<Resp[]>([]);
  useEffect(() => { (async () => {
    const sb = supabase(); const { data: { user } } = await sb.auth.getUser(); if (!user) { location.href = "/"; return; }
    const { data } = await sb.from("sessions").select("id,mode,status,started_at,game,duration_seconds").in("status", ["completed", "abandoned"]).order("started_at", { ascending: false }).limit(50);
    const list = (data as S[]) ?? []; setRows(list);
    if (list.length) { const { data: rs } = await sb.from("checkin_responses").select("session_id,question_key,value").in("session_id", list.map(x => x.id)); setResp((rs as Resp[]) ?? []); }
  })(); }, []);
  return (
    <main className="mx-auto max-w-md px-6 pb-28 pt-[max(2rem,env(safe-area-inset-top))]">
      <h1 className="font-display text-3xl">Session history</h1>
      {rows === null && <p className="mt-6 text-navy/60">Loading…</p>}
      {rows?.length === 0 && <p className="mt-6 text-navy/70">No finished sessions yet. Your first one will show up here.</p>}
      <div className="mt-5 grid gap-3">{rows?.map(s => (
        <details key={s.id} className="rounded-3xl bg-paper p-4 shadow-soft">
          <summary className="cursor-pointer list-none"><b>{new Date(s.started_at).toLocaleDateString()}</b> · {s.game ? GAME_NAMES[s.game] : s.status === "abandoned" ? "Rested" : "Session"}
            <br /><span className="text-xs text-navy/60">{s.mode === "explore" ? "Free play" : "Exercise"}{s.duration_seconds ? ` · ${Math.round(s.duration_seconds / 60)} min` : ""}</span></summary>
          <ul className="mt-3 grid gap-1 text-sm">{QUESTIONS.map(q => { const x = resp.find(y => y.session_id === s.id && y.question_key === q.key); return <li key={q.key} className="flex justify-between"><span className="text-navy/60">{q.short}</span><span>{x ? `${x.value} / 10` : "n/a"}</span></li>; })}</ul>
          <a href={`/summary?id=${s.id}`} className="btn-quiet mt-3 inline-flex min-h-[44px] w-full items-center justify-center">Open summary</a>
        </details>))}</div>
      <Nav />
    </main>);
}
function Nav() {
  return (<nav aria-label="Main" className="fixed inset-x-0 bottom-0 border-t border-navy/10 bg-ivory/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"><ul className="mx-auto flex max-w-md justify-around">
    {[["Home", "/dashboard"], ["Plan", "/plan"], ["History", "/history"], ["Camera", "/calibrate"]].map(([l, h]) => <li key={l}><a href={h} className="flex min-h-[56px] min-w-[72px] items-center justify-center text-sm text-navy/80">{l}</a></li>)}</ul></nav>);
}
