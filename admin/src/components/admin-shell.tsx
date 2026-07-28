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

const navGroups = [
  {
    label: "Overview",
    items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, permission: "dashboard:read" }],
  },
  {
    label: "Community",
    items: [
      { href: "/users", label: "Users", icon: Users, permission: "users:read" },
      { href: "/posts", label: "Posts", icon: FileText, permission: "posts:read" },
      { href: "/comments", label: "Comments", icon: MessageSquareText, permission: "comments:read" },
      { href: "/friendships", label: "Friendships", icon: HeartHandshake, permission: "friendships:read" },
      { href: "/notifications", label: "Notifications", icon: Bell, permission: "notifications:read" },
      { href: "/reports", label: "Reports", icon: ClipboardList, permission: "reports:read" },
    ],
  },
  {
    label: "Content",
    items: [
      { href: "/cms", label: "CMS", icon: FileText, permission: "cms:read" },
      { href: "/files", label: "Files", icon: FolderOpen, permission: "files:read" },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/logs", label: "Logs", icon: Activity, permission: "logs:read" },
      { href: "/admins", label: "Admin Accounts", icon: UserCog, permission: "admins:read" },
      { href: "/roles", label: "Roles", icon: Shield, permission: "admins:read" },
      { href: "/settings", label: "Settings", icon: Settings, permission: "settings:read" },
      { href: "/health", label: "System Health", icon: Server, permission: "health:read" },
    ],
  },
];

function PathPlusMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-lg bg-navy text-[13px] font-bold tracking-tight text-gold shadow-sm dark:bg-gold dark:text-navy-deep",
        className
      )}
    >
      P+
    </span>
  );
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout, hasPermission } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const groups = useMemo(
    () =>
      navGroups
        .map((g) => ({ ...g, items: g.items.filter((n) => hasPermission(n.permission)) }))
        .filter((g) => g.items.length > 0),
    [hasPermission]
  );

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream dark:bg-navy-deep">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-navy border-t-transparent dark:border-gold dark:border-t-transparent" />
      </div>
    );
  }

  const crumbs = pathname.split("/").filter(Boolean);
  const isDark = mounted && (resolvedTheme === "dark" || theme === "dark");

  return (
    <div className="min-h-screen bg-cream text-navy dark:bg-navy-deep dark:text-cream">
      <div className="flex min-h-screen">
        {open ? (
          <button
            type="button"
            aria-label="Close navigation"
            className="fixed inset-0 z-30 bg-navy/40 backdrop-blur-[1px] lg:hidden"
            onClick={() => setOpen(false)}
          />
        ) : null}

        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col border-r border-[#E8E4DC]/90 bg-white transition-transform duration-200 dark:border-[#1A2740] dark:bg-[#0C1830] lg:static lg:translate-x-0",
            open ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <div className="flex h-16 items-center justify-between gap-2 border-b border-[#E8E4DC]/90 px-4 dark:border-[#1A2740]">
            <Link href="/dashboard" className="flex items-center gap-2.5" onClick={() => setOpen(false)}>
              <PathPlusMark />
              <div className="leading-tight">
                <p className="text-sm font-semibold tracking-tight text-navy dark:text-cream">Path+</p>
                <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted">Admin Console</p>
              </div>
            </Link>
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
            {groups.map((group) => (
              <div key={group.label}>
                <p className="mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = pathname === item.href || pathname.startsWith(item.href + "/");
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setOpen(false)}
                        className={cn(
                          "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
                          active
                            ? "bg-navy text-white shadow-sm dark:bg-gold dark:text-navy-deep"
                            : "text-[#5A5A5A] hover:bg-cream hover:text-navy dark:text-[#A0A0A0] dark:hover:bg-[#132038] dark:hover:text-cream"
                        )}
                      >
                        <Icon
                          className={cn(
                            "h-4 w-4 shrink-0",
                            active ? "text-gold dark:text-navy-deep" : "opacity-70"
                          )}
                        />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className="border-t border-[#E8E4DC]/90 p-3 dark:border-[#1A2740]">
            <div className="rounded-lg border border-[#E8E4DC]/80 bg-cream px-3 py-2.5 dark:border-[#1A2740] dark:bg-[#060F22]/50">
              <p className="truncate text-sm font-medium text-navy dark:text-cream">
                {user.display_name || user.username}
              </p>
              <p className="truncate font-mono text-[11px] uppercase tracking-wide text-muted">{user.role}</p>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-[#E8E4DC]/90 bg-white/85 px-4 backdrop-blur-md dark:border-[#1A2740] dark:bg-[#0C1830]/85">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)}>
              <Menu className="h-4 w-4" />
            </Button>

            <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center text-sm md:flex">
              <Link href="/dashboard" className="text-muted transition hover:text-navy dark:hover:text-cream">
                Path+
              </Link>
              {crumbs.map((c, i) => (
                <span key={c} className="flex items-center">
                  <span className="mx-2 text-[#D4CFC6] dark:text-[#1A2740]">/</span>
                  <span
                    className={cn(
                      "capitalize",
                      i === crumbs.length - 1
                        ? "font-medium text-navy dark:text-cream"
                        : "text-muted"
                    )}
                  >
                    {c}
                  </span>
                </span>
              ))}
            </nav>

            <div className="relative ml-auto w-full max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input
                className="h-9 pl-9"
                placeholder="Search users…"
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
              variant="outline"
              size="icon"
              className="relative shrink-0"
              onClick={() => setTheme(isDark ? "light" : "dark")}
              aria-label="Toggle theme"
            >
              <Sun className="h-4 w-4 rotate-0 scale-100 transition dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition dark:rotate-0 dark:scale-100" />
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={async () => {
                await logout();
                router.replace("/login");
              }}
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Logout</span>
            </Button>
          </header>

          <main className="flex-1 p-4 md:p-6 lg:p-8">
            <div className="mx-auto w-full max-w-[1400px]">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
