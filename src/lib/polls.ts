import { supabaseAdmin } from "../supabase";
import { isAccountVerified } from "./verification";

export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 6;
export const POLL_QUESTION_MAX = 200;
export const POLL_OPTION_MAX = 80;

export type PollOptionInput = string;

export type FormattedPollOption = {
  id: string;
  text: string;
  position: number;
  voteCount: number;
  percent: number;
};

export type FormattedPoll = {
  id: string;
  postId: string;
  question: string;
  options: FormattedPollOption[];
  totalVotes: number;
  myOptionId: string | null;
  createdAt: string;
};

/** Largest-remainder so displayed percents sum to 100 when there are votes. */
export function distributePercents(counts: number[]): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0) return counts.map(() => 0);
  const raw = counts.map((c) => (c * 100) / total);
  const floored = raw.map((r) => Math.floor(r));
  let remainder = 100 - floored.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const out = [...floored];
  for (let k = 0; k < remainder; k++) {
    out[order[k % order.length]!.i]! += 1;
  }
  return out;
}

export function normalizePollPayload(raw: unknown):
  | { ok: true; question: string; options: string[] }
  | { ok: false; message: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, message: "Poll data is required" };
  }
  const body = raw as Record<string, unknown>;
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return { ok: false, message: "Poll question is required" };
  if (question.length > POLL_QUESTION_MAX) {
    return { ok: false, message: "Poll question is too long" };
  }

  const list = Array.isArray(body.options) ? body.options : [];
  const options: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const text = typeof item === "string" ? item.trim() : "";
    if (!text) continue;
    if (text.length > POLL_OPTION_MAX) {
      return { ok: false, message: "A poll option is too long" };
    }
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(text);
  }
  if (options.length < POLL_MIN_OPTIONS) {
    return { ok: false, message: `Add at least ${POLL_MIN_OPTIONS} answer options` };
  }
  if (options.length > POLL_MAX_OPTIONS) {
    return { ok: false, message: `At most ${POLL_MAX_OPTIONS} answer options` };
  }
  return { ok: true, question, options };
}

export async function assertVerifiedForPoll(userId: string): Promise<
  | { ok: true }
  | { ok: false; status: 403; message: string }
> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("is_verified")
    .eq("id", userId)
    .maybeSingle();
  if (!isAccountVerified(data)) {
    return {
      ok: false,
      status: 403,
      message: "Polls are available to verified accounts only",
    };
  }
  return { ok: true };
}

export async function createPollForPost(params: {
  postId: string;
  userId: string;
  question: string;
  options: string[];
}): Promise<{ pollId: string } | { error: string }> {
  const pollId = crypto.randomUUID();
  const { error: pollErr } = await supabaseAdmin.from("polls").insert({
    id: pollId,
    post_id: params.postId,
    question: params.question,
    created_by: params.userId,
  });
  if (pollErr) {
    console.error("[polls] insert poll:", pollErr.message);
    return { error: "Failed to create poll" };
  }

  const rows = params.options.map((text, position) => ({
    id: crypto.randomUUID(),
    poll_id: pollId,
    text,
    position,
  }));
  const { error: optErr } = await supabaseAdmin.from("poll_options").insert(rows);
  if (optErr) {
    console.error("[polls] insert options:", optErr.message);
    await supabaseAdmin.from("polls").delete().eq("id", pollId);
    return { error: "Failed to create poll options" };
  }
  return { pollId };
}

async function loadVoteCounts(pollId: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const { data, error } = await supabaseAdmin
    .from("poll_votes")
    .select("option_id")
    .eq("poll_id", pollId);
  if (error) {
    console.warn("[polls] vote counts:", error.message);
    return counts;
  }
  for (const row of data ?? []) {
    const oid = String(row.option_id ?? "");
    if (!oid) continue;
    counts.set(oid, (counts.get(oid) ?? 0) + 1);
  }
  return counts;
}

export async function formatPoll(
  pollRow: { id: string; post_id: string; question: string; created_at: string },
  options: { id: string; text: string; position: number }[],
  viewerId?: string
): Promise<FormattedPoll> {
  const counts = await loadVoteCounts(pollRow.id);
  const ordered = [...options].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const voteCounts = ordered.map((o) => counts.get(o.id) ?? 0);
  const percents = distributePercents(voteCounts);
  const totalVotes = voteCounts.reduce((a, b) => a + b, 0);

  let myOptionId: string | null = null;
  if (viewerId) {
    const { data: mine } = await supabaseAdmin
      .from("poll_votes")
      .select("option_id")
      .eq("poll_id", pollRow.id)
      .eq("user_id", viewerId)
      .maybeSingle();
    myOptionId = mine?.option_id ? String(mine.option_id) : null;
  }

  return {
    id: pollRow.id,
    postId: pollRow.post_id,
    question: pollRow.question,
    options: ordered.map((o, i) => ({
      id: o.id,
      text: o.text,
      position: o.position,
      voteCount: voteCounts[i] ?? 0,
      percent: percents[i] ?? 0,
    })),
    totalVotes,
    myOptionId,
    createdAt: pollRow.created_at,
  };
}

export async function attachPollsToPosts(posts: any[], viewerId?: string): Promise<void> {
  const targets: any[] = [];
  for (const p of posts ?? []) {
    if (!p) continue;
    targets.push(p);
    if (p.original) targets.push(p.original);
  }
  const ids = Array.from(
    new Set(
      targets
        .map((p) => p?.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    )
  );
  if (ids.length === 0) return;

  const { data: polls, error } = await supabaseAdmin
    .from("polls")
    .select("id, post_id, question, created_at")
    .in("post_id", ids);
  if (error) {
    if (/polls|relation|does not exist/i.test(error.message ?? "")) return;
    console.warn("[polls] attach select:", error.message);
    return;
  }
  if (!polls?.length) return;

  const pollIds = polls.map((p) => p.id as string);
  const [{ data: options }, { data: votes }, mineRes] = await Promise.all([
    supabaseAdmin.from("poll_options").select("id, poll_id, text, position").in("poll_id", pollIds),
    supabaseAdmin.from("poll_votes").select("poll_id, option_id").in("poll_id", pollIds),
    viewerId
      ? supabaseAdmin
          .from("poll_votes")
          .select("poll_id, option_id")
          .in("poll_id", pollIds)
          .eq("user_id", viewerId)
      : Promise.resolve({ data: [] as { poll_id: string; option_id: string }[] }),
  ]);

  const optionsByPoll = new Map<string, { id: string; text: string; position: number }[]>();
  for (const o of options ?? []) {
    const list = optionsByPoll.get(o.poll_id) ?? [];
    list.push({ id: o.id, text: o.text, position: o.position });
    optionsByPoll.set(o.poll_id, list);
  }

  const countByPollOption = new Map<string, Map<string, number>>();
  for (const v of votes ?? []) {
    const pid = String(v.poll_id);
    const oid = String(v.option_id);
    if (!countByPollOption.has(pid)) countByPollOption.set(pid, new Map());
    const m = countByPollOption.get(pid)!;
    m.set(oid, (m.get(oid) ?? 0) + 1);
  }

  const myByPoll = new Map<string, string>();
  for (const m of mineRes.data ?? []) {
    myByPoll.set(String(m.poll_id), String(m.option_id));
  }

  const byPost = new Map<string, FormattedPoll>();
  for (const poll of polls) {
    const ordered = [...(optionsByPoll.get(poll.id) ?? [])].sort(
      (a, b) => a.position - b.position || a.id.localeCompare(b.id)
    );
    const countsMap = countByPollOption.get(poll.id) ?? new Map();
    const voteCounts = ordered.map((o) => countsMap.get(o.id) ?? 0);
    const percents = distributePercents(voteCounts);
    const totalVotes = voteCounts.reduce((a, b) => a + b, 0);
    byPost.set(poll.post_id, {
      id: poll.id,
      postId: poll.post_id,
      question: poll.question,
      options: ordered.map((o, i) => ({
        id: o.id,
        text: o.text,
        position: o.position,
        voteCount: voteCounts[i] ?? 0,
        percent: percents[i] ?? 0,
      })),
      totalVotes,
      myOptionId: myByPoll.get(poll.id) ?? null,
      createdAt: poll.created_at,
    });
  }

  for (const post of targets) {
    const poll = byPost.get(post.id);
    if (poll) post.poll = poll;
  }
}

/**
 * Cast or change a single-choice vote. Unique on (poll_id, user_id).
 * Returns the refreshed poll payload.
 */
export async function castPollVote(params: {
  pollId: string;
  optionId: string;
  userId: string;
}): Promise<{ poll: FormattedPoll } | { error: string; status: number }> {
  const { data: poll, error: pollErr } = await supabaseAdmin
    .from("polls")
    .select("id, post_id, question, created_at")
    .eq("id", params.pollId)
    .maybeSingle();
  if (pollErr || !poll) {
    return { error: "Poll not found", status: 404 };
  }

  const { data: option } = await supabaseAdmin
    .from("poll_options")
    .select("id, poll_id, text, position")
    .eq("id", params.optionId)
    .eq("poll_id", params.pollId)
    .maybeSingle();
  if (!option) {
    return { error: "Invalid poll option", status: 400 };
  }

  const { data: existing } = await supabaseAdmin
    .from("poll_votes")
    .select("option_id")
    .eq("poll_id", params.pollId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (existing?.option_id === params.optionId) {
    // Idempotent — already voted for this option.
  } else if (existing) {
    const { error } = await supabaseAdmin
      .from("poll_votes")
      .update({ option_id: params.optionId, created_at: new Date().toISOString() })
      .eq("poll_id", params.pollId)
      .eq("user_id", params.userId);
    if (error) {
      console.error("[polls] update vote:", error.message);
      return { error: "Failed to update vote", status: 500 };
    }
  } else {
    const { error } = await supabaseAdmin.from("poll_votes").insert({
      poll_id: params.pollId,
      option_id: params.optionId,
      user_id: params.userId,
    });
    if (error) {
      // Concurrent insert — treat unique violation as race; re-read.
      if (!/duplicate|unique|23505/i.test(error.message ?? "")) {
        console.error("[polls] insert vote:", error.message);
        return { error: "Failed to cast vote", status: 500 };
      }
      const { error: upErr } = await supabaseAdmin
        .from("poll_votes")
        .update({ option_id: params.optionId, created_at: new Date().toISOString() })
        .eq("poll_id", params.pollId)
        .eq("user_id", params.userId);
      if (upErr) {
        console.error("[polls] race update vote:", upErr.message);
        return { error: "Failed to cast vote", status: 500 };
      }
    }
  }

  const { data: allOpts } = await supabaseAdmin
    .from("poll_options")
    .select("id, text, position")
    .eq("poll_id", params.pollId);
  const formatted = await formatPoll(poll, allOpts ?? [], params.userId);
  return { poll: formatted };
}
