/**
 * Lightweight regression checks for:
 * - outgoing pending friends merging
 * - empty conversation inbox filtering
 *
 * Run: bun run scripts/test-friends-pending-and-empty-chats.ts
 */

function assert( cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("OK:", msg);
  }
}

function mergePending(friends: any[], pendingSent: any[]) {
  const pendingIds = new Set(pendingSent.map((u) => u.id));
  const accepted = friends.filter(
    (f) => f.friendshipStatus !== "pending_sent" && !pendingIds.has(f.id)
  );
  return [...pendingSent, ...accepted];
}

function filterEmptyChats(list: { id: string; lastMessage?: string; messages?: unknown[] }[]) {
  return list.filter(
    (c) => !!(c.lastMessage && String(c.lastMessage).trim()) || (c.messages?.length ?? 0) > 0
  );
}

const accepted = [{ id: "a", friendshipStatus: "friends" }];
const pending = [{ id: "b", friendshipStatus: "pending_sent" }];
const merged = mergePending(accepted, pending);
assert(merged[0]?.id === "b", "pending appears first");
assert(merged.some((u) => u.id === "a"), "accepted friend retained");
assert(merged.filter((u) => u.friendshipStatus === "pending_sent").length === 1, "pending not counted as friends");

const inbox = [
  { id: "1", lastMessage: "hi" },
  { id: "2", lastMessage: "" },
  { id: "3", lastMessage: "  " },
  { id: "4", messages: [{ id: "m1" }] },
];
const visible = filterEmptyChats(inbox);
assert(visible.map((c) => c.id).join(",") === "1,4", "empty conversations excluded from inbox");

if (process.exitCode) {
  console.error("Some checks failed");
  process.exit(1);
}
console.log("All checks passed");
