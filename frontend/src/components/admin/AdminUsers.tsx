import { useState, useEffect } from "react";
import {
  Plus,
  Edit,
  Trash2,
  UserCheck,
  UserX,
  Unlock,
  Key,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useProfiles, useDepartments, useRoles, useCreateUser, useUpdateUser, useDeleteUser, useResetUserPassword } from "@/hooks/services";
import { toast } from "sonner";
import { useAuth } from "@/contexts/auth-hooks";

interface Profile {
  id: string;
  full_name: string;
  email: string;
  department_id: string | null;
  role_id: string | null;
  is_admin: boolean;
  is_active: boolean;
  is_locked?: boolean;
  failed_login_attempts?: number;
}

interface Department {
  id: string;
  name: string;
}

interface Role {
  id: string;
  name: string;
  permissions: string[];
}

export function AdminUsers() {
  const { profile: currentUser, hasPermission } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editUser, setEditUser] = useState<Profile | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [changePassword, setChangePassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  const { data: users = [], isLoading: loading } = useProfiles();
  const { data: departments = [] } = useDepartments();
  const { data: roles = [] } = useRoles();
  
  const createUserMutation = useCreateUser();
  const updateUserMutation = useUpdateUser();
  const deleteUserMutation = useDeleteUser();
  const resetPasswordMutation = useResetUserPassword();

  const hasAdminConsoleAccess =
    currentUser?.is_admin ||
    hasPermission("manage_users") ||
    hasPermission("manage_roles") ||
    hasPermission("manage_departments") ||
    hasPermission("manage_approval_types") ||
    hasPermission("manage_chains") ||
    hasPermission("all");


  const openCreate = () => {
    setEditUser(null);
    setFullName("");
    setEmail("");
    setPassword("");
    setDepartmentId("");
    setRoleId("");
    setIsAdmin(false);
    setIsActive(true);
    setChangePassword(false);
    setNewPassword("");
    setDialogOpen(true);
  };

  const openEdit = (user: Profile) => {
    setEditUser(user);
    setFullName(user.full_name);
    setEmail(user.email);
    setPassword("");
    setDepartmentId(user.department_id || "");
    setRoleId(user.role_id || "");
    setIsAdmin(user.is_admin);
    setIsActive(user.is_active);
    setChangePassword(false);
    setNewPassword("");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!fullName.trim()) {
      toast.error("Name is required");
      return;
    }

    if (!editUser && (!email.trim() || !password.trim())) {
      toast.error("Email and password are required for new users");
      return;
    }

    if (editUser && changePassword && !newPassword.trim()) {
      toast.error("New password is required");
      return;
    }

    setSubmitting(true);
    try {
      if (editUser) {
        // Update existing user
        await updateUserMutation.mutateAsync({
          userId: editUser.id,
          data: {
            full_name: fullName,
            department_id: departmentId || null,
            role_id: roleId || null,
            is_admin: isAdmin,
            is_active: isActive,
          },
        });

        // Change password if requested
        if (changePassword && newPassword.trim()) {
          await resetPasswordMutation.mutateAsync({
            userId: editUser.id,
            newPassword,
          });
        }

        toast.success("User updated successfully");
      } else {
        // Create new user
        await createUserMutation.mutateAsync({
          email,
          password,
          full_name: fullName,
          department_id: departmentId || null,
          role_id: roleId || null,
          is_admin: isAdmin,
        });
        toast.success("User created successfully");
      }
      setDialogOpen(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save user");
    }
    setSubmitting(false);
  };

  const handleUnlock = async (userId: string) => {
    try {
      await updateUserMutation.mutateAsync({
        userId,
        data: { unlock_account: true },
      });
      toast.success("Account unlocked successfully");
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Failed to unlock account",
      );
    }
  };

  const handleDelete = async (userId: string) => {
    if (!confirm("Are you sure you want to delete this user?")) {
      return;
    }
    try {
      await deleteUserMutation.mutateAsync(userId);
      toast.success("User deleted successfully");
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete user",
      );
    }
  };

  const getDeptName = (id: string | null) =>
    departments.find((d) => d.id === id)?.name || "—";
  const getRoleName = (id: string | null) =>
    roles.find((r) => r.id === id)?.name || "—";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{users.length} users</p>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Create User
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editUser ? "Edit User" : "Create New User"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div className="space-y-1.5">
                <Label>Full Name</Label>
                <Input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="John Doe"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Email {editUser && "(read-only)"}</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => !editUser && setEmail(e.target.value)}
                  placeholder="john@company.com"
                  disabled={!!editUser}
                />
              </div>
              {!editUser && (
                <div className="space-y-1.5">
                  <Label>Password</Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Department</Label>
                <Select value={departmentId} onValueChange={setDepartmentId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select department..." />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select
                  value={roleId}
                  onValueChange={setRoleId}
                  disabled={
                    editUser?.id === currentUser?.id && hasAdminConsoleAccess
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select role..." />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {roleId && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {roles
                      .find((r) => r.id === roleId)
                      ?.permissions.map((p) => (
                        <Badge
                          key={p}
                          variant="secondary"
                          className="text-[10px]"
                        >
                          {p}
                        </Badge>
                      ))}
                  </div>
                )}
              </div>
              {editUser && (
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">Active</p>
                    <p className="text-xs text-muted-foreground">
                      User can sign in
                    </p>
                  </div>
                  <Switch checked={isActive} onCheckedChange={setIsActive} />
                </div>
              )}
              {editUser && (
                <div className="space-y-3 rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium flex items-center gap-2">
                        <Key className="h-4 w-4" />
                        Change Password
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Set a new password for this user
                      </p>
                    </div>
                    <Switch
                      checked={changePassword}
                      onCheckedChange={setChangePassword}
                    />
                  </div>
                  {changePassword && (
                    <div className="space-y-1.5">
                      <Label>New Password</Label>
                      <Input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Minimum 6 characters"
                      />
                    </div>
                  )}
                </div>
              )}
              <Button
                onClick={handleSave}
                className="w-full"
                disabled={submitting}
              >
                {submitting
                  ? editUser
                    ? "Updating..."
                    : "Creating..."
                  : editUser
                    ? "Update User"
                    : "Create User"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          Loading users...
        </p>
      ) : (
        <div className="grid gap-3">
          {users.map((u) => (
            <Card key={u.id} className="border">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1">
                  <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary flex-shrink-0">
                    {u.full_name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")
                      .toUpperCase()
                      .slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold">{u.full_name}</h3>
                      {u.is_admin && (
                        <Badge variant="default" className="text-[10px]">
                          Admin
                        </Badge>
                      )}
                      {!u.is_active && (
                        <Badge variant="destructive" className="text-[10px]">
                          Inactive
                        </Badge>
                      )}
                      {u.is_locked && (
                        <Badge variant="destructive" className="text-[10px]">
                          Locked
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                    <div className="flex gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">
                        Dept: {getDeptName(u.department_id)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Role: {getRoleName(u.role_id)}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-1 flex-shrink-0 ml-2">
                  {u.is_locked && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleUnlock(u.id)}
                      title="Unlock account"
                    >
                      <Unlock className="h-4 w-4 text-orange-600" />
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => openEdit(u)}>
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(u.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {users.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No users yet. Create the first user above.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
