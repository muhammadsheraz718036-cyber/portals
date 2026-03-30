import { createContext } from "react";

interface CompanySettings {
  id: string;
  company_name: string;
  logo_url: string | null;
}

export interface CompanyContextType {
  settings: CompanySettings | null;
  loading: boolean;
  refetch: () => Promise<void>;
}

export const CompanyContext = createContext<CompanyContextType | undefined>(undefined);
