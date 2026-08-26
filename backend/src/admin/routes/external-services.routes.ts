import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { adminAuthMiddleware, getActor, type AdminEnv } from "../middlewares/admin-auth";
import { requirePermission } from "../middlewares/rbac";
import { fail, ok } from "../utils/response";
import { clientKey } from "../../lib/rate-limit";
import {
  emailUpdateSchema,
  externalServicesService,
  googlePlacesUpdateSchema,
  parseServiceId,
  pushUpdateSchema,
  supabaseUpdateSchema,
  testEmailSchema,
} from "../services/external-services.service";

const externalServicesRoutes = new Hono<AdminEnv>();
externalServicesRoutes.use("*", adminAuthMiddleware);

externalServicesRoutes.get("/", requirePermission("settings:read"), async (c) => {
  try {
    return ok(c, await externalServicesService.list());
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Failed to load external services", 500);
  }
});

// Specific email routes before /:service
externalServicesRoutes.post(
  "/email/send-test",
  requirePermission("settings:write"),
  zValidator("json", testEmailSchema),
  async (c) => {
    try {
      const { to } = c.req.valid("json");
      return ok(c, await externalServicesService.sendTestEmail(to, getActor(c), clientKey(c)));
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to send test email";
      const status =
        e && typeof e === "object" && "status" in e && (e as { status: number }).status === 429
          ? 429
          : 400;
      return fail(c, message, status as 400 | 429);
    }
  }
);

externalServicesRoutes.post(
  "/email/test",
  requirePermission("settings:write"),
  async (c) => {
    try {
      return ok(c, await externalServicesService.test("email", getActor(c), clientKey(c)));
    } catch (e) {
      return fail(c, e instanceof Error ? e.message : "Test failed", 500);
    }
  }
);

externalServicesRoutes.get("/:service", requirePermission("settings:read"), async (c) => {
  try {
    const service = parseServiceId(c.req.param("service"));
    if (!service) return fail(c, "Unknown service", 404);
    return ok(c, await externalServicesService.get(service));
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Failed to load service", 500);
  }
});

externalServicesRoutes.patch("/:service", requirePermission("settings:write"), async (c) => {
  try {
    const service = parseServiceId(c.req.param("service"));
    if (!service) return fail(c, "Unknown service", 404);

    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return fail(c, "Invalid body", 400);

    const actor = getActor(c);
    const ip = clientKey(c);

    if (service === "email") {
      const parsed = emailUpdateSchema.safeParse(body);
      if (!parsed.success) return fail(c, parsed.error.issues[0]?.message ?? "Invalid body", 400);
      return ok(c, await externalServicesService.updateEmail(parsed.data, actor, ip));
    }
    if (service === "google_places") {
      const parsed = googlePlacesUpdateSchema.safeParse(body);
      if (!parsed.success) return fail(c, parsed.error.issues[0]?.message ?? "Invalid body", 400);
      return ok(c, await externalServicesService.updateGooglePlaces(parsed.data, actor, ip));
    }
    if (service === "push") {
      const parsed = pushUpdateSchema.safeParse(body);
      if (!parsed.success) return fail(c, parsed.error.issues[0]?.message ?? "Invalid body", 400);
      return ok(c, await externalServicesService.updatePush(parsed.data, actor, ip));
    }
    if (service === "supabase") {
      const parsed = supabaseUpdateSchema.safeParse(body);
      if (!parsed.success) return fail(c, parsed.error.issues[0]?.message ?? "Invalid body", 400);
      return ok(c, await externalServicesService.updateSupabase(parsed.data, actor, ip));
    }

    return fail(c, "Unsupported service", 400);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Update failed";
    if (
      message.includes("confirmHighRisk") ||
      message.includes("allowlist") ||
      message.includes("CONFIG_ENCRYPTION_KEY")
    ) {
      return fail(c, message, 400);
    }
    return fail(c, message, 500);
  }
});

externalServicesRoutes.post("/:service/test", requirePermission("settings:write"), async (c) => {
  try {
    const service = parseServiceId(c.req.param("service"));
    if (!service) return fail(c, "Unknown service", 404);
    const result = await externalServicesService.test(service, getActor(c), clientKey(c));
    return ok(c, result);
  } catch (e) {
    return fail(c, e instanceof Error ? e.message : "Test failed", 500);
  }
});

export { externalServicesRoutes };
