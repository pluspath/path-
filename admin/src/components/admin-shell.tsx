"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bell,
  FileText,
  FolderOpen,
  HeartHandshake,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareText,
  Moon,
  Search,
  Settings,
  Shield,
  Sun,
  Users,
  ClipboardList,
  Server,
  UserCog,
  X,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, permission: "dashboard:read" },
  { href: "/users", label: "Users", icon: Users, permission: "users:read" },
  { href: "/posts", label: "Posts", icon: FileText, permission: "posts:read" },
  { href: "/comments", label: "Comments", icon: MessageSquareText, permission: "comments:read" },
  { href: "/friendships", label: "Friendships", icon: HeartHandshake, permission: "friendships:read" },
  { href: "/notifications", label: "Notifications", icon: Bell, permission: "notifications:read" },
  { href: "/reports", label: "Reports", icon: ClipboardList, permission: "reports:read" },
  { href: "/cms", label: "CMS", icon: FileText, permission: "cms:read" },
  { href: "/files", label: "Files", icon: FolderOpen, permission: "files:read" },
  { href: "/logs", label: "Logs", icon: Activity, permission: "logs:read" },
  { href: "/admins", label: "Admin Accounts", icon: UserCog, permission: "admins:read" },
  { href: "/roles", label: "Roles", icon: Shield, permission: "admins:read" },
  { href: "/settings", label: "Settings", icon: Settings, permission: "settings:read" },
  { href: "/health", label: "System Health", icon: Server, permission: "health:read" },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout, hasPermission } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const items = useMemo(
    () => nav.filter((n) => hasPermission(n.permission)),
    [hasPermission]
  );

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
      </div>
    );
  }

  const crumbs = pathname.split("/").filter(Boolean);

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-50 via-zinc-50 to-zinc-100 dark:from-zinc-900 dark:via-zinc-950 dark:to-black">
      <div className="flex min-h-screen">
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-40 w-72 border-r border-zinc-200/80 bg-white/90 backdrop-blur transition-transform dark:border-zinc-800 dark:bg-zinc-950/90 lg:static lg:translate-x-0",
            open ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <div className="flex h-16 items-center justify-between px-5">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-emerald-600">Path+</p>
              <p className="text-lg font-semibold">Admin Console</p>
            </div>
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <nav className="space-y-1 px-3 pb-6">
            {items.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition",
                    active
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-zinc-200/70 bg-white/70 px-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/70">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)}>
              <Menu className="h-4 w-4" />
            </Button>
            <div className="hidden text-sm text-zinc-500 md:block">
              {crumbs.map((c, i) => (
                <span key={c}>
                  {i > 0 && <span className="mx-1.5">/</span>}
                  <span className={i === crumbs.length - 1 ? "font-medium text-zinc-900 dark:text-zinc-100" : ""}>
                    {c}
                  </span>
                </span>
              ))}
            </div>
            <div className="relative ml-auto w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <Input
                className="pl-9"
                placeholder="Global search (users, posts…)"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && q.trim()) {
                    router.push(`/users?search=${encodeURIComponent(q.trim())}`);
                  }
                }}
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label="Toggle theme"
            >
              <Sun className="h-4 w-4 rotate-0 scale-100 transition dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition dark:rotate-0 dark:scale-100" />
            </Button>
            <div className="hidden text-right text-sm sm:block">
              <p className="font-medium">{user.display_name || user.username}</p>
              <p className="text-xs text-zinc-500">{user.role}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await logout();
                router.replace("/login");
              }}
            >
              <LogOut className="h-4 w-4" />
              Logout
            </Button>
          </header>
          <main className="flex-1 p-4 md:p-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
