import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/auth-hooks";
import { useCompany } from "@/contexts/company-hooks";
import { Navigate, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Shield } from "lucide-react";
import { useSetupStatus } from "@/hooks/services";

export default function Login() {
  const { user, loading, signIn } = useAuth();
  const { settings } = useCompany();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { data: setupStatus, isLoading: checking } = useSetupStatus();

  useEffect(() => {
    if (setupStatus?.hasUsers === false) {
      navigate("/setup", { replace: true });
    }
  }, [navigate, setupStatus?.hasUsers]);

  if (loading || checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (user) return <Navigate to="/" replace />;

  const companyName = settings?.company_name?.trim() || "ApprovalHub";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setSubmitting(true);
    const { error } = await signIn(email, password);
    if (error) {
      toast.error(error.message);
    }
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border shadow-lg">
        <CardHeader className="text-center space-y-3">
          {settings?.logo_url ? (
            <div className="flex justify-center">
              <img
                src={settings.logo_url}
                alt=""
                className="h-14 w-auto max-w-[220px] object-contain"
              />
            </div>
          ) : (
            <div className="mx-auto h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
              <Shield className="h-6 w-6 text-primary" />
            </div>
          )}
          <CardTitle className="text-xl font-bold">{companyName}</CardTitle>
          <p className="text-sm text-muted-foreground">
            Sign in to your account
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoFocus={true}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Password</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Sign In
            </Button>
          </form>
          {(settings?.phone_number || settings?.landline_number) && (
            <div className="rounded border p-3 mt-4 bg-muted/50 text-xs text-muted-foreground">
              <p className="font-semibold text-sm text-foreground text-center">
                In case of queries, contact{" "}
                {settings?.contact_department || "MIS Department"}
              </p>
              <div className="text-center">
                {settings?.phone_number && (
                  <span>Mobile: {settings.phone_number}</span>
                )}
                {settings?.phone_number && settings?.landline_number && <br />}
                {settings?.landline_number && (
                  <span>Telephone: {settings.landline_number}</span>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
