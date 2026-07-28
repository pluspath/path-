"use client";

import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  Bell,
  FileText,
  HeartHandshake,
  MessageSquareText,
  Sparkles,
  Users,
  ClipboardList,
  UserPlus,
} from "lucide-react";
import { api } from "@/lib/api";
import { formatDate, formatNumber } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { ErrorState, LoadingState, EmptyState } from "@/components/data-table";

type DashboardData = {
  cards: {
    totalUsers: number;
    activeUsers: number;
    newUsersToday: number;
    postsCount: number;
    friendshipsCount: number;
    commentsCount: number;
    reactionsCount: number;
    notificationsCount: number;
    reportsCount: number;
  };
  charts: {
    registrations: { date: string; count: number }[];
    posts: { date: string; count: number }[];
  };
  latestRegistrations: Array<{
    id: string;
    username: string;
    full_name?: string | null;
    status?: string | null;
    created_at?: string | null;
  }>;
  latestActivities: Array<{
    id: string;
    action: string;
    category: string;
    actor_name?: string | null;
    actor_type?: string | null;
    created_at?: string | null;
  }>;
};

const kpiMeta = [
  { key: "totalUsers" as const, label: "Total Users", icon: Users, tone: "text-navy bg-cream dark:bg-[#132038] dark:text-gold" },
  { key: "activeUsers" as const, label: "Active Users", icon: Sparkles, tone: "text-gold bg-gold-soft dark:bg-[#1A2A14] dark:text-gold" },
  { key: "newUsersToday" as const, label: "New Today", icon: UserPlus, tone: "text-navy bg-cream dark:bg-[#132038] dark:text-cream" },
  { key: "postsCount" as const, label: "Posts / Moments", icon: FileText, tone: "text-navy bg-[#F0EBE3] dark:bg-[#132038] dark:text-[#C5CBD6]" },
  { key: "friendshipsCount" as const, label: "Friendships", icon: HeartHandshake, tone: "text-gold-muted bg-gold-soft dark:bg-[#1A2A14] dark:text-gold" },
  { key: "commentsCount" as const, label: "Comments", icon: MessageSquareText, tone: "text-navy bg-cream dark:bg-[#132038] dark:text-[#C5CBD6]" },
  { key: "reactionsCount" as const, label: "Reactions", icon: Activity, tone: "text-navy bg-gold-soft dark:bg-[#132038] dark:text-gold" },
  { key: "notificationsCount" as const, label: "Notifications", icon: Bell, tone: "text-navy bg-[#F0EBE3] dark:bg-[#132038] dark:text-[#C5CBD6]" },
  { key: "reportsCount" as const, label: "Open Reports", icon: ClipboardList, tone: "text-rose-600 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-400" },
];

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[#E8E4DC] bg-white px-3 py-2 text-xs shadow-atlas dark:border-[#1A2740] dark:bg-[#0C1830]">
      <p className="font-medium text-navy dark:text-cream">{label}</p>
      <p className="text-muted">{formatNumber(payload[0].value)}</p>
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ data: DashboardData }>("/dashboard")
      .then((r) => setData(r.data))
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!data) return <LoadingState />;

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow="Overview"
        title="Dashboard"
        description="Live Path+ application statistics and recent operational activity"
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {kpiMeta.map((c) => {
          const Icon = c.icon;
          return (
            <Card key={c.key} className="transition duration-200 hover:-translate-y-0.5 hover:shadow-atlas">
              <CardContent className="flex items-start justify-between gap-3 pt-5">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted">{c.label}</p>
                  <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums text-navy dark:text-cream">
                    {formatNumber(data.cards[c.key])}
                  </p>
                </div>
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${c.tone}`}>
                  <Icon className="h-4 w-4" />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Registrations</CardTitle>
            <CardDescription>Last 14 days</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.charts.registrations}>
                <defs>
                  <linearGradient id="reg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0A1F44" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="#0A1F44" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E8E4DC" opacity={0.7} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#8B8B8B" }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#8B8B8B" }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="count" stroke="#0A1F44" strokeWidth={2} fill="url(#reg)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Posts</CardTitle>
            <CardDescription>Last 14 days</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.charts.posts}>
                <defs>
                  <linearGradient id="posts" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#C9A84C" stopOpacity={0.32} />
                    <stop offset="95%" stopColor="#C9A84C" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E8E4DC" opacity={0.7} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#8B8B8B" }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#8B8B8B" }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="count" stroke="#C9A84C" strokeWidth={2} fill="url(#posts)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Latest Registrations</CardTitle>
            <CardDescription>Newest accounts on the platform</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.latestRegistrations.length === 0 ? (
              <EmptyState title="No registrations yet" />
            ) : (
              data.latestRegistrations.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center justify-between rounded-lg border border-[#E8E4DC]/80 px-3 py-2.5 transition hover:border-gold/40 hover:bg-gold-soft/50 dark:border-[#1A2740] dark:hover:border-gold/30 dark:hover:bg-gold/5"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-navy dark:text-cream">
                      {u.full_name || u.username}
                    </p>
                    <p className="truncate text-xs text-muted">@{u.username}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <Badge variant={u.status === "suspended" ? "danger" : "success"}>
                      {u.status || "active"}
                    </Badge>
                    <p className="mt-1 font-mono text-[10px] text-muted">{formatDate(u.created_at)}</p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Latest Activities</CardTitle>
            <CardDescription>Recent admin and system events</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.latestActivities.length === 0 ? (
              <EmptyState title="No activity yet" description="Operational events will appear here." />
            ) : (
              data.latestActivities.map((a) => (
                <div
                  key={a.id}
                  className="rounded-lg border border-[#E8E4DC]/80 px-3 py-2.5 dark:border-[#1A2740]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-navy dark:text-cream">{a.action}</p>
                    <Badge variant="muted">{a.category}</Badge>
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-muted">
                    {a.actor_name || a.actor_type} · {formatDate(a.created_at)}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
