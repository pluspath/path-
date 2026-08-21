/** Minimal safe Markdown → HTML (no external deps). */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineFormat(text: string): string {
  let s = escapeHtml(text);
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(
    /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g,
    '<a href="mailto:$1">$1</a>'
  );
  return s;
}

export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      closeList();
      continue;
    }

    if (trimmed.startsWith("### ")) {
      closeList();
      out.push(`<h3>${inlineFormat(trimmed.slice(4))}</h3>`);
      continue;
    }
    if (trimmed.startsWith("## ")) {
      closeList();
      out.push(`<h2>${inlineFormat(trimmed.slice(3))}</h2>`);
      continue;
    }
    if (trimmed.startsWith("# ")) {
      closeList();
      out.push(`<h1>${inlineFormat(trimmed.slice(2))}</h1>`);
      continue;
    }

    if (trimmed.startsWith("- ")) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inlineFormat(trimmed.slice(2))}</li>`);
      continue;
    }

    closeList();
    out.push(`<p>${inlineFormat(trimmed)}</p>`);
  }

  closeList();
  return out.join("\n");
}

export function renderLegalPageHtml(opts: {
  title: string;
  bodyMarkdown: string;
  activeSlug: "privacy" | "terms";
  updatedAt?: string | null;
}): string {
  const content = markdownToHtml(opts.bodyMarkdown);
  const updated = opts.updatedAt
    ? new Date(opts.updatedAt).toLocaleDateString("en-GB", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(opts.title)} · Path+</title>
  <meta name="description" content="Path+ ${escapeHtml(opts.title)}" />
  <style>
    :root {
      --navy: #0A1F44;
      --ink: #12233f;
      --muted: #5b6b86;
      --line: #e4e9f2;
      --bg: #f6f8fc;
      --card: #ffffff;
      --accent: #1a6cff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: var(--ink);
      background: linear-gradient(180deg, #eef3fb 0%, var(--bg) 220px, var(--bg) 100%);
      line-height: 1.65;
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .wrap { max-width: 760px; margin: 0 auto; padding: 28px 20px 64px; }
    header {
      display: flex; flex-direction: column; gap: 18px;
      margin-bottom: 28px;
    }
    .brand {
      display: inline-flex; align-items: center; gap: 10px;
      color: var(--navy); font-weight: 700; font-size: 1.15rem;
      letter-spacing: -0.02em;
    }
    .brand span {
      width: 28px; height: 28px; border-radius: 8px;
      background: var(--navy); color: #fff;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 0.85rem;
    }
    h1.page-title {
      margin: 0; font-size: 1.85rem; letter-spacing: -0.03em; color: var(--navy);
    }
    .meta { color: var(--muted); font-size: 0.9rem; margin: 0; }
    nav.tabs {
      display: flex; gap: 8px; flex-wrap: wrap;
      background: var(--card); border: 1px solid var(--line);
      border-radius: 14px; padding: 6px; width: fit-content;
    }
    nav.tabs a {
      padding: 8px 14px; border-radius: 10px; color: var(--muted);
      font-weight: 600; font-size: 0.92rem;
    }
    nav.tabs a.active {
      background: var(--navy); color: #fff; text-decoration: none;
    }
    article {
      background: var(--card); border: 1px solid var(--line);
      border-radius: 18px; padding: 28px 24px;
      box-shadow: 0 8px 30px rgba(10, 31, 68, 0.04);
    }
    article h1 { display: none; }
    article h2 {
      margin: 1.6em 0 0.55em; font-size: 1.15rem; color: var(--navy);
      letter-spacing: -0.02em;
    }
    article h2:first-of-type { margin-top: 0.4em; }
    article h3 { margin: 1.2em 0 0.4em; font-size: 1rem; color: var(--ink); }
    article p { margin: 0.7em 0; }
    article ul { margin: 0.5em 0 0.9em; padding-left: 1.2em; }
    article li { margin: 0.35em 0; }
    footer {
      margin-top: 28px; text-align: center; color: var(--muted); font-size: 0.85rem;
    }
    footer a { margin: 0 6px; }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <a class="brand" href="/legal"><span>P+</span> Path+</a>
      <div>
        <h1 class="page-title">Legal Center</h1>
        <p class="meta">Privacy Policy &amp; Terms of Service${
          updated ? ` · Updated ${escapeHtml(updated)}` : ""
        }</p>
      </div>
      <nav class="tabs" aria-label="Legal pages">
        <a href="/privacy" class="${opts.activeSlug === "privacy" ? "active" : ""}">Privacy Policy</a>
        <a href="/terms" class="${opts.activeSlug === "terms" ? "active" : ""}">Terms of Service</a>
      </nav>
    </header>
    <article>
      ${content}
    </article>
    <footer>
      © ${new Date().getFullYear()} Path+. All rights reserved.
      <a href="/privacy">Privacy</a>·
      <a href="/terms">Terms</a>
    </footer>
  </div>
</body>
</html>`;
}
