"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

type Art = { id: string; mode: string; title: string; created_at: string; image_data: string };
export default function Gallery() {
  const [items, setItems] = useState<Art[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { (async () => {
    const { data, error } = await supabase().from("saved_artwork").select("id,mode,title,created_at,image_data").order("created_at", { ascending: false });
    if (error) setMsg(error.message); setItems((data as Art[]) ?? []);
  })(); }, []);
  async function del(id: string) {
    const { error } = await supabase().from("saved_artwork").delete().eq("id", id);
    if (error) setMsg(error.message); else setItems(x => (x ?? []).filter(a => a.id !== id));
  }
  return (
    <main className="mx-auto max-w-md px-6 pb-16 pt-[max(2rem,env(safe-area-inset-top))]">
      <h1 className="font-display text-3xl">Your gallery</h1>
      <p className="mt-2 text-sm text-navy/70">Artwork is saved only when you choose to save it.</p>
      {msg && <p role="alert" className="mt-4 rounded-2xl bg-lav/40 p-3 text-sm">{msg}</p>}
      {items === null && <p className="mt-8 text-navy/60">Loading…</p>}
      {items?.length === 0 && <p className="mt-8 text-navy/70">Nothing here yet. Create something in the studio and tap “Save to gallery”.</p>}
      <div className="mt-6 grid gap-5">{items?.map(a => (
        <figure key={a.id} className="rounded-3xl bg-paper p-3 shadow-soft">
          <img src={a.image_data} alt={a.title} className="w-full rounded-2xl" />
          <figcaption className="mt-2 flex items-center justify-between text-sm">
            <span>{a.title}<br /><span className="text-xs text-navy/50">{new Date(a.created_at).toLocaleString()}</span></span>
            <button className="btn-quiet min-h-[44px] px-4" onClick={() => del(a.id)}>Delete</button></figcaption>
        </figure>))}</div>
      <a href="/canvas" className="btn-primary mt-8 inline-flex w-full items-center justify-center">Back to the studio</a>
    </main>
  );
}
