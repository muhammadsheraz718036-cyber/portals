import { useEffect, useState, useCallback } from "react";
import { services } from "@/services";
import { CompanyContext, type CompanyContextType } from "./company-context";

interface CompanySettings {
  id: string;
  company_name: string;
  logo_url: string | null;
}

export function CompanyProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSettings = useCallback(async () => {
    try {
      const data = await services.company.get();
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

