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
      };
    }
    const urls = decodeImages((post as any).image_url);
    return {
      available: true,
      kind: "post",
      post: {
        ...(post as any),
        media: urls.map((url: string, index: number) => ({
          index,
          url,
          type: /\.(mp4|mov|webm|m4v)$/i.test(url) ? "video" : "image",
        })),
      },
    };
  }

  if (targetType === "comment" && targetId) {
    const { data: comment, error } = await supabaseAdmin
      .from("comments")
      .select("*, profiles(id, username, full_name, avatar_url)")
      .eq("id", targetId)
      .maybeSingle();
    if (error) throw error;
    if (!comment) {
      return {
        available: false,
        kind: "comment",
        message: "The reported comment is no longer available (deleted or missing).",
      };
    }
    const parent = comment.post_id ? await dataRepository.getPost(comment.post_id) : null;
    const parentMedia = parent ? decodeImages((parent as any).image_url) : [];
    return {
      available: true,
      kind: "comment",
      comment,
      parentPost: parent
        ? {
            ...(parent as any),
            media: parentMedia.map((url: string, index: number) => ({
              index,
              url,
              type: /\.(mp4|mov|webm|m4v)$/i.test(url) ? "video" : "image",
            })),
          }
        : null,
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
      };
    }
    return { available: true, kind: "user", user: profile };
  }

  return {
    available: false,
    kind: targetType || "unknown",
    message: "No detailed target content is available for this report type.",
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
    const enriched = (items as any[]).map((row) => {
      const reporterId = row.reporter_user_id || row.reporter_id || null;
      const reportedId =
        row.reported_user_id || (row.target_type === "user" ? row.target_id : null);
      return {
        ...row,
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
    const reportedId =
      (report as any).reported_user_id ||
      ((report as any).target_type === "user" ? (report as any).target_id : null);
    const [reporter, reportedUser, target, logs] = await Promise.all([
      loadProfile(reporterId),
      loadProfile(reportedId),
      hydrateTarget(report as any),
      logRepository.list({
        search: id,
        limit: 30,
        offset: 0,
      }).catch(() => ({ items: [], total: 0 })),
    ]);
    return {
      ...(report as any),
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
