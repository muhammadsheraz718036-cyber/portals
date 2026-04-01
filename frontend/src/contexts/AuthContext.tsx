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
import { useQueryClient } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/constants/query-keys";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

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
      
      // Invalidate all queries that depend on user data
      queryClient.invalidateQueries({ 
        queryKey: [QUERY_KEYS.APPROVAL_REQUESTS],
        refetchType: 'active'
      });
      queryClient.invalidateQueries({ 
        queryKey: [QUERY_KEYS.PROFILE_NAMES],
        refetchType: 'active'
      });
      // Also clear all queries to be safe
      queryClient.clear();
      
    } catch {
      setStoredToken(null);
      setUser(null);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [queryClient]);

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
      
      // Invalidate all queries when user signs in
      queryClient.invalidateQueries({ 
        queryKey: [QUERY_KEYS.APPROVAL_REQUESTS],
        refetchType: 'active'
      });
      queryClient.invalidateQueries({ 
        queryKey: [QUERY_KEYS.PROFILE_NAMES],
        refetchType: 'active'
      });
      // Also clear all queries to be safe
      queryClient.clear();
      
      return { error: null };
    } catch (e) {
      return { error: e instanceof Error ? e : new Error(String(e)) };
    }
  };

  const signOut = async () => {
    setStoredToken(null);
    setUser(null);
    setProfile(null);
    
    // Invalidate all queries when user signs out
    queryClient.invalidateQueries({ 
      queryKey: [QUERY_KEYS.APPROVAL_REQUESTS],
      refetchType: 'active'
    });
    queryClient.invalidateQueries({ 
      queryKey: [QUERY_KEYS.PROFILE_NAMES],
      refetchType: 'active'
    });
    // Also clear all queries to be safe
    queryClient.clear();
  };

  const hasPermission = (permission: string): boolean => {
    if (profile?.is_admin) return true;
    const permissions = profile?.permissions ?? [];
    if (permissions.includes("all")) return true;
    if (permissions.includes(permission)) return true;

    // Permission hierarchy for approval visibility scopes.
    if (permission === "view_own_requests") {
      return (
        permissions.includes("view_department_requests") ||
        permissions.includes("view_all_requests")
      );
    }
    if (permission === "view_department_requests") {
      return permissions.includes("view_all_requests");
    }

    return false;
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

