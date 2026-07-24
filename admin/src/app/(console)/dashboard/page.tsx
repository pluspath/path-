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
import { api } from "@/lib/api";
import { formatDate, formatNumber } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ data: DashboardData }>("/dashboard")
      .then((r) => setData(r.data))
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-700">{error}</div>;
  }

  if (!data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
      </div>
    );
  }

  const cards = [
    { label: "Total Users", value: data.cards.totalUsers },
    { label: "Active Users", value: data.cards.activeUsers },
    { label: "New Users Today", value: data.cards.newUsersToday },
    { label: "Posts / Moments", value: data.cards.postsCount },
    { label: "Friendships", value: data.cards.friendshipsCount },
    { label: "Comments", value: data.cards.commentsCount },
    { label: "Reactions", value: data.cards.reactionsCount },
    { label: "Notifications", value: data.cards.notificationsCount },
    { label: "Open Reports", value: data.cards.reportsCount },
  ];

  return (
    <div className="space-y-6 animate-fade-up">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-zinc-500">Live Path+ application statistics</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.label} className="transition hover:-translate-y-0.5 hover:shadow-md">
            <CardHeader>
              <CardDescription>{c.label}</CardDescription>
              <CardTitle className="text-3xl">{formatNumber(c.value)}</CardTitle>
            </CardHeader>
          </Card>
        ))}
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
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Area type="monotone" dataKey="count" stroke="#059669" fill="url(#reg)" />
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
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Area type="monotone" dataKey="count" stroke="#2563eb" fill="url(#posts)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Latest Registrations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.latestRegistrations.map((u) => (
              <div key={u.id} className="flex items-center justify-between rounded-xl border px-3 py-2">
                <div>
                  <p className="font-medium">{u.full_name || u.username}</p>
                  <p className="text-xs text-zinc-500">@{u.username}</p>
                </div>
                <div className="text-right">
                  <Badge variant={u.status === "suspended" ? "danger" : "success"}>
                    {u.status || "active"}
                  </Badge>
                  <p className="mt-1 text-xs text-zinc-500">{formatDate(u.created_at)}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Latest Activities</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.latestActivities.map((a) => (
              <div key={a.id} className="rounded-xl border px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{a.action}</p>
                  <Badge variant="muted">{a.category}</Badge>
                </div>
                <p className="text-xs text-zinc-500">
                  {a.actor_name || a.actor_type} · {formatDate(a.created_at)}
                </p>
              </div>
            ))}
            {data.latestActivities.length === 0 && (
              <p className="text-sm text-zinc-500">No activity yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
