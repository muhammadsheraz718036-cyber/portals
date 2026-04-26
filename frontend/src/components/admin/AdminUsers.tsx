import { useState } from "react";
import { Plus, Edit, Trash2, Unlock, Key, Upload } from "lucide-react";
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
import { PasswordInput } from "@/components/PasswordInput";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  useProfiles,
  useDepartments,
  useRoles,
  useCreateUser,
  useUpdateUser,
  useDeleteUser,
  useResetUserPassword,
  useUploadUserSignature,
} from "@/hooks/services";
import { toast } from "sonner";
import { useAuth } from "@/contexts/auth-hooks";
import { isPasswordPolicyValid, PASSWORD_POLICY_HINT } from "@/lib/passwordPolicy";

interface Profile {
  id: string;
  full_name: string;
  email: string;
  signature_url?: string | null;
  department_id: string | null;
  department_ids: string[];
  role_id: string | null;
  role_ids: string[];
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

function toggleAssignedId(current: string[], id: string) {
  return current.includes(id)
    ? current.filter((value) => value !== id)
    : [...current, id];
}

export function AdminUsers() {
  const { profile: currentUser, hasPermission } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editUser, setEditUser] = useState<Profile | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [signaturePreview, setSignaturePreview] = useState("");
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [roleIds, setRoleIds] = useState<string[]>([]);
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
  const uploadSignatureMutation = useUploadUserSignature();

  const hasAdminConsoleAccess =
    currentUser?.is_admin ||
    hasPermission("manage_users") ||
    hasPermission("manage_roles") ||
    hasPermission("manage_departments") ||
    hasPermission("manage_approval_types") ||
    hasPermission("manage_chains") ||
    hasPermission("all");

  const canToggleAdmin = currentUser?.is_admin === true;
  const roleEditingDisabled =
    editUser?.id === currentUser?.id && hasAdminConsoleAccess;
  const nonAdminCreatorMustAssign = currentUser?.is_admin !== true;
  const selectedRoles = roles.filter((role) => roleIds.includes(role.id));

  const openCreate = () => {
    setEditUser(null);
    setFullName("");
    setEmail("");
    setSignaturePreview("");
    setSignatureFile(null);
    setPassword("");
    setDepartmentIds([]);
    setRoleIds([]);
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
    setSignaturePreview(user.signature_url ?? "");
    setSignatureFile(null);
    setPassword("");
    setDepartmentIds(
      user.department_ids?.length
        ? user.department_ids
        : user.department_id
          ? [user.department_id]
          : [],
    );
    setRoleIds(
      user.role_ids?.length
        ? user.role_ids
        : user.role_id
          ? [user.role_id]
          : [],
    );
    setIsAdmin(user.is_admin);
    setIsActive(user.is_active);
    setChangePassword(false);
    setNewPassword("");
    setDialogOpen(true);
  };

  const handleSignatureFileChange = (file: File | undefined) => {
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      toast.error("Signature must be a PNG or JPG image");
      return;
    }
    setSignatureFile(file);
    const reader = new FileReader();
    reader.onload = () => {
      setSignaturePreview(typeof reader.result === "string" ? reader.result : "");
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (!fullName.trim()) {
      toast.error("Name is required");
      return;
    }

    if (!email.trim()) {
      toast.error("Email is required");
      return;
    }

    if (!editUser && (!email.trim() || !password.trim())) {
      toast.error("Email and password are required for new users");
      return;
    }
    if (!editUser && !isPasswordPolicyValid(password)) {
      toast.error(PASSWORD_POLICY_HINT);
      return;
    }

    if (editUser && changePassword && !newPassword.trim()) {
      toast.error("New password is required");
      return;
    }
    if (editUser && changePassword && !isPasswordPolicyValid(newPassword)) {
      toast.error(PASSWORD_POLICY_HINT);
      return;
    }

    if (!editUser && nonAdminCreatorMustAssign && departmentIds.length === 0) {
      toast.error("Assign at least one department");
      return;
    }

    if (!editUser && nonAdminCreatorMustAssign && roleIds.length === 0) {
      toast.error("Assign at least one role");
      return;
    }

    setSubmitting(true);
    try {
      if (editUser) {
        await updateUserMutation.mutateAsync({
          userId: editUser.id,
          data: {
            email,
            full_name: fullName,
            department_id: departmentIds[0] ?? null,
            department_ids: departmentIds,
            role_id: roleIds[0] ?? null,
            role_ids: roleIds,
            is_admin: isAdmin,
            is_active: isActive,
          },
        });

        if (changePassword && newPassword.trim()) {
          await resetPasswordMutation.mutateAsync({
            userId: editUser.id,
            newPassword,
          });
        }

        if (signatureFile) {
          await uploadSignatureMutation.mutateAsync({
            userId: editUser.id,
            file: signatureFile,
          });
          setSignatureFile(null);
        }

        toast.success("User updated successfully");
      } else {
        const created = await createUserMutation.mutateAsync({
          email,
          password,
          full_name: fullName,
          department_id: departmentIds[0] ?? null,
          department_ids: departmentIds,
          role_id: roleIds[0] ?? null,
          role_ids: roleIds,
          is_admin: isAdmin,
        });
        if (signatureFile) {
          await uploadSignatureMutation.mutateAsync({
            userId: created.id,
            file: signatureFile,
          });
          setSignatureFile(null);
        }
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

  const getDepartmentNames = (user: Profile) => {
    const ids =
      user.department_ids?.length
        ? user.department_ids
        : user.department_id
          ? [user.department_id]
          : [];
    return ids
      .map((id) => departments.find((department) => department.id === id)?.name)
      .filter(Boolean) as string[];
  };

  const getRoleNames = (user: Profile) => {
    const ids =
      user.role_ids?.length
        ? user.role_ids
        : user.role_id
          ? [user.role_id]
          : [];
    return ids
      .map((id) => roles.find((role) => role.id === id)?.name)
      .filter(Boolean) as string[];
  };

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
          <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-3xl flex-col overflow-hidden p-0 sm:w-full">
            <DialogHeader className="border-b px-5 py-4 sm:px-6">
              <DialogTitle>
                {editUser ? "Edit User" : "Create New User"}
              </DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-6">
              <div className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Full Name</Label>
                    <Input
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="John Doe"
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Email</Label>
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="john@company.com"
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Signature Image</Label>
                    <Input
                      type="file"
                      accept="image/png,image/jpeg"
                      onChange={(e) => handleSignatureFileChange(e.target.files?.[0])}
                    />
                    {signaturePreview && (
                      <div className="rounded-md border bg-white p-2">
                        <img
                          src={signaturePreview}
                          alt="Signature preview"
                          className="h-12 max-w-[200px] object-contain"
                        />
                      </div>
                    )}
                  </div>
                  {!editUser && (
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label>Password</Label>
                      <PasswordInput
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={PASSWORD_POLICY_HINT}
                      />
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <div className="mb-2">
                    <Label>Departments</Label>
                    <p className="text-xs text-muted-foreground">
                      Select one or more departments. The first selected one becomes the
                      primary department.
                    </p>
                  </div>
                  <div className="max-h-40 space-y-2 overflow-y-auto rounded-lg border p-3">
                    {departments.map((department) => {
                      const checked = departmentIds.includes(department.id);
                      return (
                        <label
                          key={department.id}
                          className="flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2"
                        >
                          <div className="flex items-center gap-3">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() =>
                                setDepartmentIds((current) =>
                                  toggleAssignedId(current, department.id),
                                )
                              }
                            />
                            <span className="text-sm">{department.name}</span>
                          </div>
                          {departmentIds[0] === department.id && (
                            <Badge variant="secondary" className="text-[10px]">
                              Primary
                            </Badge>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <div>
                    <Label>Roles</Label>
                    <p className="text-xs text-muted-foreground">
                      Select one or more roles. The first selected one becomes the
                      primary role.
                    </p>
                  </div>
                <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border p-3">
                  {roles.map((role) => {
                    const checked = roleIds.includes(role.id);
                    return (
                      <label
                        key={role.id}
                        className="block cursor-pointer rounded-md border px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <Checkbox
                              checked={checked}
                              disabled={roleEditingDisabled}
                              onCheckedChange={() =>
                                setRoleIds((current) =>
                                  toggleAssignedId(current, role.id),
                                )
                              }
                            />
                            <span className="text-sm">{role.name}</span>
                          </div>
                          {roleIds[0] === role.id && (
                            <Badge variant="secondary" className="text-[10px]">
                              Primary
                            </Badge>
                          )}
                        </div>
                        {checked && role.permissions.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {role.permissions.map((permission) => (
                              <Badge
                                key={permission}
                                variant="secondary"
                                className="text-[10px]"
                              >
                                {permission}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </label>
                    );
                  })}
                </div>
                {selectedRoles.length > 1 && (
                  <div className="flex flex-wrap gap-1">
                    {Array.from(
                      new Set(
                        selectedRoles.flatMap((role) => role.permissions),
                      ),
                    ).map((permission) => (
                      <Badge
                        key={permission}
                        variant="outline"
                        className="text-[10px]"
                      >
                        {permission}
                      </Badge>
                    ))}
                  </div>
                )}
                </div>

                <div className="grid gap-4">
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
                          <p className="flex items-center gap-2 text-sm font-medium">
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
                          <PasswordInput
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder={PASSWORD_POLICY_HINT}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="border-t px-5 py-4 sm:px-6">
              <Button
                onClick={handleSave}
                className="w-full sm:w-auto"
                disabled={submitting}
              >
                {submitting
                  ? editUser
                    ? "Updating..."
                    : "Creating..."
                  : editUser
                    ? signatureFile
                      ? (
                        <span className="inline-flex items-center gap-2">
                          <Upload className="h-4 w-4" /> Update User
                        </span>
                      )
                      : "Update User"
                    : signatureFile
                      ? (
                        <span className="inline-flex items-center gap-2">
                          <Upload className="h-4 w-4" /> Create User
                        </span>
                      )
                      : "Create User"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Loading users...
        </p>
      ) : (
        <div className="grid gap-3">
          {users.map((user) => {
            const assignedDepartments = getDepartmentNames(user);
            const assignedRoles = getRoleNames(user);

            return (
              <Card key={user.id} className="border">
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex flex-1 items-center gap-3">
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                      {user.full_name
                        .split(" ")
                        .map((name) => name[0])
                        .join("")
                        .toUpperCase()
                        .slice(0, 2)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold">{user.full_name}</h3>
                        {user.is_admin && (
                          <Badge variant="default" className="text-[10px]">
                            Admin
                          </Badge>
                        )}
                        {!user.is_active && (
                          <Badge variant="destructive" className="text-[10px]">
                            Inactive
                          </Badge>
                        )}
                        {user.is_locked && (
                          <Badge variant="destructive" className="text-[10px]">
                            Locked
                          </Badge>
                        )}
                        {user.signature_url && (
                          <Badge variant="outline" className="text-[10px]">
                            Signature
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{user.email}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {assignedDepartments.length > 0 ? (
                          assignedDepartments.map((department, index) => (
                            <Badge
                              key={`${user.id}-department-${department}`}
                              variant="outline"
                              className="text-[10px]"
                            >
                              {index === 0 ? `Dept: ${department}` : department}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Dept: —
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {assignedRoles.length > 0 ? (
                          assignedRoles.map((role, index) => (
                            <Badge
                              key={`${user.id}-role-${role}`}
                              variant="secondary"
                              className="text-[10px]"
                            >
                              {index === 0 ? `Role: ${role}` : role}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Role: —
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="ml-2 flex flex-shrink-0 gap-1">
                    {user.is_locked && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleUnlock(user.id)}
                        title="Unlock account"
                      >
                        <Unlock className="h-4 w-4 text-orange-600" />
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => openEdit(user)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(user.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {users.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No users yet. Create the first user above.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
