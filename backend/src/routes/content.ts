import { Hono } from "hono";
import { contentRepository } from "../admin/repositories/content.repository";
import {
  renderMarketingHome,
  renderMarketingLegalPage,
  renderSupportPage,
} from "../lib/marketing-site";
import {
  LEGAL_PAGES,
  PLACEHOLDER_BODIES,
} from "../lib/legal-seed";

const PUBLIC_LEGAL_SLUGS = new Set(["privacy", "terms"]);

export const contentRouter = new Hono();

contentRouter.get("/", async (c) => {
  const rows = await contentRepository.list();
  const published = rows
    .filter((r) => r.is_published)
    .map((r) => ({
      slug: r.slug,
      title: r.title,
      updated_at: r.updated_at,
    }));
  return c.json({ data: published });
});

contentRouter.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const row = await contentRepository.getBySlug(slug);
  if (!row || !row.is_published) {
    return c.json({ error: "Content not found" }, 404);
  }
  return c.json({
    data: {
      slug: row.slug,
      title: row.title,
      body: row.body,
      updated_at: row.updated_at,
    },
  });
});

async function serveLegalHtml(slug: "privacy" | "terms") {
  const row = await contentRepository.getBySlug(slug);
  if (!row || !row.is_published) {
    return null;
  }
  return renderMarketingLegalPage({
    title: row.title || (slug === "privacy" ? "Privacy Policy" : "Terms of Service"),
    bodyMarkdown: row.body || "",
    active: slug,
    updatedAt: row.updated_at,
  });
}

/** Public marketing + legal HTML pages (App Store URLs). */
export const legalPagesRouter = new Hono();

legalPagesRouter.get("/", (c) => c.html(renderMarketingHome()));

legalPagesRouter.get("/support", (c) => c.html(renderSupportPage()));

legalPagesRouter.get("/privacy", async (c) => {
  const html = await serveLegalHtml("privacy");
  if (!html) return c.text("Privacy Policy is not published yet.", 404);
  return c.html(html);
});

legalPagesRouter.get("/terms", async (c) => {
  const html = await serveLegalHtml("terms");
  if (!html) return c.text("Terms of Service are not published yet.", 404);
  return c.html(html);
});

legalPagesRouter.get("/legal", async (c) => c.redirect("/privacy", 302));

legalPagesRouter.get("/legal/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (!PUBLIC_LEGAL_SLUGS.has(slug)) {
    return c.text("Not found", 404);
  }
  return c.redirect(`/${slug}`, 302);
});

/**
 * Upserts full legal copy into CMS when rows are missing or still placeholders.
 * Idempotent — will not overwrite custom edits.
 */
export async function seedLegalContent(): Promise<void> {
  for (const page of LEGAL_PAGES) {
    const existing = await contentRepository.getBySlug(page.slug);
    if (!existing) {
      const { supabaseAdmin } = await import("../supabase");
      const { error } = await supabaseAdmin.from("app_content").insert({
        slug: page.slug,
        title: page.title,
        body: page.body,
        is_published: true,
      });
      if (error) throw error;
      console.log(`[cms] Seeded ${page.slug}`);
      continue;
    }

    const body = (existing.body || "").trim();
    const needsAppleRefresh =
      page.slug === "terms" && !body.includes("24 hours");
    if (PLACEHOLDER_BODIES.has(body) || body.length < 80 || needsAppleRefresh) {
      await contentRepository.update(page.slug, {
        title: page.title,
        body: page.body,
        is_published: true,
      });
      console.log(`[cms] Updated ${page.slug} with full legal text`);
    }
  }
}
