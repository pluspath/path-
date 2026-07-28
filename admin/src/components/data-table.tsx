import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

export type Column<T> = {
  key: string;
  header: string;
  className?: string;
  cell: (row: T) => ReactNode;
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty = "No results found.",
  emptyHint,
  className,
  loading,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: string;
  emptyHint?: string;
  className?: string;
  loading?: boolean;
}) {
  if (loading) {
    return <TableSkeleton columns={columns.length} className={className} />;
  }

  return (
    <div
      className={cn(
        "atlas-table-scroll overflow-x-auto rounded-xl border border-slate-200/90 bg-white dark:border-slate-800 dark:bg-slate-900",
        className
      )}
    >
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-slate-200/90 bg-slate-50/90 text-[11px] uppercase tracking-[0.08em] text-slate-500 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
          <tr>
            {columns.map((col) => (
              <th key={col.key} className={cn("px-4 py-3 font-semibold", col.className)}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-14">
                <EmptyState title={empty} description={emptyHint} />
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={rowKey(row)}
                className="bg-white transition-colors hover:bg-blue-50/50 dark:bg-transparent dark:hover:bg-blue-950/20"
              >
                {columns.map((col) => (
                  <td key={col.key} className={cn("px-4 py-3 align-middle text-slate-700 dark:text-slate-200", col.className)}>
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 text-center">
      <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800">
        <Inbox className="h-5 w-5" />
      </div>
      <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{title}</p>
      {description ? <p className="max-w-sm text-xs text-slate-500">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function TableSkeleton({ columns = 5, rows = 6, className }: { columns?: number; rows?: number; className?: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-slate-200/90 bg-white dark:border-slate-800 dark:bg-slate-900",
        className
      )}
    >
      <div className="border-b border-slate-200/90 bg-slate-50/90 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/60">
        <div className="flex gap-4">
          {Array.from({ length: columns }).map((_, i) => (
            <div key={i} className="atlas-skeleton h-3 w-20" />
          ))}
        </div>
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex gap-4 px-4 py-3.5">
            {Array.from({ length: columns }).map((_, c) => (
              <div key={c} className={cn("atlas-skeleton h-4", c === 0 ? "w-36" : "w-24")} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function PaginationBar({
  page,
  totalPages,
  total,
  onPageChange,
  disabled,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
      <p className="font-mono text-xs tracking-tight">
        Page {page} of {Math.max(totalPages, 1)} · {total} total
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

export function LoadingState() {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-3">
      <div className="h-9 w-9 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">Loading</p>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
      {message}
    </div>
  );
}
