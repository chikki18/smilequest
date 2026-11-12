import { supabase } from "@/lib/supabase/client";

export const MOVEMENTS = [
  { k: "smile", label: "Gentle smile" }, { k: "brow", label: "Gentle eyebrow raise" },
  { k: "pucker", label: "Soft lip pucker" }, { k: "close", label: "Gentle eye closure" },
] as const;
export const moveLabel = (k: string) => MOVEMENTS.find(m => m.k === k)?.label ?? k;
export const GAME_NAMES: Record<string, string> = { spellbook: "The Magical Expression Spellbook", canvas: "Living Portrait & Canvas", mirror_flight: "Mirror Flight" };

// Custom check-in questions. NOT a validated PROM. `higher` records what a higher number means for each one.
export const QUESTIONS = [
  { key: "control_difficulty", text: "How difficult is it to control your facial movements today?", lo: "Not difficult", hi: "Very difficult", higher: "more_difficulty", short: "Movement difficulty" },
  { key: "tightness_discomfort", text: "How much facial tightness or discomfort are you experiencing today?", lo: "None", hi: "A lot", higher: "more_discomfort", short: "Tightness or discomfort" },
  { key: "unwanted_movement", text: "How much are unwanted facial movements bothering you today?", lo: "Not at all", hi: "Very much", higher: "more_bother", short: "Unwanted movements" },
  { key: "satisfaction", text: "How satisfied are you with your facial function today?", lo: "Not satisfied", hi: "Very satisfied", higher: "more_satisfaction", short: "Satisfaction" },
  { key: "confidence", text: "How confident do you feel performing your facial exercises today?", lo: "Not confident", hi: "Very confident", higher: "more_confidence", short: "Confidence" },
] as const;

export type Plan = {
  id: string; source: "self" | "clinician"; version: number; goals: string[]; authorized_movements: string[];
  avoid_text: string | null; restrictions: string | null; notes: string | null;
  clinician_name: string | null; clinician_role: string | null; clinician_instructions: string | null;
  clinician_review_status: string; patient_attested_at: string | null;
  sessions_per_week: number | null; session_minutes: number | null; repetitions: number | null; hold_seconds: number | null; rest_seconds: number | null;
  start_date: string | null; updated_at: string;
};
export type Sess = { id: string; mode: "exercise" | "explore"; started_at: string; plan_id: string | null };

export async function loadPlan(): Promise<Plan | null> {
  const { data } = await supabase().from("rehab_plans").select("*").eq("is_active", true).maybeSingle();
  return (data as Plan | null) ?? null;
}
// Exercises are only offered when the patient has confirmed their clinician approved the selected movements.
export const exerciseReady = (p: Plan | null) => !!p && !!p.patient_attested_at && p.authorized_movements.length > 0;

// The session the games run inside. A checked-in session is resumed (no repeat questions) for up to 6 hours.
export async function loadContext() {
  const plan = await loadPlan();
  const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const { data } = await supabase().from("sessions").select("id,mode,started_at,plan_id").eq("status", "active")
    .not("checkin_completed_at", "is", null).gte("started_at", since).order("started_at", { ascending: false }).limit(1).maybeSingle();
  const session = (data as Sess | null) ?? null;
  // null = free play (all movements); [] = nothing allowed
  const allowed: string[] | null = !session ? [] : session.mode === "explore" ? null : (plan?.authorized_movements ?? []);
  return { plan, session, allowed };
}

export async function endSession(id: string, game: string, seconds: number, summary: Record<string, unknown>) {
  const { error } = await supabase().from("sessions").update({ status: "completed", ended_at: new Date().toISOString(), game, duration_seconds: Math.round(seconds), summary }).eq("id", id);
  return !error;
}
