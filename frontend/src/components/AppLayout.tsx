import { useState } from "react";
import { LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAuth } from "@/contexts/auth-hooks";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);

  const initials =
    profile?.full_name
      ?.split(" ")
      .map((namePart) => namePart[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "??";

  const openProfile = () => {
    setShowUserMenu(false);
    navigate("/profile");
  };

  const handleSignOut = async () => {
    setShowUserMenu(false);
    await signOut();
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-12 flex items-center justify-between border-b bg-card px-4 no-print">
            <SidebarTrigger className="mr-4" />
            <Popover open={showUserMenu} onOpenChange={setShowUserMenu}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-full p-0"
                  aria-label="Open user menu"
                >
                  <Avatar className="h-8 w-8 rounded-full">
                    <AvatarFallback className="rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                side="bottom"
                sideOffset={10}
                className="w-[min(22rem,calc(100vw-1.5rem))] rounded-xl p-4 shadow-xl"
              >
                <div className="flex flex-col items-center text-center">
                  <Avatar className="h-16 w-16 rounded-full shadow-sm">
                    <AvatarFallback className="rounded-full bg-primary text-base font-semibold text-primary-foreground">
                      {initials}
                    </AvatarFallback>
                  </Avatar>

                  <div className="mt-3 min-w-0">
                    <p className="max-w-[18rem] truncate text-base font-semibold text-foreground">
                      {profile?.full_name || "User"}
                    </p>
                    <p className="max-w-[18rem] truncate text-sm text-muted-foreground">
                      {profile?.email || "No email available"}
                    </p>
                  </div>

                  {(profile?.role_name || profile?.department_name) && (
                    <div className="mt-4 flex max-w-full flex-wrap justify-center gap-2">
                      {profile?.role_name && (
                        <span className="max-w-full truncate rounded-full border bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
                          {profile.role_name}
                        </span>
                      )}
                      {profile?.department_name && (
                        <span className="max-w-full truncate rounded-full border bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
                          {profile.department_name}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="mt-5 grid w-full gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={openProfile}
                      className="gap-2"
                    >
                      Manage Profile & Security
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="gap-2 text-destructive hover:text-destructive"
                      onClick={handleSignOut}
                    >
                      <LogOut className="h-4 w-4" />
                      Sign Out
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </header>
          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </div>
      </div>

    </SidebarProvider>
  );
}
