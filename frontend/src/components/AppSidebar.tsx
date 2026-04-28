import {
  LayoutDashboard,
  ClipboardCheck,
  BriefcaseBusiness,
  Settings,
  ScrollText,
  LogOut,
  User,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/auth-hooks";
import { useCompany } from "@/contexts/company-hooks";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { useSidebar } from "@/components/ui/sidebar-hooks";

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { profile, isAdmin, hasPermission, signOut } = useAuth();
  const { settings } = useCompany();

  const companyName = settings?.company_name || "ApprovalHub";

  const hasAdminAccess =
    isAdmin ||
    hasPermission("manage_users") ||
    hasPermission("manage_roles") ||
    hasPermission("manage_departments") ||
    hasPermission("manage_approval_types") ||
    hasPermission("manage_chains") ||
    hasPermission("all");
  const hasAuditAccess =
    isAdmin || hasPermission("view_audit_logs") || hasPermission("all");

  const navItems = [
    { title: "Dashboard", url: "/", icon: LayoutDashboard, show: true },
    {
      title: "My Approvals",
      url: "/approvals",
      icon: ClipboardCheck,
      show: true,
    },
    {
      title: "Assigned Work",
      url: "/assigned-work",
      icon: BriefcaseBusiness,
      show: true,
    },
    {
      title: "Admin Console",
      url: "/admin",
      icon: Settings,
      show: hasAdminAccess,
    },
    {
      title: "Audit Logs",
      url: "/audit-logs",
      icon: ScrollText,
      show: hasAuditAccess,
    },
    {
      title: "Profile",
      url: "/profile",
      icon: User,
      show: true,
    },
  ].filter((i) => i.show);

  const initials =
    profile?.full_name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "??";

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      <SidebarContent className="bg-sidebar pt-4">
        {!collapsed && (
          <div className="px-4 pb-4 mb-2 border-b border-sidebar-border">
            <div className="flex items-center gap-2">
              {settings?.logo_url && (
                <img
                  src={settings.logo_url}
                  alt="Logo"
                  className="h-20 w-20 object-contain rounded"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              )}
              <div>
                <h1 className="text-lg font-bold text-sidebar-foreground tracking-tight">
                  {companyName}
                </h1>
              </div>
            </div>
          </div>
        )}
        {collapsed && (
          <div className="flex items-center justify-center pb-4 mb-2 border-b border-sidebar-border">
            {settings?.logo_url ? (
              <img
                src={settings.logo_url}
                alt="Logo"
                className="h-7 w-7 object-contain rounded"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                  const parent = (e.target as HTMLImageElement).parentElement;
                  if (parent) {
                    const span = document.createElement("span");
                    span.className =
                      "text-lg font-bold text-sidebar-foreground";
                    span.textContent = companyName[0];
                    parent.appendChild(span);
                  }
                }}
              />
            ) : (
              <span className="text-lg font-bold text-sidebar-foreground">
                {companyName[0]}
              </span>
            )}
          </div>
        )}

        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-muted text-[10px] uppercase tracking-widest font-semibold">
            Navigation
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={
                      item.url === "/"
                        ? location.pathname === "/"
                        : location.pathname.startsWith(item.url)
                    }
                    className="transition-snappy"
                  >
                    <NavLink
                      to={item.url}
                      end={item.url === "/"}
                      className="text-sidebar-muted hover:text-sidebar-foreground"
                      activeClassName="bg-sidebar-accent text-sidebar-foreground font-medium"
                    >
                      <item.icon className="mr-2 h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="bg-sidebar border-t border-sidebar-border p-3">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded bg-sidebar-accent flex items-center justify-center text-xs font-semibold text-sidebar-foreground">
            {initials}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-sidebar-foreground truncate">
                {profile?.full_name || "User"}
              </p>
              <p className="text-[11px] text-sidebar-muted truncate">
                {profile?.email}
              </p>
            </div>
          )}
          {!collapsed && (
            <Button
              variant="ghost"
              size="sm"
              onClick={signOut}
              className="text-sidebar-muted hover:text-black p-1"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          )}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
