"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { ErrorState, LoadingState } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const ROLES = ["super_admin", "admin", "moderator"] as const;

type RolesMatrix = Record<string, readonly string[] | string[]>;

export default function RolesPage() {
  const [matrix, setMatrix] = useState<RolesMatrix | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ data: RolesMatrix }>("/admins/roles")
      .then((r) => setMatrix(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load roles"));
  }, []);

  const permissions = useMemo(() => (matrix ? Object.keys(matrix).sort() : []), [matrix]);

  if (error) return <ErrorState message={error} />;
  if (!matrix) return <LoadingState />;

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        title="Roles & Permissions"
        description="Permission matrix for super_admin, admin, and moderator"
      />

      <Card>
        <CardContent className="overflow-x-auto pt-5">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-zinc-50/80 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900/60">
              <tr>
                <th className="px-4 py-3 font-medium">Permission</th>
                {ROLES.map((role) => (
                  <th key={role} className="px-4 py-3 font-medium">
                    {role}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {permissions.map((perm) => {
                const allowed = new Set(matrix[perm] || []);
                return (
                  <tr key={perm} className="hover:bg-emerald-50/40 dark:hover:bg-emerald-950/20">
                    <td className="px-4 py-3 font-mono text-xs">{perm}</td>
                    {ROLES.map((role) => (
                      <td key={role} className="px-4 py-3">
                        {allowed.has(role) ? (
                          <Badge variant="success">allowed</Badge>
                        ) : (
                          <Badge variant="muted">—</Badge>
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
