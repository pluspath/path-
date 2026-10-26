"use client";

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck } from "lucide-react";
import { toast } from "sonner";
import { api, type Paginated } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { DataTable, ErrorState, LoadingState, PaginationBar, type Column } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type AccountRow = {
  id: string;
  username?: string | null;
  full_name?: string | null;
  email?: string | null;
  is_verified?: boolean | null;
};

type VerificationResult = {
  id: string;
  verified: boolean;
};

export default function VerifiedAccountsPage() {
  const { hasPermission, user } = useAuth();
  const canVerify =
    hasPermission("users:verify") || user?.role === "super_admin" || user?.role === "admin";
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: 20, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<AccountRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (search.trim()) params.set("search", search.trim());
      const res = await api.get<Paginated<AccountRow>>(`/users?${params}`);
      setRows(Array.isArray(res.data) ? res.data : []);
      setMeta(res.meta ?? { total: 0, page, limit: 20, totalPages: 1 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load accounts");
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    void load();
  }, [load]);

  function applySearch() {
    const next = draft.trim();
    if (next === search && page === 1) {
      void load();
      return;
    }
    setPage(1);
    setSearch(next);
  }

  async function setVerified(account: AccountRow, verified: boolean) {
    if (!canVerify || busyId) return;
    setBusyId(account.id);
    try {
      const res = await api.post<{ data: VerificationResult }>(`/users/${account.id}/verification`, {
        verified,
      });
      if (typeof res.data?.verified !== "boolean") {
        throw new Error("The server did not confirm the new verification status");
      }
      const next = res.data.verified;
      setRows((current) => current.map((row) => (row.id === account.id ? { ...row, is_verified: next } : row)));
      setConfirmRevoke(null);
      toast.success(next ? "Verification granted" : "Verification revoked");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update verification");
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<AccountRow>[] = [
    {
      key: "account",
      header: "Account",
      cell: (row) => (
        <div>
          <p className="font-medium">{row.full_name || row.username || "Account"}</p>
          <p className="text-xs text-slate-500">@{row.username || "—"}</p>
          {row.email ? <p className="text-xs text-slate-500">{row.email}</p> : null}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) =>
        row.is_verified === true ? (
          <Badge variant="success" className="gap-1 normal-case">
            <BadgeCheck className="h-3.5 w-3.5" />
            Verified
          </Badge>
        ) : (
          <Badge variant="muted">Not Verified</Badge>
        ),
    },
    {
      key: "action",
      header: "Action",
      cell: (row) => {
        const busy = busyId === row.id;
        if (!canVerify) return <span className="text-xs text-slate-500">No permission</span>;
        if (row.is_verified === true) {
          return (
            <Button variant="outline" size="sm" disabled={!!busyId} onClick={() => setConfirmRevoke(row)}>
              {busy ? "Working…" : "Revoke Verification"}
            </Button>
          );
        }
        return (
          <Button size="sm" disabled={!!busyId} onClick={() => void setVerified(row, true)}>
            {busy ? "Working…" : "Grant Verification"}
          </Button>
        );
      },
    },
  ];

  return (
    <div className="space-y-6" data-testid="verified-accounts-page">
      <PageHeader
        title="Verified Accounts"
        description="Grant or revoke the Path+ verification badge. This is an administrator badge, not a legal identity check."
      />
      <Card>
        <CardHeader>
          <CardTitle>Find an account</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Username, display name, email, or account id"
            aria-label="Search accounts"
            onKeyDown={(e) => {
              if (e.key === "Enter") applySearch();
            }}
          />
          <Button onClick={applySearch} disabled={loading}>
            {loading ? "Searching…" : "Search"}
          </Button>
        </CardContent>
      </Card>

      {error ? (
        <div className="space-y-3">
          <ErrorState message={error} />
          <Button variant="outline" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : null}
      {loading ? <LoadingState /> : null}
      {!loading && !error ? (
        <>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            empty="No accounts found."
          />
          <PaginationBar
            page={meta.page || page}
            totalPages={meta.totalPages || 1}
            total={meta.total || 0}
            disabled={loading || !!busyId}
            onPageChange={setPage}
          />
        </>
      ) : null}

      {confirmRevoke ? (
        <Card>
          <CardHeader>
            <CardTitle>Revoke verification?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {confirmRevoke.full_name || confirmRevoke.username || "This account"} will lose the verification badge across Path+.
            </p>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                disabled={busyId === confirmRevoke.id}
                onClick={() => void setVerified(confirmRevoke, false)}
              >
                {busyId === confirmRevoke.id ? "Working…" : "Revoke Verification"}
              </Button>
              <Button variant="outline" onClick={() => setConfirmRevoke(null)} disabled={!!busyId}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
