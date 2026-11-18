import { Hono } from "hono";
import { createUserClient, supabaseAdmin } from "../supabase";
import {
  formatPost,
  formatReactions,
  refreshReactionActors,
  isReactionLocked,
  baseReactionType,
  lockedReactionType,
} from "./users";
import { sendPushToUser } from "../lib/push";
import { SYSTEM_MOMENT_TYPES, refreshFriendshipAvatars } from "../lib/systemMoments";
import { ensureBirthdayMoments } from "../lib/birthday";
import { notifyMentions } from "../lib/mentions";
import { encodeImages } from "../lib/images";
import { getBlockedIds } from "../lib/blocks";
import { parseDurationToMinutes } from "../lib/duration";
import { POST_SELECT, loadPosts, attachOriginals, loadPostsByIds } from "../lib/load-posts";
import { resolveAvatarUrl } from "../lib/avatar";
import { attachCommentPreviews, formatCommentRow, formatCommentUser } from "../lib/comment-previews";
import { halfLineSnippet } from "../lib/moment-preview";
import { getDeletionHiddenUserIds } from "../lib/account-deletion";
import { fetchNewestMomentBatch } from "../lib/moment-feed";
import { walkNewestPage } from "../lib/moment-order";
import {
  parseLimit,
  parseCursor,
  encodeCursor,
  isOlderThanCursor,
} from "../lib/pagination";
import {
  canViewerSeeMoment,
  loadMomentVisibilityContext,
  normalizeAudience,
  scrubInvisibleOriginals,
  viewerCanAccessMoment,
} from "../lib/moment-visibility";
import { viewLimiter } from "../lib/rate-limit";
import { isSupabaseCircuitOpen } from "../lib/supabase-circuit";
import {
  assertVerifiedForPoll,
  attachPollsToPosts,
  castPollVote,
  createPollForPost,
  normalizePollPayload,
} from "../lib/polls";
import {
  commentLocationColumns,
  parseIncomingLocation,
  postLocationColumns,
} from "../lib/content-location";
import { attachUniqueReactorCounts, listUniquePublicReactors } from "../lib/reactors";
import type { HonoVariables } from "../types";

const postsRouter = new Hono<{ Variables: HonoVariables }>();

const COMMENT_LIST_SELECT =
  "id, post_id, user_id, content, created_at, updated_at, parent_comment_id, location_label, location_city, location_region, location_country, location_precision, location_captured_at, location_shared, profiles:user_id(id, full_name, username, avatar_url, gender, is_verified)";
const COMMENT_LIST_SELECT_NO_PARENT =
  "id, post_id, user_id, content, created_at, updated_at, location_label, location_city, location_region, location_country, location_precision, location_captured_at, location_shared, profiles:user_id(id, full_name, username, avatar_url, gender, is_verified)";
const COMMENT_LIST_SELECT_LEGACY =
  "id, post_id, user_id, content, created_at, profiles:user_id(id, full_name, username, avatar_url, gender, is_verified)";

/**
 * Structured (device GPS) location columns for a Moment, without clobbering an
 * explicit venue / check-in the client already chose.
 *  - A client-provided place name (`locationName`) always wins: legacy
 *    location / lat / lng stay exactly as sent and no GPS-derived structured
 *    columns are written.
 *  - For non-check-in Moments the raw GPS coordinates are dropped (only the
 *    display label / city / region / country are stored), so precise coords are
 *    never exposed through formatPost for ordinary text/photo Moments.
 */
function structuredPostLocationColumns(
  structuredLoc: ReturnType<typeof parseIncomingLocation>,
  opts: { explicitPlace: boolean; explicitCoords: boolean; type?: string | null }
): Record<string, unknown> {
  if (!structuredLoc || opts.explicitPlace) return {};
  const cols = postLocationColumns(structuredLoc);
  const isCheckIn = opts.type === "location";
  if (!isCheckIn && !opts.explicitCoords) {
    delete cols.location_lat;
    delete cols.location_lng;
  }
  return cols;
}

/** Unique reactor counts are an enhancement — never 500 a feed if the SQL fails. */
async function safeAttachUniqueReactorCounts(posts: any[], blockedIds: string[] = []): Promise<void> {
  try {
    await attachUniqueReactorCounts(posts, blockedIds);
  } catch (e) {
    console.warn("[posts] unique reactor counts failed:", e instanceof Error ? e.message : e);
  }
}

async function withPolls(posts: any[], viewerId?: string): Promise<void> {
  try {
    await attachPollsToPosts(posts, viewerId);
  } catch (e) {
    console.warn("[polls] attach failed:", e instanceof Error ? e.message : e);
  }
}

/** Copy poll payloads onto formatted API objects (formatPost may omit unknown fields). */
function copyPollsToFormatted(rawPosts: any[], formatted: any[]): void {
  const byId = new Map<string, any>();
  for (const p of rawPosts ?? []) {
    if (p?.id && p.poll) byId.set(String(p.id), p.poll);
    if (p?.original?.id && p.original.poll) byId.set(String(p.original.id), p.original.poll);
  }
  for (const f of formatted ?? []) {
    const poll = byId.get(String(f?.id ?? ""));
    if (poll) f.poll = poll;
    if (f?.original) {
      const op = byId.get(String(f.original.id ?? ""));
      if (op) f.original.poll = op;
    }
  }
}

/** Ensure uniqueReactorCount survives even if formatPost on an older host omits it. */
function copyReactorCountsToFormatted(rawPosts: any[], formatted: any[]): void {
  const byId = new Map<string, number>();
  for (const p of rawPosts ?? []) {
    if (!p?.id) continue;
    const n =
      typeof p.unique_reactor_count === "number"
        ? p.unique_reactor_count
        : typeof p.uniqueReactorCount === "number"
          ? p.uniqueReactorCount
          : undefined;
    if (typeof n === "number") byId.set(String(p.id), n);
    if (p.original?.id) {
      const on =
        typeof p.original.unique_reactor_count === "number"
          ? p.original.unique_reactor_count
          : typeof p.original.uniqueReactorCount === "number"
            ? p.original.uniqueReactorCount
            : undefined;
      if (typeof on === "number") byId.set(String(p.original.id), on);
    }
  }
  for (const f of formatted ?? []) {
    const n = byId.get(String(f?.id ?? ""));
    if (typeof n === "number") f.uniqueReactorCount = n;
    if (f?.original) {
      const on = byId.get(String(f.original.id ?? ""));
      if (typeof on === "number") f.original.uniqueReactorCount = on;
    }
  }
}

// The set of authors who have privately starred `viewerId` as a close friend.
// Read with the admin client because RLS restricts `close_friends` rows to their
// owner. Used to deliver audience='close' moments only to the author's starred
// close friends. Returns an empty set if the table isn't set up yet (graceful).
async function getWhoStarredMe(viewerId: string): Promise<Set<string>> {
  try {
    // Support both schema variants: user_id (common) and owner_id (older).
    let { data, error } = await supabaseAdmin
      .from("close_friends")
      .select("user_id")
      .eq("friend_id", viewerId);

    if (error || !data) {
      ({ data, error } = await supabaseAdmin
        .from("close_friends")
        .select("owner_id")
        .eq("friend_id", viewerId));
      if (error || !data) return new Set();
      return new Set(data.map((r: any) => r.owner_id).filter(Boolean));
    }
    return new Set(data.map((r: any) => r.user_id).filter(Boolean));
  } catch {
    return new Set();
  }
}

/** People the viewer has privately starred (close_friends owned by viewer). */
async function getMyStarredIds(viewerId: string): Promise<Set<string>> {
  try {
    let { data, error } = await supabaseAdmin
      .from("close_friends")
      .select("friend_id")
      .eq("user_id", viewerId);

    if (error || !data) {
      ({ data, error } = await supabaseAdmin
        .from("close_friends")
        .select("friend_id")
        .eq("owner_id", viewerId));
      if (error || !data) return new Set();
    }
    return new Set(data.map((r: any) => r.friend_id).filter(Boolean));
  } catch {
    return new Set();
  }
}

postsRouter.get("/", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const userClient = createUserClient(token);
  const limit = parseLimit(c.req.query("limit"), 20, 50);
  const cursor = parseCursor(c.req.query("cursor"));
  // Batch is larger than the page so audience filters still fill one page.
  // The database orders each batch before this limit is applied.
  const batchSize = Math.min(Math.max(limit * 3, limit + 10), 80);
  // Feed mode: public | private | starred | all (default = legacy combined feed).
  const modeRaw = String(c.req.query("mode") ?? "").trim().toLowerCase();
  const feedMode: "public" | "private" | "starred" | "all" =
    modeRaw === "public" || modeRaw === "private" || modeRaw === "starred" ? modeRaw : "all";

  // Privacy: own moments, moments from accepted friends, and public moments.
  // Pending friendships never expose moments. Private moments stay with the
  // author. Close-friends moments stay with people that author starred.
  // Parallelize the hot-path lookups that used to run as a waterfall.
  const [friendshipsResult, blockedIds, whoStarredMe, myStarredIds, deletionHidden] = await Promise.all([
    supabaseAdmin
      .from("friendships")
      .select("requester_id, receiver_id")
      .eq("status", "accepted")
      .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`),
    getBlockedIds(userId),
    getWhoStarredMe(userId),
    feedMode === "starred" ? getMyStarredIds(userId) : Promise.resolve(new Set<string>()),
    getDeletionHiddenUserIds(),
  ]);

  const { data: acceptedFriendships, error: friendsErr } = friendshipsResult;
  if (friendsErr) {
    console.error("[posts] friendships query failed:", friendsErr.message);
  }

  const friendIds = (acceptedFriendships ?? []).map((f: any) =>
    f.requester_id === userId ? f.receiver_id : f.requester_id
  );

  // Self + accepted friends. (Always include self even with no friends yet.)
  // Then remove anyone blocked in either direction (self is never blocked).
  const blockedSet = new Set(blockedIds);
  const friendIdSet = new Set(friendIds);
  // Private feed also includes authors who starred the viewer as close friends
  // (Close Circle access does not require friendship).
  const privateAuthorIds = Array.from(
    new Set([userId, ...friendIds, ...whoStarredMe])
  ).filter(
    (id): id is string =>
      typeof id === "string" && id.length > 0 && (id === userId || !blockedSet.has(id))
  );
  const allowedUserIds = Array.from(new Set([userId, ...friendIds])).filter(
    (id): id is string => typeof id === "string" && id.length > 0 && (id === userId || !blockedSet.has(id))
  );
  // Starred feed: publishers the viewer starred. Blocking still excludes them.
  const starredAuthorIds = Array.from(myStarredIds).filter(
    (id): id is string =>
      typeof id === "string" && id.length > 0 && id !== userId && !blockedSet.has(id)
  );
  const visibilityCtx = {
    friendIds: friendIdSet,
    closeAuthorIds: whoStarredMe,
    blockedIds: blockedSet,
    deletionHiddenIds: deletionHidden,
  };

  // Birthday ensure is idempotent but can add latency — run in background so
  // the feed response isn't blocked. Next refresh will pick up new moments.
  void ensureBirthdayMoments(userId, friendIds).catch((e) => {
    console.warn("[posts] birthday ensure failed:", e instanceof Error ? e.message : e);
  });

  const acceptBase = (p: any): boolean => {
    if (!p?.id) return false;
    if (p.is_hidden === true) return false;
    if (p.is_published === false) return false;
    if (p.user_id !== userId && blockedSet.has(p.user_id)) return false;
    if (p.user_id !== userId && deletionHidden.has(p.user_id)) return false;
    return true;
  };

  // Page after ordering. Friend moments and public moments are separate
  // streams so a limited public window cannot push a newer friend moment
  // off the first page, and a refresh without new rows returns the same page.
  let walked;
  try {
    if (feedMode === "public") {
      walked = await walkNewestPage({
        cursor,
        limit,
        batchSize,
        fetchFriends: async () => [],
        fetchPublic: async (pageCursor, size) => {
          try {
            return await fetchNewestMomentBatch(
              (q) => q.eq("audience", "public").eq("is_hidden", false).neq("is_published", false),
              pageCursor,
              size
            );
          } catch (e) {
            console.warn("[posts] public moment window failed:", e instanceof Error ? e.message : e);
            return [];
          }
        },
        accept: (p: any) => {
          if (!acceptBase(p)) return false;
          return normalizeAudience(p.audience) === "public";
        },
      });
    } else if (feedMode === "private") {
      walked = await walkNewestPage({
        cursor,
        limit,
        batchSize,
        fetchFriends: (pageCursor, size) =>
          privateAuthorIds.length === 0
            ? Promise.resolve([])
            : fetchNewestMomentBatch(
                (q) =>
                  q
                    .in("user_id", privateAuthorIds)
                    .eq("is_hidden", false)
                    .neq("is_published", false),
                pageCursor,
                size
              ),
        fetchPublic: async () => [],
        accept: (p: any) => {
          if (!acceptBase(p)) return false;
          const audience = normalizeAudience(p.audience);
          // Public moments belong in the Public tab only.
          if (audience === "public") return false;
          if (p.user_id === userId) {
            // Author sees their own friends/close/only-me moments in Private.
            return audience === "friends" || audience === "close" || audience === "private";
          }
          if (audience === "private") return false;
          if (audience === "close") return whoStarredMe.has(p.user_id);
          return friendIdSet.has(p.user_id);
        },
      });
    } else if (feedMode === "starred") {
      // Moments from people I starred — still gated by audience / friendship /
      // Close Circle / blocks. Starring never grants extra access.
      walked = await walkNewestPage({
        cursor,
        limit,
        batchSize,
        fetchFriends: (pageCursor, size) =>
          starredAuthorIds.length === 0
            ? Promise.resolve([])
            : fetchNewestMomentBatch(
                (q) =>
                  q
                    .in("user_id", starredAuthorIds)
                    .eq("is_hidden", false)
                    .neq("is_published", false),
                pageCursor,
                size
              ),
        fetchPublic: async () => [],
        accept: (p: any) => {
          if (!acceptBase(p)) return false;
          if (!myStarredIds.has(p.user_id)) return false;
          return canViewerSeeMoment(userId, p, visibilityCtx);
        },
      });
    } else {
      walked = await walkNewestPage({
        cursor,
        limit,
        batchSize,
        fetchFriends: (pageCursor, size) =>
          fetchNewestMomentBatch(
            (q) => q.in("user_id", allowedUserIds).eq("is_hidden", false).neq("is_published", false),
            pageCursor,
            size
          ),
        fetchPublic: async (pageCursor, size) => {
          try {
            return await fetchNewestMomentBatch(
              (q) => q.eq("audience", "public").eq("is_hidden", false).neq("is_published", false),
              pageCursor,
              size
            );
          } catch (e) {
            console.warn("[posts] public moment window failed:", e instanceof Error ? e.message : e);
            return [];
          }
        },
        accept: (p: any) => {
          if (!acceptBase(p)) return false;
          if (p.user_id === userId) return true;
          const audience = p.audience ?? "friends";
          if (audience === "private") return false;
          if (audience === "close") return whoStarredMe.has(p.user_id);
          if (audience === "public") return true;
          return friendIdSet.has(p.user_id);
        },
      });
    }
  } catch (e) {
    console.error("[posts] feed query failed:", e instanceof Error ? e.message : e);
    return c.json({ error: { message: "Failed to load moments" } }, 500);
  }

  let ordered: any[] = [];
  try {
    // Skip hydrateReactionProfiles — refreshReactionActors runs after formatPost.
    ordered = await loadPostsByIds(walked.page.map((p) => p.id), {
      hydrateReactions: false,
    });
    await attachOriginals(userClient, ordered, { hydrateReactions: false });
  } catch (e) {
    console.error("[posts] feed hydrate failed:", e instanceof Error ? e.message : e);
    return c.json({ error: { message: "Failed to load moments" } }, 500);
  }

  // Latest preview comment per moment in one batched query (before formatPost).
  await attachCommentPreviews(ordered, userId ?? undefined, blockedIds);
  await safeAttachUniqueReactorCounts(ordered, blockedIds);
  await withPolls(ordered, userId ?? undefined);
  if (userId && ordered.some((p) => p?.original)) {
    // Reuse the friends / close-friends / blocks / deletion sets already loaded above
    // instead of re-querying all four (identical data, same request).
    scrubInvisibleOriginals(ordered, userId, {
      friendIds: friendIdSet,
      closeAuthorIds: whoStarredMe,
      blockedIds: blockedSet,
      deletionHiddenIds: deletionHidden,
    });
  }

  const formatted = ordered.map((p) => formatPost(p, userId ?? undefined, blockedIds));
  copyPollsToFormatted(ordered, formatted);
  copyReactorCountsToFormatted(ordered, formatted);
  // Independent profile lookups — run together instead of back to back.
  await Promise.all([
    refreshFriendshipAvatars(formatted), // always show friends' CURRENT avatars
    refreshReactionActors(formatted), // live names + avatars on likes
  ]);
  return c.json({
    data: formatted,
    nextCursor: walked.nextCursor,
    hasMore: walked.hasMore,
    limit,
  });
});

// Matches #hashtag tokens: latin + accented + Arabic letters, digits, underscore.
// Mirrors the client-side TOKEN_RE in mobile/src/components/RichText.tsx so the
// backend extracts exactly the tokens the app renders as blue hashtags.
const HASHTAG_RE = /#([A-Za-z0-9_À-ɏ؀-ۿ]+)/g;

function extractHashtags(content: string | null | undefined): string[] {
  if (!content) return [];
  const out: string[] = [];
  let m: RegExpExecArray | null;
  HASHTAG_RE.lastIndex = 0;
  while ((m = HASHTAG_RE.exec(content)) !== null) {
    if (m[1]) out.push(m[1].toLowerCase());
  }
  return out;
}

// Compute the viewer's allowed authors: themselves + accepted (mutual) friends.
// This is the SAME privacy boundary the home feed uses.
async function getAllowedAuthorIds(_userClient: any, userId: string): Promise<string[]> {
  const { data: acceptedFriendships } = await supabaseAdmin
    .from("friendships")
    .select("requester_id, receiver_id")
    .eq("status", "accepted")
    .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`);
  const friendIds = (acceptedFriendships ?? []).map((f: any) =>
    f.requester_id === userId ? f.receiver_id : f.requester_id
  );
  return Array.from(new Set([userId, ...friendIds]));
}

// GET /api/posts/hashtags?q=prefix — autocomplete from EXISTING hashtags used
// in the app. Simple prefix match (no semantic/related suggestions). Returns up
// to 10 distinct hashtags (without the leading #), most-used first.
postsRouter.get("/hashtags", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const prefix = (c.req.query("q") ?? "").replace(/^#+/, "").trim().toLowerCase();

  // Prefer the hashtags table (maintained on post create) — avoids scanning 1000 posts.
  let query = supabaseAdmin
    .from("hashtags")
    .select("tag, post_count")
    .order("post_count", { ascending: false })
    .limit(10);
  if (prefix) query = query.ilike("tag", `${prefix}%`);

  const { data: tags, error } = await query;
  if (!error && tags && tags.length > 0) {
    return c.json({
      data: tags.map((t: { tag: string }) => String(t.tag ?? "").replace(/^#/, "").toLowerCase()).filter(Boolean),
    });
  }

  // Fallback for environments without hashtags table / empty table.
  const { data: rows } = await supabaseAdmin
    .from("posts")
    .select("content")
    .ilike("content", "%#%")
    .order("created_at", { ascending: false })
    .limit(200);

  const counts = new Map<string, number>();
  for (const r of rows ?? []) {
    for (const tag of extractHashtags((r as any).content)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  const suggestions = Array.from(counts.entries())
    .filter(([tag]) => (prefix ? tag.startsWith(prefix) : true))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([tag]) => tag);

  return c.json({ data: suggestions });
});

// GET /api/posts/hashtag/:tag — all moments containing :tag, filtered by the
// SAME privacy rules as the home feed (viewer's own + accepted friends'
// moments). Newest first. Never exposes a moment the viewer couldn't see in
// their normal feed.
postsRouter.get("/hashtag/:tag", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const normalized = (c.req.param("tag") ?? "").replace(/^#+/, "").trim().toLowerCase();
  if (!normalized) return c.json({ data: [], nextCursor: null, hasMore: false, limit: 20 });

  const limit = parseLimit(c.req.query("limit"), 20, 50);
  const cursor = parseCursor(c.req.query("cursor"));

  const userClient = createUserClient(token);
  const blockedIds = await getBlockedIds(userId);
  const blockedSet = new Set(blockedIds);
  const allowedUserIds = (await getAllowedAuthorIds(userClient, userId)).filter(
    (id) => id === userId || !blockedSet.has(id)
  );

  // Over-fetch candidates — exact token match + cursor filter happen in JS.
  const fetchLimit = Math.min(Math.max(limit * 4, 40), 200);

  const { data: posts } = await loadPosts((select) => {
    let q = supabaseAdmin
      .from("posts")
      .select(select)
      .in("user_id", allowedUserIds)
      .ilike("content", `%#${normalized}%`)
      .order("created_at", { ascending: false })
      .limit(fetchLimit);
    if (cursor?.createdAt) q = q.lt("created_at", cursor.createdAt);
    return q;
  });

  const matching = (posts ?? []).filter((p: any) => {
    if (!extractHashtags(p.content).includes(normalized)) return false;
    if (!cursor) return true;
    return isOlderThanCursor(String(p.created_at), String(p.id), cursor);
  });

  const hasMore = matching.length > limit;
  const page = hasMore ? matching.slice(0, limit) : matching;
  await attachOriginals(userClient, page);

  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last?.created_at && last?.id
      ? encodeCursor(String(last.created_at), String(last.id))
      : null;

  await attachCommentPreviews(page, userId ?? undefined, blockedIds);
  await safeAttachUniqueReactorCounts(page, blockedIds);
  await withPolls(page, userId ?? undefined);

  const formatted = page.map((p) => formatPost(p, userId ?? undefined, blockedIds));
  copyPollsToFormatted(page, formatted);
  copyReactorCountsToFormatted(page, formatted);
  await refreshReactionActors(formatted);
  return c.json({
    data: formatted,
    nextCursor,
    hasMore,
    limit,
  });
});

// Collect post ids the user has interacted with: reactions, comments, and
// repaths (of someone else's moment). Order is insertion order (first touch).
async function collectInteractedPostIds(userId: string): Promise<string[]> {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const add = (pid: string | null | undefined) => {
    if (pid && !seen.has(pid)) {
      seen.add(pid);
      ordered.push(pid);
    }
  };

  const [reactionsResult, commentsResult, repathsResult] = await Promise.all([
    supabaseAdmin
      .from("reactions")
      .select("post_id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabaseAdmin
      .from("comments")
      .select("post_id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabaseAdmin
      .from("posts")
      .select("repath_of")
      .eq("user_id", userId)
      .not("repath_of", "is", null)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const { data: myReactions, error: reactionsError } = reactionsResult;
  if (reactionsError) {
    console.error("[posts/interacted] reactions query failed:", reactionsError.message);
  } else {
    for (const r of myReactions ?? []) add((r as any).post_id);
  }

  const { data: myComments, error: commentsError } = commentsResult;
  if (commentsError) {
    console.warn("[posts/interacted] comments query failed:", commentsError.message);
  } else {
    for (const row of myComments ?? []) add((row as any).post_id);
  }

  const { data: myRepaths, error: repathError } = repathsResult;
  if (repathError) {
    if (!/repath_of|column/i.test(repathError.message ?? "")) {
      console.warn("[posts/interacted] repaths query failed:", repathError.message);
    }
  } else {
    for (const row of myRepaths ?? []) add((row as any).repath_of);
  }

  return ordered;
}

// Shared handler for /reacted and /interacted.
async function handleInteractedMoments(c: any) {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const userClient = createUserClient(token);
  const offset = Math.max(0, Number.parseInt(String(c.req.query("offset") ?? "0"), 10) || 0);
  const limitParam = c.req.query("limit");
  const paged = limitParam != null;
  const limit = paged
    ? Math.min(60, Math.max(1, Number.parseInt(String(limitParam), 10) || 10))
    : 60;

  const orderedPostIds = (await collectInteractedPostIds(userId)).slice(0, 60);
  if (orderedPostIds.length === 0) {
    if (paged) {
      return c.json({ data: { posts: [], offset, limit, hasMore: false, total: 0 } });
    }
    return c.json({ data: [] });
  }

  const [blockedIds, allowedAuthors] = await Promise.all([
    getBlockedIds(userId),
    getAllowedAuthorIds(userClient, userId),
  ]);
  const blockedSet = new Set(blockedIds);
  const allowedUserIds = new Set(
    allowedAuthors.filter((id) => id === userId || !blockedSet.has(id))
  );

  // Lightweight pass: only id/user/created_at so we can sort + page before
  // hydrating full post payloads (reactions, profiles, originals).
  const { data: metaRows, error: metaError } = await supabaseAdmin
    .from("posts")
    .select("id, user_id, created_at")
    .in("id", orderedPostIds);

  if (metaError) {
    console.error("[posts/reacted] meta query failed:", metaError.message);
    return c.json({ error: { message: "Failed to load liked moments" } }, 500);
  }

  const deletionHidden = await getDeletionHiddenUserIds();
  // Own posts still show even if the author is in the deletion-hidden set.
  const metaFinal = (metaRows ?? []).filter((p: any) => {
    if (!allowedUserIds.has(p.user_id)) return false;
    if (p.user_id === userId) return true;
    return !deletionHidden.has(p.user_id);
  });

  metaFinal.sort(
    (a: any, b: any) =>
      new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
  );

  const total = metaFinal.length;
  const pageMeta = metaFinal.slice(offset, offset + limit);
  const pageIds = pageMeta.map((p: any) => p.id);

  if (pageIds.length === 0) {
    if (paged) {
      return c.json({ data: { posts: [], offset, limit, hasMore: false, total } });
    }
    return c.json({ data: [] });
  }

  const { data: posts, error: postsError } = await loadPosts((select) =>
    supabaseAdmin.from("posts").select(select).in("id", pageIds)
  );

  if (postsError) {
    console.error("[posts/reacted] posts query failed:", postsError.message);
    return c.json({ error: { message: "Failed to load liked moments" } }, 500);
  }

  // Preserve newest-first order from metaFinal.
  const byId = new Map((posts ?? []).map((p: any) => [p.id, p]));
  const orderedPosts = pageIds.map((id) => byId.get(id)).filter(Boolean);
  await attachOriginals(userClient, orderedPosts);

  await attachCommentPreviews(orderedPosts, userId, blockedIds);
  await safeAttachUniqueReactorCounts(orderedPosts, blockedIds);
  await withPolls(orderedPosts, userId);

  const formatted = orderedPosts.map((p: any) => formatPost(p, userId, blockedIds));
  copyPollsToFormatted(orderedPosts, formatted);
  copyReactorCountsToFormatted(orderedPosts, formatted);
  await refreshReactionActors(formatted);
  if (paged) {
    return c.json({
      data: {
        posts: formatted,
        offset,
        limit,
        hasMore: offset + limit < total,
        total,
      },
    });
  }
  return c.json({ data: formatted });
}

// GET /api/posts/reacted — moments the CURRENT user has interacted with
// (reacted, commented, or repathed). Same privacy boundary as the home feed.
postsRouter.get("/reacted", handleInteractedMoments);

// Alias for clarity on the client.
postsRouter.get("/interacted", handleInteractedMoments);

postsRouter.get("/:id", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { id } = c.req.param();
  const userClient = createUserClient(token);
  const { data: rows } = await loadPosts((select) =>
    supabaseAdmin.from("posts").select(select).eq("id", id).limit(1)
  );
  const post = rows[0];

  if (!post) return c.json({ error: { message: "Post not found" } }, 404);

  await attachOriginals(userClient, [post]);

  // Hide moments authored by a blocked user (either direction) entirely.
  const blockedIds = userId ? await getBlockedIds(userId) : [];
  if (post.user_id !== userId && blockedIds.includes(post.user_id)) {
    return c.json({ error: { message: "Post not found" } }, 404);
  }

  // Deletion grace window: author's content is inaccessible to others.
  if (post.user_id !== userId) {
    const hidden = await getDeletionHiddenUserIds();
    if (hidden.has(post.user_id)) {
      return c.json({ error: { message: "Post not found" } }, 404);
    }
  }

  // Moment audience gate — independent of profile privacy.
  const visCtx = userId ? await loadMomentVisibilityContext(userId) : null;
  if (!userId || !visCtx || !canViewerSeeMoment(userId, post, visCtx)) {
    return c.json({ error: { message: "Post not found" } }, 404);
  }

  // Same preview selection as the feed (viewer-priority).
  await attachCommentPreviews([post], userId, blockedIds);
  await safeAttachUniqueReactorCounts([post], blockedIds);
  await withPolls([post], userId);
  scrubInvisibleOriginals([post], userId, visCtx);
  const formatted = formatPost(post, userId, blockedIds);
  copyPollsToFormatted([post], [formatted]);
  copyReactorCountsToFormatted([post], [formatted]);
  await refreshReactionActors([formatted]);
  return c.json({ data: formatted });
});

postsRouter.post("/", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = await c.req.json();
  const userClient = createUserClient(token);

  // Reshare ("Repath"): only set `repath_of` when this is actually a repath.
  if (body.repathOf) {
    const originalId = String(body.repathOf).trim();
    if (!originalId) {
      return c.json({ error: { message: "Invalid repath target" } }, 400);
    }

    const { ensureRepathColumn, ensureRepathUniqueIndex } = await import("../lib/schema");
    const ready = await ensureRepathColumn();
    if (!ready) {
      return c.json({ error: { message: "Repath is temporarily unavailable. Please try again shortly." } }, 503);
    }
    // Best-effort uniqueness; create path still dedupes in application logic.
    void ensureRepathUniqueIndex();

    const { data: target } = await supabaseAdmin
      .from("posts")
      .select("id, user_id, repath_of, audience")
      .eq("id", originalId)
      .maybeSingle();
    if (!target) {
      return c.json({ error: { message: "Original moment not found" } }, 404);
    }

    // Always repath the root moment (one level deep) and notify its owner.
    let rootId = originalId;
    let originalOwnerId = target.user_id as string;
    let rootAudience = (target as { audience?: string | null }).audience ?? null;
    if (target.repath_of) {
      rootId = target.repath_of as string;
      const { data: root } = await supabaseAdmin
        .from("posts")
        .select("id, user_id, audience")
        .eq("id", rootId)
        .maybeSingle();
      if (!root) {
        return c.json({ error: { message: "Original moment not found" } }, 404);
      }
      originalOwnerId = root.user_id as string;
      rootAudience = (root as { audience?: string | null }).audience ?? null;
    }

    if (originalOwnerId === userId) {
      return c.json({ error: { message: "You cannot repath your own moment" } }, 400);
    }

    // Enforce the same visibility / block rules as feed + moment detail.
    const canSeeRoot = await viewerCanAccessMoment(userId, {
      user_id: originalOwnerId,
      audience: rootAudience,
    });
    if (!canSeeRoot) {
      return c.json({ error: { message: "Original moment not found" } }, 404);
    }

    // Idempotent: repeated taps / retries return the existing Repath.
    const { data: existingRepaths } = await supabaseAdmin
      .from("posts")
      .select("id")
      .eq("user_id", userId)
      .eq("repath_of", rootId)
      .order("created_at", { ascending: false })
      .limit(1);
    const existingRepathId = existingRepaths?.[0]?.id as string | undefined;
    if (existingRepathId) {
      let existingPost: any = null;
      const { data: rows } = await loadPosts((select) =>
        supabaseAdmin.from("posts").select(select).eq("id", existingRepathId).limit(1)
      );
      existingPost = rows[0] ?? null;
      if (existingPost?.repath_of) await attachOriginals(userClient, [existingPost]);
      const formattedExisting = formatPost(existingPost, userId);
      await refreshFriendshipAvatars([formattedExisting]);
      await refreshReactionActors([formattedExisting]);
      if (formattedExisting.original) {
        await refreshFriendshipAvatars([formattedExisting.original]);
        await refreshReactionActors([formattedExisting.original]);
      }
      return c.json({ data: formattedExisting }, 200);
    }

    const repathInsert = {
      user_id: userId,
      type: body.type || "thought",
      content: body.content || null,
      repath_of: rootId,
    };

    let { data: post, error } = await supabaseAdmin
      .from("posts")
      .insert(repathInsert)
      .select(POST_SELECT)
      .single();

    if (error && /repath_of|column/i.test(error.message ?? "")) {
      await ensureRepathColumn();
      ({ data: post, error } = await supabaseAdmin
        .from("posts")
        .insert(repathInsert)
        .select(POST_SELECT)
        .single());
    }

    // Unique index race: another request created the same Repath first.
    if (error && /duplicate|unique|idx_posts_user_repath/i.test(error.message ?? "")) {
      const { data: raced } = await supabaseAdmin
        .from("posts")
        .select("id")
        .eq("user_id", userId)
        .eq("repath_of", rootId)
        .order("created_at", { ascending: false })
        .limit(1);
      const racedId = raced?.[0]?.id as string | undefined;
      if (racedId) {
        const { data: rows } = await loadPosts((select) =>
          supabaseAdmin.from("posts").select(select).eq("id", racedId).limit(1)
        );
        post = rows[0] ?? null;
        error = null;
        if (post?.repath_of) await attachOriginals(userClient, [post]);
        const formattedRaced = formatPost(post, userId);
        await refreshFriendshipAvatars([formattedRaced]);
        await refreshReactionActors([formattedRaced]);
        if (formattedRaced.original) {
          await refreshFriendshipAvatars([formattedRaced.original]);
          await refreshReactionActors([formattedRaced.original]);
        }
        return c.json({ data: formattedRaced }, 200);
      }
    }

    if (error) {
      console.error("[posts] repath create error:", error.message);
      return c.json({ error: { message: "Failed to repath moment" } }, 500);
    }

    // Reload via loadPosts so nested profile embeds never leave original blank.
    if (post?.id) {
      const { data: rows } = await loadPosts((select) =>
        supabaseAdmin.from("posts").select(select).eq("id", post.id).limit(1)
      );
      if (rows[0]) post = rows[0];
    }
    if (post?.repath_of) await attachOriginals(userClient, [post]);

    // Notify the original moment owner once per (viewer → root) Repath.
    try {
      if (post?.id && originalOwnerId !== userId) {
        const { data: priorNotifs } = await supabaseAdmin
          .from("notifications")
          .select("id, post_id")
          .eq("user_id", originalOwnerId)
          .eq("from_user_id", userId)
          .eq("type", "repath")
          .order("created_at", { ascending: false })
          .limit(20);

        let notificationId: string | undefined;
        const priorIds = (priorNotifs ?? []).map((n: any) => n.post_id).filter(Boolean);
        if (priorIds.length > 0) {
          const { data: priorRepaths } = await supabaseAdmin
            .from("posts")
            .select("id")
            .in("id", priorIds)
            .eq("repath_of", rootId)
            .limit(1);
          if (priorRepaths?.[0]?.id) {
            notificationId = (priorNotifs ?? []).find(
              (n: any) => n.post_id === priorRepaths[0].id
            )?.id as string | undefined;
          }
        }

        if (!notificationId) {
          const { data: inserted } = await supabaseAdmin.from("notifications").insert({
            user_id: originalOwnerId,
            from_user_id: userId,
            type: "repath",
            message: "repathed your moment",
            post_id: post.id,
            read: false,
          }).select("id").single();
          notificationId = inserted?.id;

          void sendPushToUser(
            supabaseAdmin,
            originalOwnerId,
            "New Repath",
            `${user.full_name} repathed your moment`,
            {
              postId: post.id,
              type: "repath",
              fromUserId: userId,
              notificationId,
            }
          );
        }
      }
    } catch (e) {
      console.error("[notifications] repath insert error:", e);
    }

    const formatted = formatPost(post, userId);
    await refreshFriendshipAvatars([formatted]);
    await refreshReactionActors([formatted]);
    if (formatted.original) {
      await refreshFriendshipAvatars([formatted.original]);
      await refreshReactionActors([formatted.original]);
    }
    return c.json({ data: formatted }, 201);
  }

  // Optional poll — verified accounts only (enforced server-side).
  const wantsPoll = body.poll != null && typeof body.poll === "object";
  let normalizedPoll: { question: string; options: string[] } | null = null;
  if (wantsPoll) {
    const gate = await assertVerifiedForPoll(userId);
    if (!gate.ok) {
      return c.json({ error: { message: gate.message } }, gate.status);
    }
    const parsed = normalizePollPayload(body.poll);
    if (!parsed.ok) {
      return c.json({ error: { message: parsed.message } }, 400);
    }
    normalizedPoll = { question: parsed.question, options: parsed.options };
  }

  // Optional structured location (explicit share). Legacy locationName/Lat/Lng still work.
  const structuredLoc = parseIncomingLocation(body.location ?? body.contentLocation);
  const insertData: Record<string, any> = {
    user_id: userId,
    type: body.type,
    content: body.content || null,
    // Accept either a single `image` (legacy) or an `images` array (up to 6).
    image_url: encodeImages(body.images, body.image),
    location: body.locationName || null,
    location_lat: body.locationLat ?? null,
    location_lng: body.locationLng ?? null,
    venue_category: body.venueCategory || null,
    music_title: body.musicTitle || null,
    music_artist: body.musicArtist || null,
    music_album: body.musicAlbum || null,
    music_mode: body.musicMode || null,
    activity_type: body.activityType || null,
    activity_duration: body.activityDuration || null,
    meal_name: body.mealName || null,
    sleep_action: body.sleepAction || null,
    // sleep_duration is an INTEGER (minutes) column; the client sends "8h 30m".
    // Parse to minutes here so the Awake moment actually inserts.
    sleep_duration: parseDurationToMinutes(body.sleepDuration),
    ...structuredPostLocationColumns(structuredLoc, {
      explicitPlace: !!body.locationName,
      explicitCoords: body.locationLat != null && body.locationLng != null,
      type: body.type,
    }),
  };
  // Prefer explicit legacy fields when structured location was not sent.
  if (!structuredLoc) {
    if (body.locationName) insertData.location = body.locationName;
    if (body.locationLat != null) insertData.location_lat = body.locationLat;
    if (body.locationLng != null) insertData.location_lng = body.locationLng;
  }
  // Audience ("Close Friends" etc.): only set when the client explicitly sends a
  // non-default value, so normal posting still works if the column doesn't exist
  // yet. 'close' delivers only to the author's starred close friends (enforced in
  // the feed query below); 'private' is author-only; 'public'/'friends' behave as
  // today (visible to all accepted friends).
  if (body.audience && body.audience !== "friends") insertData.audience = body.audience;
  // Disable Comments: always persist when the client sends the field (true or
  // false). Requires `comments_disabled` column — see migration 012.
  if ("commentsDisabled" in body) {
    insertData.comments_disabled = body.commentsDisabled === true;
  }

  let { data: post, error } = await userClient
    .from("posts")
    .insert(insertData)
    .select(POST_SELECT)
    .single();

  // If an optional column (audience / comments_disabled / location_*) hasn't been
  // added yet, don't fail the post — strip optional fields and retry.
  if (
    error &&
    ("audience" in insertData ||
      "comments_disabled" in insertData ||
      "location_city" in insertData ||
      "location_shared" in insertData) &&
    /audience|comments_disabled|location_|column/i.test(error.message ?? "")
  ) {
    console.error(
      "[posts] optional column missing on create — run pending migrations:",
      error.message
    );
    const {
      audience: _a,
      comments_disabled: _cd,
      location_city: _lc,
      location_region: _lr,
      location_country: _lco,
      location_accuracy_m: _la,
      location_precision: _lp,
      location_captured_at: _lca,
      location_shared: _ls,
      ...withoutOptional
    } = insertData;
    ({ data: post, error } = await userClient
      .from("posts")
      .insert(withoutOptional)
      .select(POST_SELECT)
      .single());
  }

  if (error) {
    console.error("Create post error:", error);
    return c.json({ error: { message: "Failed to create post" } }, 500);
  }

  // Service-role safety net: if the client asked to disable comments but the
  // inserted row doesn't reflect it (RLS/column quirks), force the flag.
  const wantDisabled = body.commentsDisabled === true;
  if (wantDisabled && post && !(post as any).comments_disabled) {
    const { data: patched, error: patchErr } = await supabaseAdmin
      .from("posts")
      .update({ comments_disabled: true })
      .eq("id", post.id)
      .select(POST_SELECT)
      .maybeSingle();
    if (patchErr) {
      console.error(
        "[posts] failed to set comments_disabled — run migrations/012_posts_audience_comments_disabled.sql:",
        patchErr.message
      );
    } else if (patched) {
      post = patched;
    }
  }

  // Resolve the nested original so the new repath renders immediately.
  if (post?.repath_of) await attachOriginals(userClient, [post]);

  if (body.sleepAction === "sleep") {
    const { data: friends } = await userClient
      .from("friendships")
      .select("requester_id, receiver_id")
      .eq("status", "accepted")
      .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`);

    if (friends && friends.length > 0) {
      const notifications = friends.map((f: any) => ({
        user_id: f.requester_id === userId ? f.receiver_id : f.requester_id,
        from_user_id: userId,
        type: "sleep",
        message: `${user.full_name} is sleeping`,
        post_id: post.id,
        read: false,
      }));
      await userClient.from("notifications").insert(notifications);

      // Push in background — never block create-post on Expo fan-out.
      void Promise.allSettled(
        notifications.map((n: { user_id: string; message: string }) =>
          sendPushToUser(supabaseAdmin, n.user_id, "Sleep Update", n.message, {
            type: "sleep",
            postId: post.id,
            fromUserId: userId,
          })
        )
      );
    }
  }

  // Mentions can be slow (resolve + push); don't hold the create response.
  void notifyMentions({
    authorId: userId,
    authorName: user.full_name,
    content: post.content,
    postId: post.id,
  });

  if (normalizedPoll && post?.id) {
    const created = await createPollForPost({
      postId: post.id,
      userId,
      question: normalizedPoll.question,
      options: normalizedPoll.options,
    });
    if ("error" in created) {
      // Moment already published — surface poll failure without rolling back the Moment
      // (preserves existing clients). Client can retry poll attachment in a future release.
      console.error("[polls] create after post failed:", created.error);
      return c.json(
        { error: { message: "Moment created but poll could not be attached" } },
        500
      );
    }
    await withPolls([post], userId);
  }

  const createdFormatted = formatPost(post, userId);
  copyPollsToFormatted([post], [createdFormatted]);
  return c.json({ data: createdFormatted }, 201);
});

/** POST /api/posts/:id/poll/vote — single-choice vote (auth + visibility). */
postsRouter.post("/:id/poll/vote", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { id } = c.req.param();
  const body = await c.req.json().catch(() => ({}));
  const optionId = typeof body?.optionId === "string" ? body.optionId.trim() : "";
  if (!optionId) return c.json({ error: { message: "optionId is required" } }, 400);

  const { data: post } = await supabaseAdmin
    .from("posts")
    .select("id, user_id, audience")
    .eq("id", id)
    .maybeSingle();
  if (!post || !(await viewerCanAccessMoment(userId, post))) {
    return c.json({ error: { message: "Post not found" } }, 404);
  }

  const { data: poll } = await supabaseAdmin
    .from("polls")
    .select("id")
    .eq("post_id", id)
    .maybeSingle();
  if (!poll) return c.json({ error: { message: "Poll not found" } }, 404);

  const result = await castPollVote({
    pollId: poll.id,
    optionId,
    userId,
  });
  if ("error" in result) {
    return c.json({ error: { message: result.error } }, result.status as 400 | 404 | 500);
  }
  return c.json({ data: result.poll });
});

postsRouter.patch("/:id", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { id } = c.req.param();
  const userClient = createUserClient(token);

  const { data: existingPost } = await userClient
    .from("posts")
    .select("id, user_id, type")
    .eq("id", id)
    .maybeSingle();

  if (!existingPost) return c.json({ error: { message: "Post not found" } }, 404);
  if (existingPost.user_id !== userId) return c.json({ error: { message: "Forbidden" } }, 403);
  if (SYSTEM_MOMENT_TYPES.includes(existingPost.type)) return c.json({ error: { message: "This moment cannot be edited" } }, 403);

  const body = await c.req.json();
  const updateData: Record<string, unknown> = {};
  if ("content" in body) updateData.content = body.content || null;
  if ("image" in body || "images" in body) updateData.image_url = encodeImages(body.images, body.image);
  // Location (check-in): allow adding, changing, or clearing (null) on edit.
  // Never invent location from another user/Moment — only apply fields the owner sends.
  if ("locationName" in body) updateData.location = body.locationName || null;
  if ("locationLat" in body) updateData.location_lat = body.locationLat ?? null;
  if ("locationLng" in body) updateData.location_lng = body.locationLng ?? null;
  const editLoc = parseIncomingLocation(body.location ?? body.contentLocation);
  if (editLoc) {
    Object.assign(
      updateData,
      structuredPostLocationColumns(editLoc, {
        explicitPlace: !!body.locationName,
        explicitCoords: body.locationLat != null && body.locationLng != null,
        type: existingPost.type,
      })
    );
  }
  if (body.clearLocation === true) {
    updateData.location = null;
    updateData.location_lat = null;
    updateData.location_lng = null;
    updateData.location_city = null;
    updateData.location_region = null;
    updateData.location_country = null;
    updateData.location_accuracy_m = null;
    updateData.location_precision = null;
    updateData.location_captured_at = null;
    updateData.location_shared = false;
  }
  // Audience: same delivery-scope values as create. Default missing/empty to
  // "friends" so we never write null into the column.
  if ("audience" in body) updateData.audience = body.audience || "friends";
  // Disable Comments: persist the boolean when the client sends it.
  if ("commentsDisabled" in body) updateData.comments_disabled = !!body.commentsDisabled;

  const SELECT = "*, profiles!user_id(*), reactions(user_id, type)";
  let { data: updated, error } = await userClient
    .from("posts")
    .update(updateData)
    .eq("id", id)
    .select(SELECT)
    .single();

  // Degrade safely if an optional column (audience / comments_disabled) hasn't
  // been added yet — retry without it so the rest of the edit (caption, photos,
  // location) still saves.
  if (
    error &&
    ("audience" in updateData || "comments_disabled" in updateData) &&
    /audience|comments_disabled|column/i.test(error.message ?? "")
  ) {
    console.error(
      "[posts] optional column missing on update — run migrations/012_posts_audience_comments_disabled.sql:",
      error.message
    );
    const { audience: _a, comments_disabled: _cd, ...withoutOptional } = updateData;
    ({ data: updated, error } = await userClient
      .from("posts")
      .update(withoutOptional)
      .eq("id", id)
      .select(SELECT)
      .single());
  }

  if (error) {
    console.error("Update post error:", error);
    return c.json({ error: { message: "Failed to update post" } }, 500);
  }

  // Force comments_disabled via service role when the client asked for it but
  // the user-scoped update didn't stick (missing column / RLS).
  if ("commentsDisabled" in body && updated) {
    const want = !!body.commentsDisabled;
    if (!!(updated as any).comments_disabled !== want) {
      const { data: patched, error: patchErr } = await supabaseAdmin
        .from("posts")
        .update({ comments_disabled: want })
        .eq("id", id)
        .select(SELECT)
        .maybeSingle();
      if (patchErr) {
        console.error(
          "[posts] failed to patch comments_disabled — run migrations/012_posts_audience_comments_disabled.sql:",
          patchErr.message
        );
      } else if (patched) {
        updated = patched;
      }
    }
  }

  return c.json({ data: formatPost(updated, userId) });
});

postsRouter.delete("/:id", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { id } = c.req.param();
  const userClient = createUserClient(token);

  const { data: post } = await userClient
    .from("posts")
    .select("id, user_id, type, repath_of")
    .eq("id", id)
    .maybeSingle();

  if (!post) return c.json({ error: { message: "Post not found" } }, 404);
  if (post.user_id !== userId) return c.json({ error: { message: "Forbidden" } }, 403);
  if (SYSTEM_MOMENT_TYPES.includes(post.type)) return c.json({ error: { message: "This moment cannot be deleted" } }, 403);

  const { error } = await userClient.from("posts").delete().eq("id", id);
  if (error) {
    console.error("Delete post error:", error);
    return c.json({ error: { message: "Failed to delete post" } }, 500);
  }

  // Removing a Repath (or any moment) must not leave stale activity rows.
  try {
    await supabaseAdmin.from("notifications").delete().eq("post_id", id);
  } catch (e) {
    console.warn(
      "[posts] notification cleanup after delete failed:",
      e instanceof Error ? e.message : e
    );
  }

  return c.json({ data: null });
});

/**
 * GET /api/posts/:id/reactors — paginated unique public reactors (newest first).
 * Returns `total` = unique public reactor count (not reaction-row count).
 * Query: ?limit=&cursor=  where cursor is `${createdAt}|${userId}`.
 */
postsRouter.get("/:id/reactors", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { id } = c.req.param();
  const limitRaw = Number(c.req.query("limit") ?? 40);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 40, 1), 100);
  const cursorRaw = String(c.req.query("cursor") ?? "").trim();

  const { data: post } = await supabaseAdmin
    .from("posts")
    .select("id, user_id, audience")
    .eq("id", id)
    .maybeSingle();
  if (!post || !(await viewerCanAccessMoment(userId, post))) {
    return c.json({ error: { message: "Post not found" } }, 404);
  }

  try {
    const page = await listUniquePublicReactors({
      postId: id,
      viewerId: userId,
      blockedIds: await getBlockedIds(userId),
      limit,
      cursorRaw: cursorRaw || undefined,
    });
    return c.json({
      data: page.data,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      total: page.total,
      limit,
    });
  } catch (e) {
    console.error("[posts/reactors] failed:", e instanceof Error ? e.message : e);
    return c.json({ error: { message: "Failed to load reactors" } }, 500);
  }
});

postsRouter.post("/:id/reactions", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { id } = c.req.param();
  const { type } = await c.req.json();
  const userClient = createUserClient(token);

  const { data: targetMoment } = await supabaseAdmin
    .from("posts")
    .select("id, user_id, audience")
    .eq("id", id)
    .maybeSingle();
  if (!targetMoment || !(await viewerCanAccessMoment(userId, targetMoment))) {
    return c.json({ error: { message: "Post not found" } }, 404);
  }

  // The client always sends a plain emoji; normalize defensively.
  const incoming = baseReactionType(type);

  // Use admin client to bypass RLS and safely handle any existing duplicates.
  // Avoid ordering by created_at — that column is missing on older schemas.
  const { data: existing } = await supabaseAdmin
    .from("reactions")
    .select("id, type")
    .eq("post_id", id)
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  // Track whether this call actually ADDED a reaction (vs toggled one off), so
  // we only notify the owner on a genuine new reaction.
  let didReact = false;
  if (existing) {
    // Delete ALL reactions for this user+post (cleans up any historical duplicates too)
    await supabaseAdmin.from("reactions").delete().eq("post_id", id).eq("user_id", userId);
    if (baseReactionType(existing.type) !== incoming) {
      // Different emoji → switch to the new one (a fresh reaction is public/unlocked)
      await supabaseAdmin.from("reactions").insert({ post_id: id, user_id: userId, type: incoming });
      didReact = true;
    }
    // Same emoji → already deleted above (toggle off; any lock is cleared with it)
  } else {
    await supabaseAdmin.from("reactions").insert({ post_id: id, user_id: userId, type: incoming });
    didReact = true;
  }

  // Notify the post owner (activity feed + push), never about their own action,
  // and only when a reaction was actually added. Removing a like deletes the
  // prior reaction notification so Moment text never lingers as stale "sensitive"
  // preview data. The sheep (🐑) from a sleep moment reads as "sent you a sheep".
  try {
    const { data: postOwner } = await supabaseAdmin.from("posts").select("user_id, content").eq("id", id).maybeSingle();
    if (postOwner && postOwner.user_id !== userId) {
      // Keep denormalized profile like_count in sync for visitors.
      let delta = 0;
      if (!existing && didReact) delta = 1;
      else if (existing && !didReact) delta = -1;
      if (delta !== 0) {
        const { data: row } = await supabaseAdmin
          .from("profiles")
          .select("like_count")
          .eq("id", postOwner.user_id)
          .maybeSingle();
        const next = Math.max(0, (Number((row as any)?.like_count) || 0) + delta);
        await supabaseAdmin.from("profiles").update({ like_count: next }).eq("id", postOwner.user_id);
      }

      // Clear prior like notices for this actor+moment (unlike OR emoji switch).
      // Keep "X is sleeping" alerts (also type=sleep) — only remove sheep likes.
      await supabaseAdmin
        .from("notifications")
        .delete()
        .eq("user_id", postOwner.user_id)
        .eq("from_user_id", userId)
        .eq("post_id", id)
        .eq("type", "reaction");
      await supabaseAdmin
        .from("notifications")
        .delete()
        .eq("user_id", postOwner.user_id)
        .eq("from_user_id", userId)
        .eq("post_id", id)
        .eq("type", "sleep")
        .ilike("message", "%sheep%");
    }
    if (didReact && postOwner && postOwner.user_id !== userId) {
      const isSheep = incoming === "🐑";
      // Do not embed Moment text in push/body — avoids leaking caption content via notices.
      const { data: inserted } = await supabaseAdmin.from("notifications").insert({
        user_id: postOwner.user_id,
        from_user_id: userId,
        type: isSheep ? "sleep" : "reaction",
        message: isSheep ? "sent you a sheep" : "liked your Moment",
        post_id: id,
        read: false,
      }).select("id").single();

      void sendPushToUser(
        supabaseAdmin,
        postOwner.user_id,
        isSheep ? "New Sheep" : "New Reaction",
        isSheep
          ? `${user.full_name} sent you a sheep`
          : `${user.full_name} liked your Moment`,
        {
          postId: id,
          type: isSheep ? "sleep" : "reaction",
          fromUserId: userId,
          notificationId: inserted?.id,
        }
      );
    }
  } catch (e) {
    console.error("[notifications] reaction insert error:", e);
  }

  const { data: ownerRow } = await supabaseAdmin.from("posts").select("user_id").eq("id", id).maybeSingle();

  // A reaction implies the friend saw the moment — persist a read receipt so
  // removing an open/locked like returns their avatar to the Seen row.
  if (didReact && ownerRow?.user_id && ownerRow.user_id !== userId) {
    try {
      await supabaseAdmin.from("post_views").upsert(
        { post_id: id, user_id: userId, viewed_at: new Date().toISOString() },
        { onConflict: "post_id,user_id", ignoreDuplicates: true }
      );
    } catch (e) {
      console.error("[post_views] reaction view upsert error:", e);
    }
  }

  const { data: reactions } = await supabaseAdmin
    .from("reactions")
    .select("user_id, type")
    .eq("post_id", id);
  // Attach live profiles (nested embeds are unreliable for reactor names).
  const { hydrateReactionProfiles } = await import("../lib/load-posts");
  const shell = [{ reactions: reactions ?? [] }];
  await hydrateReactionProfiles(shell);
  const formatted = {
    reactions: formatReactions(shell[0].reactions ?? [], userId, ownerRow?.user_id),
  };
  await refreshReactionActors([formatted]);
  return c.json({ data: { reactions: formatted.reactions } });
});

// Toggle the privacy lock on the current user's reaction for a post.
// Locked = visible only to the reactor and the moment owner. Independent of
// the emoji itself (locking never removes the reaction).
postsRouter.post("/:id/reactions/lock", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { id } = c.req.param();

  const { data: lockTarget } = await supabaseAdmin
    .from("posts")
    .select("id, user_id, audience")
    .eq("id", id)
    .maybeSingle();
  if (!lockTarget || !(await viewerCanAccessMoment(userId, lockTarget))) {
    return c.json({ error: { message: "Post not found" } }, 404);
  }

  const { data: existing } = await supabaseAdmin
    .from("reactions")
    .select("id, type")
    .eq("post_id", id)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!existing) return c.json({ error: { message: "No reaction to lock" } }, 400);

  const nextLocked = !isReactionLocked(existing.type);
  const newType = nextLocked ? lockedReactionType(existing.type) : baseReactionType(existing.type);
  await supabaseAdmin.from("reactions").update({ type: newType }).eq("post_id", id).eq("user_id", userId);

  const { data: ownerRow } = await supabaseAdmin.from("posts").select("user_id").eq("id", id).maybeSingle();
  const { data: reactions } = await supabaseAdmin
    .from("reactions")
    .select("user_id, type")
    .eq("post_id", id);
  const { hydrateReactionProfiles } = await import("../lib/load-posts");
  const shell = [{ reactions: reactions ?? [] }];
  await hydrateReactionProfiles(shell);
  const formatted = {
    reactions: formatReactions(shell[0].reactions ?? [], userId, ownerRow?.user_id),
  };
  await refreshReactionActors([formatted]);
  return c.json({ data: { locked: nextLocked, reactions: formatted.reactions } });
});

// Record that the current viewer has SEEN this moment (read receipt).
// Called by the client when a moment becomes actually visible on screen.
// The unique(post_id, user_id) constraint makes repeat views a no-op, and the
// owner viewing their OWN moment is never recorded.
postsRouter.post("/:id/view", viewLimiter, async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  // Shed view writes immediately while Disk I/O circuit is open.
  if (isSupabaseCircuitOpen()) return c.body(null, 204);

  const { id } = c.req.param();

  const { data: ownerRow } = await supabaseAdmin
    .from("posts")
    .select("user_id, audience")
    .eq("id", id)
    .maybeSingle();
  if (!ownerRow || !(await viewerCanAccessMoment(userId, ownerRow))) {
    return c.json({ error: { message: "Post not found" } }, 404);
  }
  if (!ownerRow) return c.json({ error: { message: "Post not found" } }, 404);
  // The author seeing their own moment is not a "view".
  if (ownerRow.user_id === userId) return c.body(null, 204);

  // Upsert; ignoreDuplicates means each viewer is recorded at most once.
  const { error: viewErr } = await supabaseAdmin
    .from("post_views")
    .upsert(
      { post_id: id, user_id: userId, viewed_at: new Date().toISOString() },
      { onConflict: "post_id,user_id", ignoreDuplicates: true }
    );
  if (viewErr) {
    try {
      const { ensurePostViewsTable } = await import("../lib/schema");
      await ensurePostViewsTable();
      await supabaseAdmin
        .from("post_views")
        .upsert(
          { post_id: id, user_id: userId, viewed_at: new Date().toISOString() },
          { onConflict: "post_id,user_id", ignoreDuplicates: true }
        );
    } catch (e) {
      console.warn("[post_views] retry failed:", e instanceof Error ? e.message : e);
    }
  }

  return c.body(null, 204);
});

// Read receipts for a moment — OWNER ONLY. Returns the real "Seen by X of Y"
// data: X = distinct accepted friends who viewed it, Y = total accepted friends
// (the audience), and the viewers (friends who actually viewed) for the grid.
postsRouter.get("/:id/views", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { id } = c.req.param();

  const { data: ownerRow } = await supabaseAdmin.from("posts").select("user_id").eq("id", id).maybeSingle();
  if (!ownerRow) return c.json({ error: { message: "Post not found" } }, 404);
  if (ownerRow.user_id !== userId) return c.json({ error: { message: "Forbidden" } }, 403);

  // The audience = the owner's accepted (mutual) friends.
  const { data: acceptedFriendships } = await supabaseAdmin
    .from("friendships")
    .select("requester_id, receiver_id")
    .eq("status", "accepted")
    .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`);

  const friendIds = (acceptedFriendships ?? []).map((f: any) =>
    f.requester_id === userId ? f.receiver_id : f.requester_id
  );
  const friendTotal = friendIds.length;

  if (friendIds.length === 0) {
    return c.json({ data: { seenCount: 0, friendTotal: 0, viewers: [] } });
  }

  // Distinct accepted friends who viewed this moment (most recent first).
  const { data: views } = await supabaseAdmin
    .from("post_views")
    .select("user_id, viewed_at")
    .eq("post_id", id)
    .in("user_id", friendIds)
    .order("viewed_at", { ascending: false });

  const viewerIds = (views ?? []).map((v: any) => v.user_id);
  let profilesById: Record<string, any> = {};
  if (viewerIds.length > 0) {
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, username, avatar_url, gender")
      .in("id", viewerIds);
    profilesById = Object.fromEntries((profs ?? []).map((p: any) => [p.id, p]));
  }

  const viewers = (views ?? []).map((v: any) => {
    const p = profilesById[v.user_id];
    const name = String(p?.full_name ?? "").trim();
    const username = String(p?.username ?? "").trim();
    return {
      userId: v.user_id,
      userName: name || username,
      username,
      userAvatar: resolveAvatarUrl(v.user_id, p?.avatar_url, p?.gender),
    };
  });

  return c.json({ data: { seenCount: viewers.length, friendTotal, viewers } });
});

async function isAcceptedFriend(viewerId: string, authorId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("friendships")
    .select("id")
    .eq("status", "accepted")
    .or(
      `and(requester_id.eq.${viewerId},receiver_id.eq.${authorId}),and(requester_id.eq.${authorId},receiver_id.eq.${viewerId})`
    )
    .maybeSingle();
  return !!data;
}

async function canViewerSeeComment(
  viewerId: string | undefined,
  postRow: { user_id: string; audience?: string | null },
  commentAuthorId: string,
  whoStarredViewer: Set<string>
): Promise<boolean> {
  if (!viewerId) return false;
  const ownerId = postRow.user_id;
  if (viewerId === ownerId || viewerId === commentAuthorId) return true;

  const audience = postRow.audience ?? "friends";
  if (audience === "private") return false;
  if (audience === "close") return whoStarredViewer.has(ownerId);
  if (audience === "public") return true;
  return isAcceptedFriend(viewerId, ownerId);
}

postsRouter.get("/:id/comments", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { id } = c.req.param();
  const limit = parseLimit(c.req.query("limit"), 30, 100);
  // `before` / `cursor` = load older comments (exclusive). First page = newest.
  const beforeRaw = c.req.query("before") ?? c.req.query("cursor");
  const beforeCursor = parseCursor(beforeRaw);
  // Incremental sync: comments created/updated after this ISO timestamp.
  const sinceRaw = String(c.req.query("since") ?? "").trim();
  const sinceIso = sinceRaw && !Number.isNaN(Date.parse(sinceRaw)) ? sinceRaw : null;

  const { data: postRow } = await supabaseAdmin
    .from("posts")
    .select("user_id, audience")
    .eq("id", id)
    .maybeSingle();

  if (!postRow) return c.json({ error: { message: "Post not found" } }, 404);
  if (!(await viewerCanAccessMoment(userId, postRow))) {
    return c.json({ error: { message: "Post not found" } }, 404);
  }

  const whoStarredMe = userId ? await getWhoStarredMe(userId) : new Set<string>();

  // Newest-first keyset fetch (limit+1), then reverse to ascending for display.
  // Order is (created_at DESC, id DESC) and the cursor is STRICT (<), so the
  // cursor row (already delivered on the previous page) never takes a slot.
  // When `since` is set, return only rows created/updated after that time
  // (ascending) for efficient 5s polling without re-downloading the whole page.
  const buildCommentsQuery = (select: string) => {
    let q = supabaseAdmin
      .from("comments")
      .select(select)
      .eq("post_id", id);
    if (sinceIso) {
      // New + recently-edited rows for the 5s poller.
      q = q
        .or(`created_at.gt.${sinceIso},updated_at.gt.${sinceIso}`)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(limit + 1);
      return q;
    }
    q = q
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1);
    if (beforeCursor?.createdAt) {
      if (beforeCursor.id) {
        q = q.or(
          `created_at.lt.${beforeCursor.createdAt},and(created_at.eq.${beforeCursor.createdAt},id.lt.${beforeCursor.id})`
        );
      } else {
        q = q.lt("created_at", beforeCursor.createdAt);
      }
    }
    return q;
  };

  let { data: commentsNewestFirst, error } = await buildCommentsQuery(COMMENT_LIST_SELECT);
  if (error && /parent_comment_id|column/i.test(error.message ?? "")) {
    const { ensureCommentParentColumn } = await import("../lib/schema");
    await ensureCommentParentColumn();
    ({ data: commentsNewestFirst, error } = await buildCommentsQuery(COMMENT_LIST_SELECT_NO_PARENT));
  }
  if (error && /updated_at|column/i.test(error.message ?? "")) {
    // Retry without updated_at in select / since filter.
    const buildCreatedOnly = (select: string) => {
      let q = supabaseAdmin.from("comments").select(select).eq("post_id", id);
      if (sinceIso) {
        return q
          .gt("created_at", sinceIso)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .limit(limit + 1);
      }
      return buildCommentsQuery(select.replace(", updated_at", ""));
    };
    ({ data: commentsNewestFirst, error } = await buildCreatedOnly(
      COMMENT_LIST_SELECT_NO_PARENT.replace(", updated_at", "")
    ));
  }
  if (error && /location_|column/i.test(error.message ?? "")) {
    ({ data: commentsNewestFirst, error } = await buildCommentsQuery(COMMENT_LIST_SELECT_LEGACY));
  }

  if (error) {
    console.error("Get comments error:", error);
    return c.json({ error: { message: "Failed to fetch comments" } }, 500);
  }

  // hasMore / cursor come from the RAW fetch so blocked / hidden comments
  // cannot shrink the page and falsely signal "no more".
  const rawRows: any[] = (commentsNewestFirst as any[] | null) ?? [];
  const hasMore = rawRows.length > limit;
  const rawPage = hasMore ? rawRows.slice(0, limit) : rawRows;
  // For newest-first pages the last raw row is the oldest (pagination cursor).
  // For `since` (ascending) pages, do not expose a before-cursor — clients sync by timestamp.
  const rawOldest = !sinceIso && rawPage.length > 0 ? rawPage[rawPage.length - 1] : null;
  const nextCursor =
    !sinceIso && hasMore && rawOldest?.created_at && rawOldest?.id
      ? encodeCursor(String(rawOldest.created_at), String(rawOldest.id))
      : null;

  const blockedSet = userId ? new Set(await getBlockedIds(userId)) : null;

  // Friendship vs post owner is the same for every comment on a friends-audience
  // post — resolve once instead of N identical DB round-trips.
  const audience = postRow.audience ?? "friends";
  let friendsOk = true;
  if (audience === "friends" && userId && userId !== postRow.user_id) {
    friendsOk = await isAcceptedFriend(userId, postRow.user_id);
  }

  const visibleComments: any[] = [];
  for (const comment of rawPage) {
    if (blockedSet?.has(comment.user_id)) continue;
    if (!userId) continue;
    if (userId === postRow.user_id || userId === comment.user_id) {
      visibleComments.push(comment);
      continue;
    }
    if (audience === "private") continue;
    if (audience === "close") {
      if (whoStarredMe.has(postRow.user_id)) visibleComments.push(comment);
      continue;
    }
    if (audience === "public") {
      visibleComments.push(comment);
      continue;
    }
    // friends (default)
    if (friendsOk) visibleComments.push(comment);
  }

  // Ascending within the page (oldest → newest) for CommentsSheet.
  // `since` queries are already ascending.
  const page = sinceIso ? visibleComments : visibleComments.slice().reverse();
  const formatted = page.map((comment: any) => formatCommentRow(comment));

  return c.json({ data: formatted, nextCursor, hasMore, limit });
});

postsRouter.post("/:id/comments", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  if (!user || !userId) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { id } = c.req.param();
  const body = await c.req.json();
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!content) {
    return c.json({ error: { message: "Comment text is required" } }, 400);
  }

  // Block commenting when the moment's author turned comments off.
  // Service role so RLS can't hide the comments_disabled flag.
  const { data: targetPost } = await supabaseAdmin
    .from("posts")
    .select("id, comments_disabled, user_id, audience, content, comment_count")
    .eq("id", id)
    .maybeSingle();
  if (!targetPost || !(await viewerCanAccessMoment(userId, targetPost))) {
    return c.json({ error: { message: "Post not found" } }, 404);
  }
  if (targetPost.comments_disabled) {
    return c.json({ error: { message: "Comments are turned off for this moment" } }, 403);
  }

  // Optional nested reply — parent must belong to this same Moment.
  const parentRaw =
    typeof body?.parentCommentId === "string"
      ? body.parentCommentId.trim()
      : typeof body?.parent_comment_id === "string"
        ? body.parent_comment_id.trim()
        : "";
  let parentCommentId: string | null = null;
  let parentAuthorId: string | null = null;
  if (parentRaw) {
    const { ensureCommentParentColumn } = await import("../lib/schema");
    await ensureCommentParentColumn();
    const { data: parentRow } = await supabaseAdmin
      .from("comments")
      .select("id, post_id, user_id")
      .eq("id", parentRaw)
      .maybeSingle();
    if (!parentRow || parentRow.post_id !== id) {
      return c.json({ error: { message: "Parent comment not found" } }, 404);
    }
    parentCommentId = parentRow.id as string;
    parentAuthorId = parentRow.user_id as string;
  }

  // Comment location is independent of the Moment's location — never copy it.
  const commentLoc = parseIncomingLocation(body.location ?? body.contentLocation);
  const insertRow: Record<string, unknown> = {
    id: crypto.randomUUID(),
    post_id: id,
    user_id: userId,
    content,
    ...(parentCommentId ? { parent_comment_id: parentCommentId } : {}),
    ...commentLocationColumns(commentLoc),
  };

  let { data: comment, error } = await supabaseAdmin
    .from("comments")
    .insert(insertRow)
    .select(
      "id, post_id, user_id, content, created_at, parent_comment_id, location_label, location_city, location_region, location_country, location_precision, location_captured_at, location_shared"
    )
    .single();

  // If location / parent columns are not migrated yet, degrade safely.
  if (error && /parent_comment_id|column/i.test(error.message ?? "")) {
    const { ensureCommentParentColumn } = await import("../lib/schema");
    await ensureCommentParentColumn();
    ({ data: comment, error } = await supabaseAdmin
      .from("comments")
      .insert(insertRow)
      .select(
        "id, post_id, user_id, content, created_at, parent_comment_id, location_label, location_city, location_region, location_country, location_precision, location_captured_at, location_shared"
      )
      .single());
  }
  if (error && /location_|column/i.test(error.message ?? "")) {
    const bare: Record<string, unknown> = {
      id: insertRow.id,
      post_id: id,
      user_id: userId,
      content,
      ...(parentCommentId ? { parent_comment_id: parentCommentId } : {}),
    };
    ({ data: comment, error } = await supabaseAdmin
      .from("comments")
      .insert(bare)
      .select("id, post_id, user_id, content, created_at, parent_comment_id")
      .single());
    if (error && /parent_comment_id|column/i.test(error.message ?? "")) {
      ({ data: comment, error } = await supabaseAdmin
        .from("comments")
        .insert({ id: insertRow.id, post_id: id, user_id: userId, content })
        .select("id, post_id, user_id, content, created_at")
        .single());
    }
  }

  if (error || !comment) {
    console.error("Create comment error:", error);
    return c.json({ error: { message: "Failed to create comment" } }, 500);
  }

  // Respond immediately with the created comment. Count bump, notifications,
  // push, and mentions run after the response so the mobile UI feels instant.
  const formatted = formatCommentRow({
    ...comment,
    profiles: {
      full_name: user.full_name,
      username: user.username,
      avatar_url: user.avatar_url,
      gender: user.gender,
      is_verified: user.is_verified,
    },
  });

  void (async () => {
    try {
      await supabaseAdmin
        .from("posts")
        .update({ comment_count: (targetPost.comment_count ?? 0) + 1 })
        .eq("id", id);
    } catch (e) {
      console.error("[comments] count bump error:", e);
    }

    try {
      const replySnippet = halfLineSnippet(content);
      const momentSnippet = halfLineSnippet(targetPost.content);
      const recipients = new Map<
        string,
        { type: "reply" | "comment"; message: string; title: string; body: string }
      >();

      if (parentCommentId && parentAuthorId && parentAuthorId !== userId) {
        recipients.set(parentAuthorId, {
          type: "reply",
          message: "replied to your comment",
          title: "New Reply",
          body: replySnippet
            ? `${user.full_name} replied: ${replySnippet}`
            : `${user.full_name} replied to your comment`,
        });
      }

      if (targetPost.user_id !== userId) {
        // One notification per recipient — if owner is also the parent author, keep reply.
        if (!recipients.has(targetPost.user_id)) {
          recipients.set(targetPost.user_id, {
            type: parentCommentId ? "reply" : "comment",
            message: parentCommentId ? "replied on your moment" : "commented on your moment",
            title: parentCommentId ? "New Reply" : "New Comment",
            body: parentCommentId
              ? replySnippet
                ? `${user.full_name} replied: ${replySnippet}`
                : `${user.full_name} replied on your Moment`
              : momentSnippet
                ? `${user.full_name} commented on your Moment ${momentSnippet}`
                : `${user.full_name} commented on your Moment`,
          });
        }
      }

      for (const [recipientId, payload] of recipients) {
        // Dedupe retries: same actor + type + comment_id.
        const { data: existing } = await supabaseAdmin
          .from("notifications")
          .select("id")
          .eq("user_id", recipientId)
          .eq("from_user_id", userId)
          .eq("type", payload.type)
          .eq("comment_id", comment.id)
          .maybeSingle();

        let notificationId = existing?.id as string | undefined;
        if (!notificationId) {
          const withComment = await supabaseAdmin
            .from("notifications")
            .insert({
              user_id: recipientId,
              from_user_id: userId,
              type: payload.type,
              message: payload.message,
              post_id: id,
              comment_id: comment.id,
              read: false,
            })
            .select("id")
            .single();
          if (withComment.error && /comment_id|column/i.test(withComment.error.message ?? "")) {
            const fallback = await supabaseAdmin
              .from("notifications")
              .insert({
                user_id: recipientId,
                from_user_id: userId,
                type: payload.type,
                message: payload.message,
                post_id: id,
                read: false,
              })
              .select("id")
              .single();
            notificationId = fallback.data?.id;
          } else {
            notificationId = withComment.data?.id;
          }
        }

        void sendPushToUser(supabaseAdmin, recipientId, payload.title, payload.body, {
          postId: id,
          commentId: comment.id,
          type: payload.type,
          fromUserId: userId,
          notificationId,
        });
      }
    } catch (e) {
      console.error("[notifications] comment/reply insert error:", e);
    }

    void notifyMentions({
      authorId: userId,
      authorName: user.full_name,
      content: comment.content,
      postId: id,
      commentId: comment.id,
    });
  })();

  return c.json({ data: formatted }, 201);
});

postsRouter.delete("/:id/comments/:commentId", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { id, commentId } = c.req.param();
  const userClient = createUserClient(token);

  const { data: comment, error: fetchError } = await supabaseAdmin
    .from("comments")
    .select("id, post_id, user_id")
    .eq("id", commentId)
    .maybeSingle();

  if (fetchError || !comment || comment.post_id !== id) {
    return c.json({ error: { message: "Comment not found" } }, 404);
  }

  // Delete permission: ONLY the comment's original author (not the moment owner).
  if (comment.user_id !== userId) {
    return c.json({ error: { message: "Forbidden" } }, 403);
  }

  const { error: deleteError } = await supabaseAdmin
    .from("comments")
    .delete()
    .eq("id", commentId);

  if (deleteError) {
    console.error("Delete comment error:", deleteError);
    return c.json({ error: { message: "Failed to delete comment" } }, 500);
  }

  // Service role so non-owners (comment authors) can update the count under RLS.
  const { data: postData } = await supabaseAdmin
    .from("posts")
    .select("comment_count")
    .eq("id", id)
    .single();

  if (postData) {
    await supabaseAdmin
      .from("posts")
      .update({ comment_count: Math.max((postData.comment_count ?? 1) - 1, 0) })
      .eq("id", id);
  }

  return c.json({ data: null });
});

postsRouter.patch("/:id/comments/:commentId", async (c) => {
  const user = c.get("user");
  const userId = c.get("userId");
  const token = c.get("accessToken");
  if (!user || !userId || !token) return c.json({ error: { message: "Unauthorized" } }, 401);

  const { id, commentId } = c.req.param();
  const body = await c.req.json();
  const content = (body?.content ?? "").toString().trim();
  if (!content) return c.json({ error: { message: "Comment cannot be empty" } }, 400);

  const { data: comment, error: fetchError } = await supabaseAdmin
    .from("comments")
    .select("id, post_id, user_id")
    .eq("id", commentId)
    .maybeSingle();

  if (fetchError || !comment || comment.post_id !== id) {
    return c.json({ error: { message: "Comment not found" } }, 404);
  }

  // Edit permission: ONLY the comment's author may edit (not the moment owner).
  if (comment.user_id !== userId) return c.json({ error: { message: "Forbidden" } }, 403);

  const nowIso = new Date().toISOString();
  let updated: any = null;
  let updateError: any = null;
  ({ data: updated, error: updateError } = await supabaseAdmin
    .from("comments")
    .update({ content, updated_at: nowIso })
    .eq("id", commentId)
    .select("id, post_id, user_id, content, created_at, updated_at, profiles:user_id(id, full_name, username, avatar_url, gender, is_verified)")
    .single());
  if (updateError && /updated_at|column/i.test(updateError.message ?? "")) {
    ({ data: updated, error: updateError } = await supabaseAdmin
      .from("comments")
      .update({ content })
      .eq("id", commentId)
      .select("id, post_id, user_id, content, created_at, profiles:user_id(id, full_name, username, avatar_url, gender, is_verified)")
      .single());
  }

  if (updateError || !updated) {
    console.error("Update comment error:", updateError);
    return c.json({ error: { message: "Failed to update comment" } }, 500);
  }

  const u: any = updated;
  const formatted = {
    id: u.id,
    postId: u.post_id,
    userId: u.user_id,
    content: u.content,
    createdAt: u.created_at,
    updatedAt: u.updated_at ?? nowIso,
    user: formatCommentUser(u.user_id, u.profiles),
  };

  return c.json({ data: formatted });
});

export { postsRouter };
