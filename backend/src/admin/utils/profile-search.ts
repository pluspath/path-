const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function safeProfileSearch(value: string): string {
  return value.replace(/[%_,.()*]/g, " ").replace(/\s+/g, " ").trim();
}

/** PostgREST `or` filter for the admin account search. */
export function profileSearchFilter(search: string, emailUserId: string | null): string {
  const raw = search.trim();
  const safe = safeProfileSearch(raw);
  const parts: string[] = [];
  if (safe) {
    parts.push(
      `username.ilike.%${safe}%`,
      `full_name.ilike.%${safe}%`,
      `location.ilike.%${safe}%`
    );
  }
  if (UUID_RE.test(raw)) parts.push(`id.eq.${raw}`);
  if (emailUserId && UUID_RE.test(emailUserId)) parts.push(`id.eq.${emailUserId}`);
  return parts.join(",");
}
