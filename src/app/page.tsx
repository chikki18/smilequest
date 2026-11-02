"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { supabase } from "@/lib/supabase/client";
import { POLICY_VERSION } from "@/lib/onboarding";

type Mode = "welcome" | "login" | "signup" | "reset";
export default function Welcome() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("welcome");
  const [email, setEmail] = useState(""); const [pw, setPw] = useState("");
  const [agree, setAgree] = useState(false);
  const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    const sb = supabase();
    if (mode === "reset") {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/dashboard` });
      setMsg(error ? error.message : "Check your email for a reset link."); setBusy(false); return;
    }
    if (mode === "login") {
      const { error } = await sb.auth.signInWithPassword({ email, password: pw });
      if (error) { setMsg(error.message); setBusy(false); return; }
      const { data: p } = await sb.from("profiles").select("onboarding_completed_at").maybeSingle();
      router.push(p?.onboarding_completed_at ? "/dashboard" : "/onboarding"); return;
    }
    const { data, error } = await sb.auth.signUp({ email, password: pw });
    if (error) { setMsg(error.message); setBusy(false); return; }
    if (!data.session) { setMsg("Confirm your email, then log in to continue."); setBusy(false); return; }
    router.push("/onboarding");
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-between px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(3rem,env(safe-area-inset-top))]">
      <div>
        <div className="flex items-center gap-3" aria-label="SmileQuest">
          <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden><circle cx="20" cy="20" r="19" fill="#E8E2D4"/><path d="M9 21c3 8 19 8 22 0" stroke="#4E8A86" strokeWidth="3" strokeLinecap="round" fill="none"/><circle cx="14" cy="15" r="2" fill="#1B2A3A"/><circle cx="26" cy="15" r="2" fill="#C9A24D"/></svg>
          <span className="font-display text-2xl">SmileQuest</span>
        </div>
        <motion.h1 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7 }}
          className="mt-16 font-display text-[2.6rem] leading-[1.08] tracking-tight">
          Your recovery, one expression at a time.
        </motion.h1>
        <p className="mt-5 max-w-sm leading-relaxed text-navy/70">
          Interactive, personalized facial exercise support. Your camera is only used during exercises, and it is processed on your device.
        </p>
      </div>

      <div className="mt-12">
        {mode === "welcome" ? (
          <div className="grid gap-3">
            <button className="btn-primary" onClick={() => setMode("signup")}>Create account</button>
            <button className="btn-quiet" onClick={() => setMode("login")}>Log in</button>
          </div>
        ) : (
          <form onSubmit={submit} className="grid gap-3">
            <label className="sr-only" htmlFor="email">Email</label>
            <input id="email" className="field" type="email" placeholder="Email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
            {mode !== "reset" && <>
              <label className="sr-only" htmlFor="pw">Password</label>
              <input id="pw" className="field" type="password" placeholder="Password (8+ characters)" minLength={8} required autoComplete={mode === "signup" ? "new-password" : "current-password"} value={pw} onChange={e => setPw(e.target.value)} />
            </>}
            {mode === "signup" && (
              <label className="flex items-start gap-3 text-sm text-navy/70">
                <input type="checkbox" className="mt-1 h-5 w-5 accent-teal" checked={agree} onChange={e => setAgree(e.target.checked)} />
                <span>I agree to the Terms and Privacy Policy. Camera tracking is processed on my device and raw video is not stored. I will be asked for camera consent separately.</span>
              </label>
            )}
            {msg && <p role="alert" className="text-sm text-navy/80">{msg}</p>}
            <button className="btn-primary" disabled={busy || (mode === "signup" && !agree)}>
              {mode === "login" ? "Log in" : mode === "signup" ? "Create account" : "Send reset link"}
            </button>
            <div className="flex justify-between text-sm text-navy/70">
              <button type="button" onClick={() => setMode("welcome")}>Back</button>
              {mode === "login" && <button type="button" onClick={() => setMode("reset")}>Forgot password?</button>}
            </div>
          </form>
        )}
        <p className="mt-6 text-xs leading-relaxed text-navy/50">SmileQuest supports rehabilitation exercises. It does not diagnose or replace your clinician’s care.</p>
      </div>
      <input type="hidden" value={POLICY_VERSION} readOnly />
    </main>
  );
}
