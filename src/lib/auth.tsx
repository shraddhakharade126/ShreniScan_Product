import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type VerificationStatus = "pending" | "verified" | "failed" | "skipped";

export type Profile = {
  id: string;
  full_name: string;
  mobile: string;
  email: string | null;
  preferred_language: string;
  artisan_name: string | null;
  craft_category: string | null;
  experience_years: number | null;
  village: string | null;
  district: string | null;
  state: string | null;
  profile_complete: boolean;
  verification_status: VerificationStatus;
  verification_method: string | null;
  verified_at: string | null;
};

type AuthCtx = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
  signInAsDemo: () => void;
};

export const DEMO_PROFILE: Profile = {
  id: "demo-artisan-sunita",
  full_name: "Sunita Devi",
  mobile: "9876543210",
  email: "sunita@artisan.craftlink.app",
  preferred_language: "hi",
  artisan_name: "Sunita Handicrafts",
  craft_category: "Terracotta & Pottery",
  experience_years: 18,
  village: "Kumhar Gram",
  district: "Varanasi",
  state: "Uttar Pradesh",
  profile_complete: true,
  verification_status: "verified",
  verification_method: "Aadhaar e-KYC Demo",
  verified_at: "2025-01-15T10:00:00Z",
};

export const DEMO_SESSION: Session = {
  access_token: "demo-access-token",
  token_type: "bearer",
  expires_in: 360000,
  expires_at: Math.floor(Date.now() / 1000) + 360000,
  refresh_token: "demo-refresh-token",
  user: {
    id: "demo-artisan-sunita",
    app_metadata: {},
    user_metadata: { full_name: "Sunita Devi" },
    aud: "authenticated",
    created_at: "2025-01-15T10:00:00Z",
  },
};

const AuthContext = createContext<AuthCtx>({
  session: null,
  profile: null,
  loading: true,
  refreshProfile: async () => {},
  signOut: async () => {},
  signInAsDemo: () => {},
});

/** Mobile numbers are turned into a stable internal account address.
 *  No SMS/identity data is stored anywhere in the app. */
export function mobileToAccountEmail(mobile: string) {
  return `${normalizeMobile(mobile)}@artisan.craftlink.app`;
}

export function normalizeMobile(mobile: string) {
  return mobile.replace(/\D/g, "").slice(-10);
}

export function isValidMobile(mobile: string) {
  return /^[6-9]\d{9}$/.test(normalizeMobile(mobile));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(userId: string) {
    if (userId === DEMO_PROFILE.id) {
      setProfile(DEMO_PROFILE);
      return;
    }
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    setProfile((data as Profile | null) ?? null);
  }

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (next?.user) {
        setTimeout(() => void loadProfile(next.user.id), 0);
      } else {
        setProfile(null);
      }
    });

    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setSession(data.session);
        if (data.session?.user) await loadProfile(data.session.user.id);
      } else {
        // Check if demo session was active
        const hasDemo = localStorage.getItem("kalakart_demo_active");
        if (hasDemo !== "false") {
          // Default to demo session for smooth preview exploration
          setSession(DEMO_SESSION);
          setProfile(DEMO_PROFILE);
        }
      }
      setLoading(false);
    })();

    return () => sub.subscription.unsubscribe();
  }, []);

  const signInAsDemo = () => {
    localStorage.setItem("kalakart_demo_active", "true");
    setSession(DEMO_SESSION);
    setProfile(DEMO_PROFILE);
  };

  const value = useMemo<AuthCtx>(
    () => ({
      session,
      profile,
      loading,
      signInAsDemo,
      refreshProfile: async () => {
        if (session?.user) await loadProfile(session.user.id);
      },
      signOut: async () => {
        localStorage.setItem("kalakart_demo_active", "false");
        await supabase.auth.signOut();
        setProfile(null);
        setSession(null);
      },
    }),
    [session, profile, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
