export type AdminNavItem = {
  href: string;
  label: string;
  /** Permission returned by /api/admin/auth/me. */
  permission: string;
  /**
   * Roles that must see the item even when an older session permission list
   * does not yet include `permission`. The API still enforces the permission.
   */
  roles?: readonly string[];
  /** Keep the item in the sidebar for every role except moderator. */
  alwaysVisibleExceptModerator?: boolean;
};

export const VERIFIED_ACCOUNTS_HREF = "/verified-accounts";
export const VERIFIED_ACCOUNTS_LABEL = "Account Verification";

export function isNavItemVisible(
  item: Pick<AdminNavItem, "permission" | "roles" | "alwaysVisibleExceptModerator">,
  permissions: readonly string[],
  role: string | null | undefined
): boolean {
  if (item.alwaysVisibleExceptModerator && role !== "moderator") return true;
  if (permissions.includes(item.permission)) return true;
  if (role && item.roles?.includes(role)) return true;
  return false;
}
