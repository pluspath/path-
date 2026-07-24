import type { Context } from "hono";

type StatusCode = 200 | 201 | 204 | 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 503;

export type { StatusCode };

export function ok<T>(c: Context, data: T, status: StatusCode = 200) {
  return c.json({ data }, status);
}

export function fail(c: Context, message: string, status: StatusCode = 400, details?: unknown) {
  return c.json(
    {
      error: {
        message,
        ...(details !== undefined ? { details } : {}),
      },
    },
    status
  );
}

export function paginated<T>(
  c: Context,
  result: { items: T[]; total: number; page: number; limit: number; totalPages: number }
) {
  return c.json({ data: result.items, meta: {
    total: result.total,
    page: result.page,
    limit: result.limit,
    totalPages: result.totalPages,
  }});
}
