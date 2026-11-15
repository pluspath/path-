import postgres from "postgres";

/**
 * Shared direct Postgres client for auth-critical reads that must survive
 * PostgREST / Disk I/O Budget aborts.
 *
 * Prefer DIRECT_URL (session Postgres). DATABASE_URL often points at the
 * Supabase pooler with `?pgbouncer=true`, which postgres.js wrongly sends as a
 * startup parameter and fails with: unsupported startup parameter: pgbouncer.
 */
let sql: postgres.Sql | null = null;
let sqlUrl: string | null = null;

function sanitizePostgresUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.searchParams.delete("pgbouncer");
    // postgres.js maps unknown query keys to startup params; keep only safe ones.
    const keep = new Set(["sslmode", "ssl", "application_name", "connect_timeout"]);
    for (const key of [...u.searchParams.keys()]) {
      if (!keep.has(key.toLowerCase())) u.searchParams.delete(key);
    }
    return u.toString();
  } catch {
    return raw
      .replace(/([?&])pgbouncer=true&?/i, "$1")
      .replace(/[?&]$/, "");
  }
}

export function getDatabaseUrl(): string | null {
  const directUrl = process.env.DIRECT_URL?.trim();
  if (directUrl) return sanitizePostgresUrl(directUrl);

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) return sanitizePostgresUrl(databaseUrl);

  return null;
}

export function getDirectSql(): postgres.Sql | null {
  const url = getDatabaseUrl();
  if (!url) return null;
  if (sql && sqlUrl === url) return sql;
  if (sql) {
    void sql.end({ timeout: 1 }).catch(() => undefined);
  }
  sqlUrl = url;
  sql = postgres(url, {
    // Auth + unread aggregates share this pool when PostgREST is degraded.
    max: 10,
    idle_timeout: 20,
    connect_timeout: 20,
    ssl: "require",
    prepare: false,
  });
  return sql;
}

export async function withDirectSql<T>(
  fn: (db: postgres.Sql) => Promise<T>
): Promise<T | null> {
  const db = getDirectSql();
  if (!db) return null;
  return fn(db);
}
