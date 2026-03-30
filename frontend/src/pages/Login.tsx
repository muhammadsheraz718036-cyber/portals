import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/auth-hooks";
import { useCompany } from "@/contexts/company-hooks";
import { Navigate, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Loader2, Shield } from "lucide-react";

export default function Login() {
  const { user, loading, signIn } = useAuth();
  const { settings } = useCompany();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    api.setup
      .status()
      .then(({ hasUsers }) => {
        if (!hasUsers) navigate("/setup", { replace: true });
        setChecking(false);
      })
      .catch(() => setChecking(false));
  }, [navigate]);

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
          <p className="text-sm text-muted-foreground">Sign in to your account</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" />
            </div>
            <div className="space-y-1.5">
              <Label>Password</Label>
              <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Sign In
            </Button>
          </form>
          <p className="text-xs text-muted-foreground text-center mt-4">
            In case of queries, contact MIS Department
            <br />
            Mobile: 0591373812<br />Telephone: 4803
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
