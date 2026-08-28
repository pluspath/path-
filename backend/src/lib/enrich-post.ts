import { supabaseAdmin } from "../supabase";
import { extractHashtags, extractMentions } from "./text-parse";
import { sendPushToUser } from "./push";

/**
 * After a post is created, index hashtags and notify mentioned users.
 * Uses service role (tables may lack INSERT policies for authenticated).
 * Failures are logged and never block post creation.
 */
export async function enrichPostContent(opts: {
  postId: string;
  authorId: string;
  authorName: string;
  content: string | null | undefined;
}) {
  const { postId, authorId, authorName, content } = opts;
  if (!content) return;

  try {
    const tags = extractHashtags(content);
    for (const tag of tags) {
      const { data: existing } = await supabaseAdmin
        .from("hashtags")
        .select("id, post_count")
        .eq("tag", tag)
        .maybeSingle();

      let hashtagId = existing?.id;
      if (existing) {
        await supabaseAdmin
          .from("hashtags")
          .update({ post_count: (existing.post_count ?? 0) + 1 })
          .eq("id", existing.id);
      } else {
        const { data: created } = await supabaseAdmin
          .from("hashtags")
          .insert({ tag, post_count: 1 })
          .select("id")
          .single();
        hashtagId = created?.id;
      }

      if (hashtagId) {
        await supabaseAdmin
          .from("post_hashtags")
          .upsert({ post_id: postId, hashtag_id: hashtagId }, { onConflict: "post_id,hashtag_id" });
      }
    }
  } catch (err) {
    console.error("[enrich] hashtag error:", err instanceof Error ? err.message : err);
  }

  try {
    const usernames = extractMentions(content);
    if (usernames.length === 0) return;

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, username, full_name")
      .in("username", usernames);

    for (const profile of profiles ?? []) {
      if (profile.id === authorId) continue;

      await supabaseAdmin.from("mentions").upsert(
        {
          post_id: postId,
          mentioned_user_id: profile.id,
          mentioned_by: authorId,
        },
        { onConflict: "post_id,mentioned_user_id" }
      );

      const { data: inserted } = await supabaseAdmin.from("notifications").insert({
        user_id: profile.id,
        from_user_id: authorId,
        type: "mention",
        message: `${authorName} mentioned you in a moment`,
        post_id: postId,
        read: false,
      }).select("id").single();

      try {
        await sendPushToUser(supabaseAdmin, profile.id, "Mention", `${authorName} mentioned you`, {
          type: "mention",
          postId,
          fromUserId: authorId,
          notificationId: inserted?.id,
        });
      } catch {
        // push optional
      }
    }
  } catch (err) {
    console.error("[enrich] mention error:", err instanceof Error ? err.message : err);
  }
}
