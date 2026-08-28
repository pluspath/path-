import { sendPushToUser } from "../../lib/push";
import { supabaseAdmin } from "../../supabase";
import { dataRepository } from "../repositories/data.repository";
import { logRepository } from "../repositories/log.repository";
import { toPaginated } from "../utils/pagination";
import { sanitizeText } from "../utils/sanitize";

type Actor = { id: string; name: string };

export const notificationsService = {
  async list(opts: { page: number; limit: number; offset: number }) {
    const { items, total } = await dataRepository.listNotifications(opts);
    return toPaginated(items, total, opts.page, opts.limit);
  },

  async send(
    input: {
      title: string;
      message: string;
      audience: "all" | "selected" | "group";
      userIds?: string[];
      group?: "active" | "suspended";
      sendPush: boolean;
      sendInApp: boolean;
    },
    actor: Actor
  ) {
    const title = sanitizeText(input.title, 120);
    const message = sanitizeText(input.message, 1000);

    let targets: Array<{ id: string; push_token?: string | null }> = [];

    if (input.audience === "all") {
      targets = await dataRepository.getAllProfileIds();
    } else if (input.audience === "selected") {
      targets = await dataRepository.getProfilesByIds(input.userIds ?? []);
    } else if (input.audience === "group") {
      const status = input.group ?? "active";
      const { items } = await dataRepository.listProfiles({
        status,
        limit: 10_000,
        offset: 0,
      });
      targets = items.map((p: any) => ({ id: p.id, push_token: p.push_token }));
    }

    let inAppCreated = 0;
    let pushSent = 0;

    if (input.sendInApp && targets.length > 0) {
      const rows = targets.map((t) => ({
        user_id: t.id,
        type: "admin_broadcast",
        message: `${title}: ${message}`,
        from_user_id: null,
        read: false,
      }));
      // Insert in chunks
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        await dataRepository.insertNotifications(chunk);
        inAppCreated += chunk.length;
      }
    }

    if (input.sendPush) {
      for (const t of targets) {
        await sendPushToUser(supabaseAdmin, t.id, title, message, {
          type: "admin_broadcast",
        });
        pushSent += 1;
      }
    }

    await logRepository.create({
      category: "admin_activity",
      action: "notification_broadcast",
      actor_type: "admin",
      actor_id: actor.id,
      actor_name: actor.name,
      metadata: {
        audience: input.audience,
        targets: targets.length,
        inAppCreated,
        pushSent,
      },
    });

    return { targets: targets.length, inAppCreated, pushSent };
  },
};
