import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { useCompany } from "@/contexts/company-hooks";
import { useAuth } from "@/contexts/auth-hooks";
import { toast } from "sonner";
import { Building2, Loader2 } from "lucide-react";

export function AdminSettings() {
  const { settings, refetch } = useCompany();
  const { isAdmin } = useAuth();
  const [companyName, setCompanyName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings) {
      setCompanyName(settings.company_name);
      setLogoUrl(settings.logo_url || "");
    }
  }, [settings]);

  const handleSaveCompany = async () => {
    if (!companyName.trim()) {
      toast.error("Company name is required");
      return;
    }
    setSaving(true);
    try {
      await api.companySettings.update({
        company_name: companyName.trim(),
        logo_url: logoUrl.trim() || null,
      });
      toast.success("Company settings saved");
      await refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
    setSaving(false);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <Card className="border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4" /> Company Branding
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Company Name</Label>
            <Input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Your Company Name"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Logo URL</Label>
            <Input
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://example.com/logo.png"
            />
            <p className="text-xs text-muted-foreground">
              Enter a URL to your company logo. It will appear in the sidebar
              and printed letters.
            </p>
          </div>
          {logoUrl && (
            <div className="border rounded p-4 flex items-center justify-center bg-muted/30">
              <img
                src={logoUrl}
                alt="Company Logo Preview"
                className="max-h-16 max-w-[200px] object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            </div>
          )}
          <Button
            onClick={handleSaveCompany}
            disabled={saving}
            className="gap-2"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save Company Settings
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
