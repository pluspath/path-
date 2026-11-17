import { decodeImages } from "../../lib/images";
import { dataRepository } from "../repositories/data.repository";
import { reportRepository } from "../repositories/report.repository";
import { logRepository } from "../repositories/log.repository";
import { toPaginated } from "../utils/pagination";
import { sanitizeText } from "../utils/sanitize";
import { supabaseAdmin } from "../../supabase";

type Actor = { id: string; name: string };

async function loadProfile(userId: string | null | undefined) {
  if (!userId) return null;
  try {
    return await dataRepository.getProfile(userId);
  } catch {
    return null;
  }
}

function mediaTypeFromUrl(url: string): "image" | "video" {
  const lower = url.toLowerCase().split("?")[0] ?? "";
  if (/\.(mp4|mov|webm|m4v|avi|mkv)$/.test(lower)) return "video";
  return "image";
}

async function enrichPostPayload(post: Record<string, any>) {
  const urls = decodeImages(post.image_url);
  const media = urls.map((url: string, index: number) => ({
    index,
    url,
    type: mediaTypeFromUrl(url),
  }));
  const [reactionCount, viewCount, commentCount] = await Promise.all([
    dataRepository.countReactionsForPost(post.id).catch(() => 0),
    dataRepository.countViewsForPost(post.id).catch(() => 0),
    dataRepository
      .listComments({ postId: post.id, limit: 1, offset: 0 })
      .then((r) => r.total)
      .catch(() => Number(post.comment_count ?? 0)),
  ]);
  return {
    ...post,
    media,
    mediaCount: media.length,
    mediaKind:
      media.some((m) => m.type === "video") && media.some((m) => m.type === "image")
        ? "mixed"
        : media.some((m) => m.type === "video")
          ? "video"
          : media.length
            ? "image"
            : "text",
    reactionCount,
    viewCount,
    commentCount,
  };
}

async function hydrateTarget(report: Record<string, any>) {
  const targetType = String(report.target_type ?? "").toLowerCase();
  const targetId = String(report.target_id ?? report.reported_post_id ?? "");
  const reportedUserId = report.reported_user_id ?? null;

  if (targetType === "post" && targetId) {
    const post = await dataRepository.getPost(targetId);
    if (!post) {
      return {
        available: false,
        kind: "post",
        message: "The reported post is no longer available (deleted or missing).",
        reportedUserId: reportedUserId || null,
      };
    }
    return {
      available: true,
      kind: "post",
      reportedUserId: reportedUserId || (post as any).user_id || null,
      post: await enrichPostPayload(post as any),
    };
  }

  if (targetType === "comment" && targetId) {
    const { data: comment, error } = await supabaseAdmin
      .from("comments")
      .select("*, profiles(id, username, full_name, avatar_url, status, created_at)")
      .eq("id", targetId)
      .maybeSingle();
    if (error) throw error;
    if (!comment) {
      return {
        available: false,
        kind: "comment",
        message: "The reported comment is no longer available (deleted or missing).",
        reportedUserId: reportedUserId || null,
      };
    }
    const parent = comment.post_id ? await dataRepository.getPost(comment.post_id) : null;
    return {
      available: true,
      kind: "comment",
      reportedUserId: reportedUserId || comment.user_id || null,
      comment,
      parentPost: parent ? await enrichPostPayload(parent as any) : null,
    };
  }

  if (targetType === "user") {
    const userId = reportedUserId || targetId;
    const profile = await loadProfile(userId);
    if (!profile) {
      return {
        available: false,
        kind: "user",
        message: "The reported user profile is no longer available.",
        reportedUserId: userId || null,
      };
    }
    return { available: true, kind: "user", reportedUserId: userId, user: profile };
  }

  return {
    available: false,
    kind: targetType || "unknown",
    message: "No detailed target content is available for this report type.",
    reportedUserId: reportedUserId || null,
  };
}

export const reportsService = {
  async list(opts: {
    page: number;
    limit: number;
    offset: number;
    status?: string;
    search?: string;
    targetType?: string;
  }) {
    const { items, total } = await reportRepository.list(opts);
    // Attach lightweight profile labels for list rows.
    const userIds = new Set<string>();
    for (const row of items as any[]) {
      if (row.reporter_user_id) userIds.add(row.reporter_user_id);
      if (row.reporter_id) userIds.add(row.reporter_id);
      if (row.reported_user_id) userIds.add(row.reported_user_id);
      if (row.target_type === "user" && row.target_id) userIds.add(row.target_id);
    }
    const profiles: Record<string, any> = {};
    await Promise.all(
      [...userIds].map(async (id) => {
        profiles[id] = await loadProfile(id);
      })
    );
    // For post/comment reports without reported_user_id, resolve publisher/author ids.
    const needsOwnerLookup = (items as any[]).filter(
      (row) =>
        !row.reported_user_id &&
        (row.target_type === "post" || row.target_type === "comment") &&
        row.target_id
    );
    const ownerByTarget: Record<string, string> = {};
    await Promise.all(
      needsOwnerLookup.map(async (row) => {
        try {
          if (row.target_type === "post") {
            const post = await dataRepository.getPost(row.target_id);
            if ((post as any)?.user_id) ownerByTarget[row.id] = (post as any).user_id;
          } else if (row.target_type === "comment") {
            const { data: comment } = await supabaseAdmin
              .from("comments")
              .select("user_id")
              .eq("id", row.target_id)
              .maybeSingle();
            if (comment?.user_id) ownerByTarget[row.id] = comment.user_id;
          }
        } catch {
          /* ignore lookup failures for list enrichment */
        }
      })
    );
    for (const id of Object.values(ownerByTarget)) userIds.add(id);
    await Promise.all(
      [...userIds]
        .filter((id) => !profiles[id])
        .map(async (id) => {
          profiles[id] = await loadProfile(id);
        })
    );

    const enriched = (items as any[]).map((row) => {
      const reporterId = row.reporter_user_id || row.reporter_id || null;
      const reportedId =
        row.reported_user_id ||
        ownerByTarget[row.id] ||
        (row.target_type === "user" ? row.target_id : null);
      return {
        ...row,
        reported_user_id: reportedId,
        reporter: reporterId ? profiles[reporterId] ?? null : null,
        reportedUser: reportedId ? profiles[reportedId] ?? null : null,
      };
    });
    return toPaginated(enriched, total, opts.page, opts.limit);
  },

  async get(id: string) {
    const report = await reportRepository.get(id);
    if (!report) return null;
    const reporterId = (report as any).reporter_user_id || (report as any).reporter_id || null;
    const target = await hydrateTarget(report as any);
    const reportedId =
      (report as any).reported_user_id ||
      (target as any)?.reportedUserId ||
      ((report as any).target_type === "user" ? (report as any).target_id : null);
    const [reporter, reportedUser, logs] = await Promise.all([
      loadProfile(reporterId),
      loadProfile(reportedId),
      logRepository
        .list({
          search: id,
          limit: 30,
          offset: 0,
        })
        .catch(() => ({ items: [], total: 0 })),
    ]);
    return {
      ...(report as any),
      reported_user_id: reportedId,
      reporter,
      reportedUser,
      target,
      audit: (logs.items as any[]).filter(
        (l) => l.target_id === id || l.metadata?.report_id === id
      ),
    };
  },

  async create(
    input: {
      reporter_user_id?: string;
      target_type: string;
      target_id: string;
      reason: string;
      details?: string;
    },
    actor: Actor
  ) {
    const created = await reportRepository.create({
      ...input,
      reason: sanitizeText(input.reason, 500),
      details: input.details ? sanitizeText(input.details, 2000) : undefined,
    });
    await logRepository.create({
      category: "admin_activity",
      action: "report_create",
      actor_type: "admin",
      actor_id: actor.id,
      actor_name: actor.name,
      target_type: "report",
      target_id: created.id,
    });
    return created;
  },

  async update(
    id: string,
    patch: { status?: string; resolution_note?: string },
    actor: Actor
  ) {
    const previous = await reportRepository.get(id);
    const data: Record<string, unknown> = { ...patch };
    if (patch.resolution_note) data.resolution_note = sanitizeText(patch.resolution_note, 2000);
    if (patch.status === "resolved" || patch.status === "dismissed") {
      data.resolved_by = actor.id;
      data.resolved_at = new Date().toISOString();
    }
    if (patch.status === "open" || patch.status === "reviewing") {
      data.resolved_by = null;
      data.resolved_at = null;
    }
    const updated = await reportRepository.update(id, data as any);
    await logRepository.create({
      category: "admin_activity",
      action: "report_update",
      actor_type: "admin",
      actor_id: actor.id,
      actor_name: actor.name,
      target_type: "report",
      target_id: id,
      metadata: {
        previous_status: (previous as any)?.status ?? null,
        new_status: patch.status ?? (previous as any)?.status ?? null,
        ...patch,
      },
    });
    return updated;
  },

  async delete(id: string, actor: Actor) {
    await reportRepository.delete(id);
    await logRepository.create({
      category: "admin_activity",
      action: "report_delete",
      actor_type: "admin",
      actor_id: actor.id,
      actor_name: actor.name,
      target_type: "report",
      target_id: id,
    });
  },
};
