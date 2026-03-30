import { createContext } from "react";
import { type AuthUser, type Profile } from "@/lib/api";

export interface AuthContextType {
  user: AuthUser | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  isAdmin: boolean;
  hasPermission: (permission: string) => boolean;
  refreshSession: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);
