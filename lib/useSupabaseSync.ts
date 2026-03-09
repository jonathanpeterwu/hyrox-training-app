"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { createClient, isSupabaseConfigured } from "./supabase";
import type { User } from "@supabase/supabase-js";

const SYNC_DEBOUNCE_MS = 1500;

const SYNC_KEYS = [
  "hyrox-settings",
  "hyrox-workout-log",
  "hyrox-workout-overrides",
  "hyrox-progression-overrides",
  "hyrox-day-messages",
  "hyrox-plan-messages",
] as const;

type SyncKey = (typeof SYNC_KEYS)[number];

interface UserData {
  settings: string | null;
  workout_log: string | null;
  workout_overrides: string | null;
  progression_overrides: string | null;
  day_messages: string | null;
  plan_messages: string | null;
  updated_at: string;
}

const KEY_TO_COLUMN: Record<SyncKey, keyof UserData> = {
  "hyrox-settings": "settings",
  "hyrox-workout-log": "workout_log",
  "hyrox-workout-overrides": "workout_overrides",
  "hyrox-progression-overrides": "progression_overrides",
  "hyrox-day-messages": "day_messages",
  "hyrox-plan-messages": "plan_messages",
};

export function useSupabaseSync() {
  const clientRef = useRef(createClient());
  const [user, setUser] = useState<User | null>(null);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "synced" | "error">("idle");
  const [authLoading, setAuthLoading] = useState(isSupabaseConfigured);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSyncing = useRef(false);
  const configured = isSupabaseConfigured;

  // Auth state listener
  useEffect(() => {
    const supabase = clientRef.current;
    if (!supabase) { setAuthLoading(false); return; }

    supabase.auth.getUser().then(({ data: { user: u } }) => {
      setUser(u);
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Pull from Supabase on login
  useEffect(() => {
    if (!user || !clientRef.current) return;
    pullFromSupabase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function pullFromSupabase() {
    const supabase = clientRef.current;
    if (!user || !supabase) return;
    setSyncStatus("syncing");
    try {
      const { data, error } = await supabase
        .from("user_data")
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (error && error.code !== "PGRST116") {
        console.error("Supabase pull error:", error);
        setSyncStatus("error");
        return;
      }

      if (data) {
        for (const key of SYNC_KEYS) {
          const col = KEY_TO_COLUMN[key];
          const serverVal = data[col] as string | null;
          if (serverVal) {
            localStorage.setItem(key, typeof serverVal === "string" ? serverVal : JSON.stringify(serverVal));
          }
        }
        setSyncStatus("synced");
        window.dispatchEvent(new Event("supabase-sync-pull"));
      } else {
        await pushToSupabase();
      }
    } catch (e) {
      console.error("Supabase pull failed:", e);
      setSyncStatus("error");
    }
  }

  async function pushToSupabase() {
    const supabase = clientRef.current;
    if (!user || !supabase || isSyncing.current) return;
    isSyncing.current = true;
    setSyncStatus("syncing");
    try {
      const row: Record<string, unknown> = { user_id: user.id };
      for (const key of SYNC_KEYS) {
        const col = KEY_TO_COLUMN[key];
        const raw = localStorage.getItem(key);
        try { row[col] = raw ? JSON.parse(raw) : null; } catch { row[col] = raw; }
      }
      row.updated_at = new Date().toISOString();

      const { error } = await supabase.from("user_data").upsert(row, {
        onConflict: "user_id",
      });

      if (error) {
        console.error("Supabase push error:", error);
        setSyncStatus("error");
      } else {
        setSyncStatus("synced");
      }
    } catch (e) {
      console.error("Supabase push failed:", e);
      setSyncStatus("error");
    } finally {
      isSyncing.current = false;
    }
  }

  const schedulePush = useCallback(() => {
    if (!user || !clientRef.current) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => pushToSupabase(), SYNC_DEBOUNCE_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function signInWithGoogle() {
    const supabase = clientRef.current;
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  async function signInWithGithub() {
    const supabase = clientRef.current;
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  async function signInWithEmail(email: string) {
    const supabase = clientRef.current;
    if (!supabase) return { error: { message: "Not configured" } };
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    return { error };
  }

  async function signOut() {
    const supabase = clientRef.current;
    if (!supabase) return;
    await supabase.auth.signOut();
    setUser(null);
    setSyncStatus("idle");
  }

  return {
    user,
    authLoading,
    syncStatus,
    isConfigured: configured,
    signInWithGoogle,
    signInWithGithub,
    signInWithEmail,
    signOut,
    schedulePush,
    pullFromSupabase,
  };
}
