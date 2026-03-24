import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";

interface CompanySettings {
  id: string;
  company_name: string;
  logo_url: string | null;
}

interface CompanyContextType {
  settings: CompanySettings | null;
  loading: boolean;
  refetch: () => Promise<void>;
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined);

export function CompanyProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSettings = useCallback(async () => {
    try {
      const data = await api.companySettings.get();
      if (!data) {
        setSettings(null);
        return;
      }
      setSettings({
        id: data.id,
        company_name: data.company_name,
        logo_url: data.logo_url,
      });
    } catch {
      setSettings(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  return (
    <CompanyContext.Provider value={{ settings, loading, refetch: fetchSettings }}>
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error("useCompany must be used within CompanyProvider");
  return ctx;
}
