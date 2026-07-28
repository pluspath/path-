import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { env } from "../env";
import type { HonoVariables } from "../types";

const placesRouter = new Hono<{ Variables: HonoVariables }>();

placesRouter.post(
  "/nearby",
  zValidator("json", z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    radius: z.number().min(1).max(50000).optional().default(500),
  })),
  async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: { message: "Unauthorized" } }, 401);

    const { latitude, longitude, radius } = c.req.valid("json");

    const body = {
      locationRestriction: {
        circle: {
          center: { latitude, longitude },
          radius,
        },
      },
      maxResultCount: 20,
    };

    const response = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": env.GOOGLE_PLACES_API_KEY,
        "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.types,places.rating",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      console.error("[places] Google Places API error:", response.status);
      return c.json({ error: { message: "Places lookup failed. Please try again." } }, 502);
    }

    const data = await response.json() as { places?: any[] };
    const places = (data.places ?? []).map((p: any) => ({
      name: p.displayName?.text ?? "Unknown Place",
      address: p.formattedAddress ?? "",
      types: p.types ?? [],
      rating: p.rating ?? null,
    }));

    return c.json({ data: places });
  }
);

export { placesRouter };
