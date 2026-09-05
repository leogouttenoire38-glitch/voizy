import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { Session } from "@supabase/supabase-js";
import type { UserRow } from "../types";

type AuthStatus = "loading" | "ready";

interface AuthState {
  status: AuthStatus;
  session: Session | null;
  profile: UserRow | null;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  status: "loading",
  session: null,
  profile: null,
  refreshProfile: async () => {},
});

async function fetchProfile(userId: string): Promise<UserRow | null> {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return data as UserRow;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserRow | null>(null);

  const refreshProfile = async () => {
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user.id;
    if (!uid) {
      setProfile(null);
      return;
    }
    const p = await fetchProfile(uid);
    setProfile(p);
  };

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session) setProfile(await fetchProfile(data.session.user.id));
      setStatus("ready");
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession);
      if (newSession) {
        const p = await fetchProfile(newSession.user.id);
        setProfile(p);
        // Le trigger handle_new_user crée le profil ; si on arrive ici trop tôt,
        // on rafraîchit une fois.
        if (!p) {
          setTimeout(async () => setProfile(await fetchProfile(newSession.user.id)), 1500);
        }
      } else {
        setProfile(null);
      }
      setStatus("ready");
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ status, session, profile, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}