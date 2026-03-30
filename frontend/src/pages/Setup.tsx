import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/auth-hooks";
import { Navigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, setStoredToken } from "@/lib/api";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";

export default function Setup() {
  const { user, loading } = useAuth();
  const [hasUsers, setHasUsers] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.setup
      .status()
      .then(({ hasUsers: exists }) => setHasUsers(exists))
      .catch(() => setHasUsers(false));
  }, []);

  if (loading || hasUsers === null) {
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
    setSubmitting(true);

    try {
      const { token } = await api.setup.complete({
        email,
        password,
        full_name: fullName,
      });
      setStoredToken(token);
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
          <p className="text-sm text-muted-foreground">Create the first administrator account</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSetup} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Full Name</Label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Admin Name" />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@company.com" />
            </div>
            <div className="space-y-1.5">
              <Label>Password</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Minimum 6 characters" />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Create Admin Account
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
