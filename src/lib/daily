import { supabase } from "@/lib/supabase/client";
export const VIDEO_CONSENT_VERSION = "2026-11";
// True when the patient should do their daily recalibration before playing.
// Returns false (no gate) if the settings table isn't set up yet, so nobody gets locked out.
export async function dailyDue(): Promise<boolean> {
  try {
    const sb = supabase(); const { data: { user } } = await sb.auth.getUser(); if (!user) return false;
    const s = await sb.from("recal_settings").select("daily").maybeSingle();
    if (s.error) return false;
    if ((s.data as any) && (s.data as any).daily === false) return false;
    const { data, error } = await sb.from("calibration_profiles").select("created_at,summary").order("created_at", { ascending: false }).limit(15);
    if (error) return false;
    const full = ((data as any[]) ?? []).find(r => r.summary?.full === true);
    if (!full) return true;
    return new Date(full.created_at).toDateString() !== new Date().toDateString();
  } catch { return false; }
}
export const dailyUrl = (next: string) => "/calibrate?daily=1&next=" + encodeURIComponent(next);
