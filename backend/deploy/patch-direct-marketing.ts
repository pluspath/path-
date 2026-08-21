#!/usr/bin/env bun
/**
 * One-shot VPS patch: register marketing pages directly on the main Hono app.
 * Run on the server:
 *   cd /root/path-/backend
 *   bun run deploy/patch-direct-marketing.ts
 *   pm2 restart pathplus-api --update-env
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..");
const contentPath = join(root, "src/routes/content.ts");
const indexPath = join(root, "src/index.ts");

if (!existsSync(contentPath) || !existsSync(indexPath)) {
  console.error("Missing src/routes/content.ts or src/index.ts");
  process.exit(1);
}

let content = readFileSync(contentPath, "utf8");
let index = readFileSync(indexPath, "utf8");

if (!content.includes("export function registerMarketingPages")) {
  console.error(
    "src/routes/content.ts is outdated — copy the latest content.ts from your PC first."
  );
  console.error("Needed files: src/routes/content.ts, src/lib/marketing-site.ts, src/lib/legal-seed.ts, src/lib/markdown-html.ts");
  process.exit(1);
}

// Ensure index imports registerMarketingPages
if (!index.includes("registerMarketingPages")) {
  if (index.includes("legalPagesRouter")) {
    index = index.replace(
      /import\s*\{([^}]*)\}\s*from\s*["']\.\/routes\/content["'];?/,
      (_m, inner: string) => {
        const names = new Set(
          inner
            .split(",")
            .map((s: string) => s.trim())
            .filter(Boolean)
            .filter((n: string) => n !== "legalPagesRouter")
        );
        names.add("registerMarketingPages");
        names.add("contentRouter");
        names.add("seedLegalContent");
        return `import {\n  ${[...names].join(",\n  ")},\n} from "./routes/content";`;
      }
    );
  } else if (index.includes('from "./routes/content"')) {
    index = index.replace(
      /import\s*\{([^}]*)\}\s*from\s*["']\.\/routes\/content["'];?/,
      'import {\n  contentRouter,\n  registerMarketingPages,\n  seedLegalContent,\n} from "./routes/content";'
    );
  } else {
    index =
      'import {\n  contentRouter,\n  registerMarketingPages,\n  seedLegalContent,\n} from "./routes/content";\n' +
      index;
  }
}

// Replace nested mount with direct registration
index = index.replace(
  /^\s*app\.route\(\s*["']\/["']\s*,\s*legalPagesRouter\s*\)\s*;?\s*$/gm,
  "registerMarketingPages(app);"
);

if (!index.includes("registerMarketingPages(app)")) {
  if (index.includes('app.route("/api/content"')) {
    index = index.replace(
      'app.route("/api/content"',
      'registerMarketingPages(app);\napp.route("/api/content"'
    );
  } else if (index.includes("export default")) {
    index = index.replace(
      "export default",
      "registerMarketingPages(app);\n\nexport default"
    );
  } else {
    index += "\nregisterMarketingPages(app);\n";
  }
}

writeFileSync(indexPath, index);
console.log("Patched", indexPath);
console.log("Next: pm2 restart pathplus-api --update-env");
console.log("Then:  curl -sI http://127.0.0.1:3000/privacy | head -5");
