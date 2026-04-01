import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/contexts/company-hooks";
import { useAuth } from "@/contexts/auth-hooks";
import { toast } from "sonner";
import { Building2, Loader2 } from "lucide-react";
import { useUpdateCompanySettings } from "@/hooks/services";

export function AdminSettings() {
  const { settings, refetch } = useCompany();
  const { isAdmin } = useAuth();
  const updateCompanySettings = useUpdateCompanySettings();
  const [companyName, setCompanyName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [landlineNumber, setLandlineNumber] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings) {
      setCompanyName(settings.company_name);
      setLogoUrl(settings.logo_url || "");
      setPhoneNumber(settings.phone_number || "");
      setLandlineNumber(settings.landline_number || "");
    }
  }, [settings]);

  const handleSaveCompany = async () => {
    if (!companyName.trim()) {
      toast.error("Company name is required");
      return;
    }
    setSaving(true);
    try {
      await updateCompanySettings.mutateAsync({
        company_name: companyName.trim(),
        logo_url: logoUrl.trim() || null,
        phone_number: phoneNumber.trim() || null,
        landline_number: landlineNumber.trim() || null,
      });
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

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Mobile Phone</Label>
              <Input
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="e.g., +971501234567"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Landline Number</Label>
              <Input
                value={landlineNumber}
                onChange={(e) => setLandlineNumber(e.target.value)}
                placeholder="e.g., 4803"
              />
            </div>
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
