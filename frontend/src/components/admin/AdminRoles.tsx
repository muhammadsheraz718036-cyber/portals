import { useState, useEffect } from "react";
import { Plus, Edit, Trash2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { allPermissions } from "@/lib/constants";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/contexts/auth-hooks";

interface Role {
  id: string;
  name: string;
  description: string;
  permissions: string[];
}

export function AdminRoles() {
  const { profile: currentUser, hasPermission } = useAuth();
  const [roles, setRoles] = useState<Role[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRole, setEditRole] = useState<Role | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const hasAdminConsoleAccessForRole = (rolePermissions: string[]) =>
    rolePermissions.includes("all") ||
    rolePermissions.includes("manage_users") ||
    rolePermissions.includes("manage_roles") ||
    rolePermissions.includes("manage_departments") ||
    rolePermissions.includes("manage_approval_types") ||
    rolePermissions.includes("manage_chains");

  const isEditingOwnRoleWithAdminAccess =
    editRole &&
    editRole.id === currentUser?.role_id &&
    hasAdminConsoleAccessForRole(editRole.permissions);

  const fetchRoles = async () => {
    try {
      const data = await api.roles.list();
      setRoles((data as Role[]) || []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load");
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchRoles();
  }, []);

  const openCreate = () => {
    setEditRole(null);
    setName("");
    setDescription("");
    setPermissions([]);
    setDialogOpen(true);
  };

  const openEdit = (role: Role) => {
    setEditRole(role);
    setName(role.name);
    setDescription(role.description);
    setPermissions(role.permissions);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    try {
      if (editRole) {
        await api.roles.update(editRole.id, { name, description, permissions });
        toast.success("Role updated");
      } else {
        await api.roles.create({ name, description, permissions });
        toast.success("Role created");
      }
      setDialogOpen(false);
      fetchRoles();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.roles.delete(id);
      toast.success("Role deleted");
      fetchRoles();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {roles.length} roles configured
        </p>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Add Role
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editRole ? "Edit Role" : "Create Role"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div className="space-y-1.5">
                <Label>Role Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Finance Manager"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label>Permissions</Label>
                <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto">
                  {allPermissions.map((perm) => (
                    <label
                      key={perm.id}
                      className="flex items-start gap-2 cursor-pointer"
                    >
                      <Checkbox
                        checked={permissions.includes(perm.id)}
                        onCheckedChange={(checked) => {
                          setPermissions(
                            checked
                              ? [...permissions, perm.id]
                              : permissions.filter((p) => p !== perm.id),
                          );
                        }}
                        disabled={isEditingOwnRoleWithAdminAccess}
                        className="mt-0.5"
                      />
                      <div>
                        <p className="text-sm font-medium">{perm.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {perm.description}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              <Button onClick={handleSave} className="w-full">
                {editRole ? "Update Role" : "Create Role"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          Loading...
        </p>
      ) : (
        <div className="grid gap-3">
          {roles.map((role) => (
            <Card key={role.id} className="border">
              <CardContent className="p-4 flex items-start justify-between">
                <div className="space-y-1.5">
                  <h3 className="text-sm font-semibold">{role.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {role.description}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {role.permissions.map((p) => (
                      <Badge
                        key={p}
                        variant="secondary"
                        className="text-[10px]"
                      >
                        {allPermissions.find((ap) => ap.id === p)?.label || p}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEdit(role)}
                  >
                    <Edit className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(role.id)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {roles.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No roles yet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
