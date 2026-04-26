import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminRoles } from "@/components/admin/AdminRoles";
import { AdminDepartments } from "@/components/admin/AdminDepartments";
import { AdminApprovalTypes } from "@/components/admin/AdminApprovalTypes";
import { AdminChains } from "@/components/admin/AdminChains";
import { AdminUsers } from "@/components/admin/AdminUsers";
import { AdminSettings } from "@/components/admin/AdminSettings";
import { useAuth } from "@/contexts/auth-hooks";
import { Navigate, useSearchParams } from "react-router-dom";

const adminTabs = [
  "users",
  "roles",
  "departments",
  "approval-types",
  "chains",
  "settings",
] as const;

type AdminTab = (typeof adminTabs)[number];

function getInitialTab(tab: string | null): AdminTab {
  return adminTabs.includes(tab as AdminTab) ? (tab as AdminTab) : "users";
}

export default function AdminConsole() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<AdminTab>(() =>
    getInitialTab(searchParams.get("tab")),
  );
  const { isAdmin, hasPermission } = useAuth();

  const hasAdminAccess =
    isAdmin ||
    hasPermission("manage_users") ||
    hasPermission("manage_roles") ||
    hasPermission("manage_departments") ||
    hasPermission("manage_approval_types") ||
    hasPermission("manage_chains") ||
    hasPermission("all");

  if (!hasAdminAccess) return <Navigate to="/" replace />;

  const handleTabChange = (value: string) => {
    const nextTab = getInitialTab(value);
    setActiveTab(nextTab);
    setSearchParams({ tab: nextTab });
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Admin Console</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage users, roles, departments, approval types, chains, and settings
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="bg-muted/50">
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="roles">Roles & Permissions</TabsTrigger>
          <TabsTrigger value="departments">Departments</TabsTrigger>
          <TabsTrigger value="approval-types">Approval Types</TabsTrigger>
          <TabsTrigger value="chains">Approval Chains</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-6">
          <AdminUsers />
        </TabsContent>
        <TabsContent value="roles" className="mt-6">
          <AdminRoles />
        </TabsContent>
        <TabsContent value="departments" className="mt-6">
          <AdminDepartments />
        </TabsContent>
        <TabsContent value="approval-types" className="mt-6">
          <AdminApprovalTypes />
        </TabsContent>
        <TabsContent value="chains" className="mt-6">
          <AdminChains />
        </TabsContent>
        <TabsContent value="settings" className="mt-6">
          <AdminSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
