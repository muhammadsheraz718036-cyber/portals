import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminRoles } from "@/components/admin/AdminRoles";
import { AdminDepartments } from "@/components/admin/AdminDepartments";
import { AdminApprovalTypes } from "@/components/admin/AdminApprovalTypes";
import { AdminChains } from "@/components/admin/AdminChains";
import { AdminUsers } from "@/components/admin/AdminUsers";
import { AdminSettings } from "@/components/admin/AdminSettings";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";

export default function AdminConsole() {
  const [activeTab, setActiveTab] = useState("users");
  const { isAdmin } = useAuth();

  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Admin Console</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage users, roles, departments, approval types, chains, and settings</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
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
