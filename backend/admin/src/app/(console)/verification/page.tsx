"use client";

import { useCallback, useState } from "react";
import { BadgeCheck } from "lucide-react";
import { toast } from "sonner";
import { api, type Paginated } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { DataTable, ErrorState, LoadingState, type Column } from "@/components/data-table";
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

export default function VerificationPage() {
  const { hasPermission } = useAuth();
  const canVerify = hasPermission("users:verify");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<AccountRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: "1", limit: "20" });
      if (search.trim()) params.set("search", search.trim());
      const res = await api.get<Paginated<AccountRow>>(`/users?${params}`);
      setRows(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to search accounts");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [search]);

  async function setVerified(account: AccountRow, verified: boolean) {
    setBusyId(account.id);
    try {
      const res = await api.post<{ data: VerificationResult }>(`/users/${account.id}/verification`, { verified });
      const next = res.data?.verified === true;
      setRows((current) => current.map((row) => (row.id === account.id ? { ...row, is_verified: next } : row)));
      toast.success(next ? "Verification granted" : "Verification revoked");
      setConfirmRevoke(null);
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
        row.is_verified ? (
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
        if (row.is_verified) {
          return (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirmRevoke(row)}>
              {busy ? "Working…" : "Revoke Verification"}
            </Button>
          );
        }
        return (
          <Button size="sm" disabled={busy} onClick={() => void setVerified(row, true)}>
            {busy ? "Working…" : "Grant Verification"}
          </Button>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Verified accounts"
        description="Grant or revoke the Path+ verification badge. This is an administrator badge, not a legal identity check."
      />
      <Card>
        <CardHeader>
          <CardTitle>Find an account</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Username, display name, or location"
            onKeyDown={(e) => {
              if (e.key === "Enter") void load();
            }}
          />
          <Button onClick={() => void load()} disabled={loading}>
            {loading ? "Searching…" : "Search"}
          </Button>
        </CardContent>
      </Card>

      {error ? <ErrorState message={error} /> : null}
      {loading ? <LoadingState /> : null}
      {!loading && !error ? (
        <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} empty="Search for an account to manage its badge." />
      ) : null}

      {confirmRevoke ? (
        <Card>
          <CardHeader>
            <CardTitle>Revoke verification?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-slate-600">
              {confirmRevoke.full_name || confirmRevoke.username} will lose the verification badge across Path+.
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
