import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import {
  renderMarketingHome,
  renderSupportPage,
  renderMarketingLegalPage,
} from "../src/lib/marketing-site";
import { PRIVACY_POLICY_BODY, TERMS_OF_SERVICE_BODY } from "../src/lib/legal-seed";

const out = resolve(import.meta.dir, "../website-dist");
mkdirSync(out, { recursive: true });

function toStaticLinks(html: string): string {
  return html
    .replace(/href="\/"/g, 'href="./index.html"')
    .replace(/href="\/support"/g, 'href="./support.html"')
    .replace(/href="\/privacy"/g, 'href="./privacy.html"')
    .replace(/href="\/terms"/g, 'href="./terms.html"');
}

const pages: Record<string, string> = {
  "index.html": toStaticLinks(renderMarketingHome()),
  "support.html": toStaticLinks(renderSupportPage()),
  "privacy.html": toStaticLinks(
    renderMarketingLegalPage({
      title: "Privacy Policy",
      bodyMarkdown: PRIVACY_POLICY_BODY,
      active: "privacy",
    })
  ),
  "terms.html": toStaticLinks(
    renderMarketingLegalPage({
      title: "Terms of Service",
      bodyMarkdown: TERMS_OF_SERVICE_BODY,
      active: "terms",
    })
  ),
};

for (const [name, html] of Object.entries(pages)) {
  writeFileSync(resolve(out, name), html);
  console.log("wrote", name, html.length);
}
