import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/auth-hooks";
import { toast } from "sonner";
import { User, KeyRound, Loader2 } from "lucide-react";
import { useUpdatePassword, useUpdateProfile } from "@/hooks/services";
import { isPasswordPolicyValid, PASSWORD_POLICY_HINT } from "@/lib/passwordPolicy";

export default function Profile() {
  const { profile, refreshSession } = useAuth();
  const updateProfileMutation = useUpdateProfile();
  const updatePasswordMutation = useUpdatePassword();
  const [fullName, setFullName] = useState(profile?.full_name || "");
  const [updatingProfile, setUpdatingProfile] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [updatingPassword, setUpdatingPassword] = useState(false);

  const handleUpdateProfile = async () => {
    if (!fullName.trim()) {
      toast.error("Full name is required");
      return;
    }

    setUpdatingProfile(true);
    try {
      await updateProfileMutation.mutateAsync({ full_name: fullName.trim() });
      await refreshSession(); // Refresh the session to get updated profile
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update profile",
      );
    }
    setUpdatingProfile(false);
  };

  const handleUpdatePassword = async () => {
    if (!isPasswordPolicyValid(newPassword)) {
      toast.error(PASSWORD_POLICY_HINT);
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (!currentPassword) {
      toast.error("Current password is required");
      return;
    }

    setUpdatingPassword(true);
    try {
      await updatePasswordMutation.mutateAsync({
        new_password: newPassword,
        current_password: currentPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update password",
      );
    }
    setUpdatingPassword(false);
  };

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Profile</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your account settings and security
        </p>
      </div>

      <Card className="border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <User className="h-4 w-4" /> Account Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Full Name</Label>
            <Input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Enter your full name"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input value={profile?.email || ""} disabled />
          </div>
          <div className="space-y-1.5">
            <Label>Department</Label>
            <Input
              value={profile?.department_name || "Unassigned"}
              disabled
            />
          </div>
          <Button
            onClick={handleUpdateProfile}
            disabled={updatingProfile}
            className="gap-2"
          >
            {updatingProfile && <Loader2 className="h-4 w-4 animate-spin" />}
            Update Profile
          </Button>
        </CardContent>
      </Card>

      <Card className="border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> Change Password
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Current Password</Label>
            <Input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Enter your current password"
            />
          </div>
          <div className="space-y-1.5">
            <Label>New Password</Label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={PASSWORD_POLICY_HINT}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Confirm New Password</Label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
            />
          </div>
          <Button
            onClick={handleUpdatePassword}
            disabled={updatingPassword}
            className="gap-2"
          >
            {updatingPassword && <Loader2 className="h-4 w-4 animate-spin" />}
            Update Password
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
