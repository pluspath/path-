/**
 * One-shot: set gender-matched default avatars for profiles that never
 * uploaded a custom photo.
 * Usage: bun run scripts/backfill-gender-avatars.ts
 */
import { backfillGenderAvatars } from "../src/lib/avatar";

async function main() {
  console.log("[migrate] Backfilling gender default avatars…");
  const { updated } = await backfillGenderAvatars();
  console.log(`[migrate] Done — updated ${updated} profile(s)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
