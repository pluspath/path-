"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await login(username, password);
      toast.success("Welcome back");
      router.replace("/dashboard");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen overflow-hidden bg-cream dark:bg-navy-deep">
      <div className="pointer-events-none absolute inset-0 atlas-grid-bg opacity-50 dark:opacity-25" />
      <div className="pointer-events-none absolute -left-24 top-0 h-[420px] w-[420px] rounded-full bg-navy/8 blur-3xl dark:bg-gold/10" />
      <div className="pointer-events-none absolute -right-16 bottom-0 h-[360px] w-[360px] rounded-full bg-gold/15 blur-3xl dark:bg-navy/40" />

      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col justify-center gap-8 px-4 py-12 lg:flex-row lg:items-stretch lg:gap-0 lg:px-6">
        <section className="hidden flex-1 flex-col justify-between rounded-l-2xl border border-r-0 border-[#E8E4DC]/90 bg-navy p-10 text-cream lg:flex dark:border-[#1A2740] dark:bg-[#0C1830]">
          <div>
            <div className="mb-8 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold text-[15px] font-bold tracking-tight text-navy">
                P+
              </div>
              <div>
                <p className="text-lg font-semibold tracking-tight">Path+</p>
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-gold/80">Admin Console</p>
              </div>
            </div>
            <h1 className="max-w-sm text-3xl font-semibold leading-tight tracking-tight text-cream">
              Command center for Path+ operations
            </h1>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-[#A8B0C0]">
              Monitor community health, moderate content, and manage platform settings from a single console.
            </p>
          </div>
          <div className="space-y-3 border-t border-white/10 pt-6">
            <div className="flex items-center gap-3 text-sm text-[#C5CBD6]">
              <ShieldCheck className="h-4 w-4 text-gold" />
              Role-based access control
            </div>
            <div className="flex items-center gap-3 text-sm text-[#C5CBD6]">
              <Lock className="h-4 w-4 text-gold" />
              Independent admin authentication
            </div>
          </div>
        </section>

        <section className="w-full max-w-md animate-fade-up self-center rounded-2xl border border-[#E8E4DC]/90 bg-white p-8 shadow-atlas-lg dark:border-[#1A2740] dark:bg-[#0C1830] lg:max-w-none lg:flex-1 lg:rounded-l-none lg:self-stretch lg:p-10">
          <div className="mb-8 lg:hidden">
            <div className="mb-4 flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-navy text-[13px] font-bold tracking-tight text-gold dark:bg-gold dark:text-navy-deep">
                P+
              </div>
              <div>
                <p className="font-semibold tracking-tight text-navy dark:text-cream">Path+</p>
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted">Admin Console</p>
              </div>
            </div>
          </div>

          <div className="mb-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold">
              Sign in
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight text-navy dark:text-cream">
              Welcome back
            </h2>
            <p className="mt-1.5 text-sm text-muted">
              Use your admin credentials — separate from the mobile app.
            </p>
          </div>

          <form className="space-y-5" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                autoComplete="username"
                placeholder="Enter username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button className="w-full" type="submit" disabled={loading} size="lg">
              {loading ? "Signing in…" : "Sign in to console"}
            </Button>
          </form>

          <p className="mt-8 text-center text-[11px] text-muted">
            Authorized personnel only. Sessions are secured with bearer tokens.
          </p>
        </section>
      </div>
    </div>
  );
}
