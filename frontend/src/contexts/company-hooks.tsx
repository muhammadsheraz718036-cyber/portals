import { useContext } from "react";
import { CompanyContext, type CompanyContextType } from "./company-context";

export function useCompany(): CompanyContextType {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error("useCompany must be used within CompanyProvider");
  return ctx;
}
