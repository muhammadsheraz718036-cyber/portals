import {
  LayoutDashboard,
  ClipboardCheck,
  BriefcaseBusiness,
  Settings,
  ScrollText,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/auth-hooks";
import { useCompany } from "@/contexts/company-hooks";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useSidebar } from "@/components/ui/sidebar-hooks";

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { isAdmin, hasPermission } = useAuth();
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
  ].filter((i) => i.show);

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
    </Sidebar>
  );
}
