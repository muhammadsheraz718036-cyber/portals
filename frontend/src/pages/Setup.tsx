import { useState } from "react";
import { useAuth } from "@/contexts/auth-hooks";
import { Navigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/PasswordInput";
import { Label } from "@/components/ui/label";
import { setStoredToken } from "@/lib/api";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";
import { useSetup, useSetupStatus } from "@/hooks/services";
import {
  isPasswordPolicyValid,
  PASSWORD_POLICY_HINT,
} from "@/lib/passwordPolicy";
import { useQueryClient } from "@tanstack/react-query";

export default function Setup() {
  const { user, loading } = useAuth();
  const { data: setupStatus, isLoading: loadingSetupStatus } = useSetupStatus();
  const setupMutation = useSetup();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const hasUsers = setupStatus?.hasUsers ?? null;

  if (loading || loadingSetupStatus || hasUsers === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (hasUsers) return <Navigate to="/login" replace />;
  if (user) return <Navigate to="/" replace />;

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || !fullName) return;
    if (!isPasswordPolicyValid(password)) {
      toast.error(PASSWORD_POLICY_HINT);
      return;
    }
    setSubmitting(true);

    try {
      const { token } = await setupMutation.mutateAsync({
        email,
        password,
        full_name: fullName,
      });
      setStoredToken(token);

      // Invalidate setup status since we now have users
      queryClient.invalidateQueries({ queryKey: ["auth", "setup-status"] });

      toast.success("Admin account created!");
      window.location.assign("/");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Setup failed");
    }
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border shadow-lg">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
            <ShieldCheck className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl font-bold">Initial Setup</CardTitle>
          <p className="text-sm text-muted-foreground">
            Create the first administrator account
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSetup} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Full Name</Label>
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Admin Name"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@company.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Password</Label>
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
              />
              {password && !isPasswordPolicyValid(password) && (
                <p className="text-xs text-destructive">{PASSWORD_POLICY_HINT}</p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Create Admin Account
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
