import {
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import {
  api,
  type AuthUser,
  type Profile,
  getStoredToken,
  setStoredToken,
} from "@/lib/api";
import { AuthContext, type AuthContextType } from "./auth-context";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setUser(null);
      setProfile(null);
      setLoading(false);
      return;
    }
    try {
      const { user: u, profile: p } = await api.auth.me();
      setUser(u);
      setProfile(p);
    } catch {
      setStoredToken(null);
      setUser(null);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const signIn = async (email: string, password: string) => {
    try {
      const {
        token,
        user: u,
        profile: p,
      } = await api.auth.login({ email, password });
      setStoredToken(token);
      setUser(u);
      setProfile(p);
      return { error: null };
    } catch (e) {
      return { error: e instanceof Error ? e : new Error(String(e)) };
    }
  };

  const signOut = async () => {
    setStoredToken(null);
    setUser(null);
    setProfile(null);
  };

  const hasPermission = (permission: string): boolean => {
    if (profile?.is_admin) return true;
    return profile?.permissions?.includes(permission) ?? false;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        signIn,
        signOut,
        isAdmin: profile?.is_admin ?? false,
        hasPermission,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

