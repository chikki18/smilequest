"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Home, Activity, History, User } from "lucide-react";
import { supabase } from "@/lib/supabase/client";

export default function Dashboard() {
  const router = useRouter();
  const [goals, setGoals] = useState<string[]>([]);
  const [ok, setOk] = useState(false);
  useEffect(() => { (async () => {
    const sb = supabase();
    const { data: p } = await sb.from("profiles").select("onboarding_completed_at").maybeSingle();
    if (!p?.onboarding_completed_at) return router.replace("/onboarding");
    const { data } = await sb.from("rehab_goals").select("goal");
    setGoals((data ?? []).map(g => g.goal)); setOk(true);
  })(); }, [router]);
  if (!ok) return <main className="grid min-h-dvh place-items-center text-navy/60">Loading…</main>;
  return (
    <main className="mx-auto max-w-md px-6 pb-28 pt-[max(2.5rem,env(safe-area-inset-top))]">
      <h1 className="font-display text-3xl">Welcome back.</h1>
      <section className="mt-8 rounded-3xl bg-paper p-6 shadow-soft">
        <h2 className="font-display text-xl">Your goals</h2>
        <ul className="mt-3 grid gap-2 text-navy/80">{goals.map(g => <li key={g}>{g}</li>)}</ul>
      </section>
      <section className="mt-4 rounded-3xl bg-lav/40 p-6">
        <h2 className="font-display text-xl">Set up your plan</h2>
        <p className="mt-2 text-navy/70">Exercises unlock after you create a plan and confirm your clinician has approved the movements. Coming in Milestone 3.</p>
      </section>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 border-t border-navy/10 bg-ivory/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <ul className="mx-auto flex max-w-md justify-around">
          {[[Home, "Home"], [Activity, "Progress"], [History, "History"], [User, "Profile"]].map(([Icon, l]: any) =>
            <li key={l}><button className="flex min-h-[56px] min-w-[64px] flex-col items-center justify-center gap-0.5 text-xs text-navy/70"><Icon size={22} aria-hidden />{l}</button></li>)}
        </ul>
      </nav>
    </main>
  );
}
