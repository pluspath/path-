import { z } from "zod";
import { ADMIN_ROLES } from "../constants";

export const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(10)
    .max(128)
    .regex(/[A-Z]/, "Must include uppercase")
    .regex(/[a-z]/, "Must include lowercase")
    .regex(/[0-9]/, "Must include a number")
    .regex(/[^A-Za-z0-9]/, "Must include a symbol"),
});

export const resetPasswordRequestSchema = z.object({
  username: z.string().min(1),
});

export const resetPasswordConfirmSchema = z.object({
  token: z.string().min(10),
  newPassword: changePasswordSchema.shape.newPassword,
});

export const createAdminSchema = z.object({
  username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/),
  password: changePasswordSchema.shape.newPassword,
  role: z.enum(ADMIN_ROLES),
  display_name: z.string().max(120).optional(),
  email: z.string().email().optional(),
});

export const updateAdminSchema = z.object({
  role: z.enum(ADMIN_ROLES).optional(),
  display_name: z.string().max(120).nullable().optional(),
  email: z.string().email().nullable().optional(),
  is_active: z.boolean().optional(),
  password: changePasswordSchema.shape.newPassword.optional(),
});

export const updateUserSchema = z.object({
  full_name: z.string().max(120).optional(),
  username: z.string().min(3).max(64).optional(),
  bio: z.string().max(2000).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  birthday: z.string().max(40).nullable().optional(),
  avatar_url: z.string().url().nullable().optional(),
  cover_url: z.string().url().nullable().optional(),
  status: z.enum(["active", "suspended"]).optional(),
  suspended_reason: z.string().max(500).nullable().optional(),
});

export const createPostSchema = z.object({
  user_id: z.string().uuid(),
  type: z.string().min(1).max(40),
  content: z.string().max(5000).optional(),
  image_url: z.string().url().optional(),
  location: z.string().max(300).optional(),
  venue_category: z.string().max(100).optional(),
  is_hidden: z.boolean().optional(),
  is_published: z.boolean().optional(),
});

export const updatePostSchema = createPostSchema.partial().omit({ user_id: true }).extend({
  is_hidden: z.boolean().optional(),
  is_published: z.boolean().optional(),
});

export const updateCommentSchema = z.object({
  moderation_status: z.enum(["approved", "rejected", "pending"]).optional(),
  admin_reply: z.string().max(2000).nullable().optional(),
  content: z.string().max(2000).optional(),
});

export const sendNotificationSchema = z.object({
  title: z.string().min(1).max(120),
  message: z.string().min(1).max(1000),
  audience: z.enum(["all", "selected", "group"]),
  userIds: z.array(z.string().uuid()).optional(),
  group: z.enum(["active", "suspended"]).optional(),
  sendPush: z.boolean().default(true),
  sendInApp: z.boolean().default(true),
});

export const updateSettingsSchema = z.object({
  key: z.enum(["general", "push", "safe_env"]),
  value: z.record(z.string(), z.unknown()),
});

export const updateContentSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().max(100_000).optional(),
  is_published: z.boolean().optional(),
});

export const createReportSchema = z.object({
  reporter_user_id: z.string().uuid().optional(),
  target_type: z.enum(["post", "comment", "user", "message", "other"]),
  target_id: z.string().min(1),
  reason: z.string().min(1).max(500),
  details: z.string().max(2000).optional(),
});

export const updateReportSchema = z.object({
  status: z.enum(["open", "reviewing", "resolved", "dismissed"]).optional(),
  resolution_note: z.string().max(2000).optional(),
});

export const updateFriendshipSchema = z.object({
  status: z.enum(["pending", "accepted", "declined", "blocked"]).optional(),
});
