import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../constants";
import type { PaginatedResult } from "../types";

export function parsePagination(query: {
  page?: string;
  limit?: string;
  search?: string;
}): { page: number; limit: number; search?: string; offset: number } {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(query.limit) || DEFAULT_PAGE_SIZE));
  const search = query.search?.trim() || undefined;
  return { page, limit, search, offset: (page - 1) * limit };
}

export function toPaginated<T>(items: T[], total: number, page: number, limit: number): PaginatedResult<T> {
  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]!);
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(",")),
  ].join("\n");
}
