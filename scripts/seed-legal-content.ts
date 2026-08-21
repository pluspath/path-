/**
 * Seed / refresh Privacy Policy & Terms of Service in app_content (Admin CMS).
 * Usage: bun run scripts/seed-legal-content.ts
 * Add --force to overwrite existing custom bodies.
 */
import { contentRepository } from "../src/admin/repositories/content.repository";
import { LEGAL_PAGES, PLACEHOLDER_BODIES } from "../src/lib/legal-seed";
import { supabaseAdmin } from "../src/supabase";

const force = process.argv.includes("--force");

async function main() {
  for (const page of LEGAL_PAGES) {
    const existing = await contentRepository.getBySlug(page.slug);

    if (!existing) {
      const { error } = await supabaseAdmin.from("app_content").insert({
        slug: page.slug,
        title: page.title,
        body: page.body,
        is_published: true,
      });
      if (error) throw error;
      console.log(`Inserted ${page.slug}`);
      continue;
    }

    const body = (existing.body || "").trim();
    const shouldUpdate = force || PLACEHOLDER_BODIES.has(body) || body.length < 80;

    if (!shouldUpdate) {
      console.log(`Skipped ${page.slug} (already has custom content; use --force to overwrite)`);
      continue;
    }

    await contentRepository.update(page.slug, {
      title: page.title,
      body: page.body,
      is_published: true,
    });
    console.log(`Updated ${page.slug}${force ? " (--force)" : ""}`);
  }

  console.log("Done. Public URLs:");
  console.log("  /privacy");
  console.log("  /terms");
  console.log("  /legal  (redirects to privacy)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
