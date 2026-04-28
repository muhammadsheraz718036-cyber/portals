import { useState } from "react";
import { Bell, CheckCheck, LogOut } from "lucide-react";
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
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from "@/hooks/services";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const { data: notificationData } = useNotifications();
  const markNotificationRead = useMarkNotificationRead();
  const markAllNotificationsRead = useMarkAllNotificationsRead();
  const notifications = notificationData?.notifications ?? [];
  const unreadCount = notificationData?.unreadCount ?? 0;

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

  const openNotification = async (notification: (typeof notifications)[number]) => {
    if (!notification.read_at) {
      await markNotificationRead.mutateAsync(notification.id);
    }
    setShowNotifications(false);
    if (notification.request_id) {
      navigate(`/approvals/${notification.request_id}`);
    }
  };

  const formatNotificationTime = (value: string) =>
    new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-12 flex items-center justify-between border-b bg-card px-4 no-print">
            <SidebarTrigger className="mr-4" />
            <div className="flex items-center gap-1.5">
              <Popover open={showNotifications} onOpenChange={setShowNotifications}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="relative h-9 w-9 rounded-full"
                    aria-label="Open notifications"
                  >
                    <Bell className="h-4 w-4" />
                    {unreadCount > 0 && (
                      <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground">
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  side="bottom"
                  sideOffset={10}
                  className="w-[min(26rem,calc(100vw-1.5rem))] rounded-xl p-0 shadow-xl"
                >
                  <div className="flex items-center justify-between border-b px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        Notifications
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {unreadCount > 0
                          ? `${unreadCount} unread`
                          : "You're all caught up"}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-2 text-xs"
                      disabled={unreadCount === 0 || markAllNotificationsRead.isPending}
                      onClick={() => markAllNotificationsRead.mutate()}
                    >
                      <CheckCheck className="h-3.5 w-3.5" />
                      Mark all read
                    </Button>
                  </div>

                  <div className="max-h-[24rem] overflow-y-auto">
                    {notifications.length === 0 ? (
                      <div className="px-4 py-8 text-center">
                        <p className="text-sm font-medium text-foreground">
                          No notifications yet
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Approval and work updates will appear here.
                        </p>
                      </div>
                    ) : (
                      notifications.map((notification) => (
                        <button
                          key={notification.id}
                          type="button"
                          onClick={() => void openNotification(notification)}
                          className="flex w-full gap-3 border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-muted/40"
                        >
                          <span
                            className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                              notification.read_at ? "bg-transparent" : "bg-primary"
                            }`}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center justify-between gap-3">
                              <span className="truncate text-sm font-medium text-foreground">
                                {notification.title}
                              </span>
                              <span className="shrink-0 text-[11px] text-muted-foreground">
                                {formatNotificationTime(notification.created_at)}
                              </span>
                            </span>
                            <span className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                              {notification.body}
                            </span>
                            {notification.request_number && (
                              <span className="mt-2 inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                {notification.request_number}
                              </span>
                            )}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </PopoverContent>
              </Popover>

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
            </div>
          </header>
          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </div>
      </div>

    </SidebarProvider>
  );
}
