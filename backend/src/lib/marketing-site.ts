import { markdownToHtml } from "./markdown-html";

export const SUPPORT_EMAIL = "dev@pathplus.store";
export const PRIVACY_EMAIL = "privacy@pathplus.store";
export const SITE_NAME = "Path+";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const SHARED_STYLES = `
  :root {
    --navy: #071933;
    --navy-2: #0A1F44;
    --ink: #13233f;
    --muted: #5d6d88;
    --line: rgba(10, 31, 68, 0.1);
    --sand: #f3efe6;
    --cream: #faf8f4;
    --gold: #c9a84c;
    --gold-soft: #e8d7a2;
    --white: #ffffff;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0;
    color: var(--ink);
    background: var(--cream);
    font-family: "DM Sans", system-ui, -apple-system, sans-serif;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  a { color: inherit; text-decoration: none; }
  img { max-width: 100%; display: block; }
  .container { width: min(1120px, calc(100% - 2.5rem)); margin: 0 auto; }
  .site-header {
    position: sticky; top: 0; z-index: 40;
    backdrop-filter: blur(14px);
    background: rgba(250, 248, 244, 0.86);
    border-bottom: 1px solid var(--line);
  }
  .nav {
    display: flex; align-items: center; justify-content: space-between;
    min-height: 72px; gap: 1rem;
  }
  .brand {
    display: inline-flex; align-items: center; gap: 0.7rem;
    font-family: "Fraunces", Georgia, serif;
    font-weight: 600; font-size: 1.35rem; letter-spacing: -0.03em;
    color: var(--navy);
  }
  .brand-mark {
    width: 34px; height: 34px; border-radius: 10px;
    background: linear-gradient(145deg, var(--navy-2), #163a73);
    color: var(--gold-soft);
    display: inline-flex; align-items: center; justify-content: center;
    font-family: "DM Sans", sans-serif; font-size: 0.78rem; font-weight: 700;
  }
  .nav-links { display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap; }
  .nav-links a {
    padding: 0.55rem 0.85rem; border-radius: 999px;
    color: var(--muted); font-size: 0.92rem; font-weight: 600;
  }
  .nav-links a:hover, .nav-links a.active { color: var(--navy); background: rgba(10,31,68,0.05); }
  .nav-cta {
    background: var(--navy) !important; color: #fff !important;
    margin-left: 0.35rem;
  }
  .nav-cta:hover { background: #12305f !important; }

  .hero {
    position: relative; min-height: min(92vh, 820px);
    display: grid; align-items: end;
    overflow: hidden;
    background:
      linear-gradient(180deg, rgba(7,25,51,0.18) 0%, rgba(7,25,51,0.72) 58%, rgba(7,25,51,0.92) 100%),
      url("https://images.unsplash.com/photo-1529156069898-49953e39b3ac?auto=format&fit=crop&w=2000&q=80")
      center/cover no-repeat;
    color: #fff;
  }
  .hero-inner { padding: 5.5rem 0 4rem; }
  .hero-kicker {
    display: inline-block; margin-bottom: 1rem;
    font-size: 0.78rem; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase;
    color: var(--gold-soft);
  }
  .hero h1 {
    margin: 0; max-width: 11ch;
    font-family: "Fraunces", Georgia, serif;
    font-size: clamp(3rem, 8vw, 5.4rem);
    line-height: 0.95; letter-spacing: -0.04em; font-weight: 600;
  }
  .hero-lead {
    margin: 1.25rem 0 0; max-width: 34rem;
    font-size: 1.12rem; color: rgba(255,255,255,0.86);
  }
  .hero-actions { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-top: 1.85rem; }
  .btn {
    display: inline-flex; align-items: center; justify-content: center;
    min-height: 48px; padding: 0.75rem 1.25rem; border-radius: 999px;
    font-weight: 700; font-size: 0.95rem; border: 1px solid transparent;
  }
  .btn-primary { background: var(--gold); color: var(--navy); }
  .btn-primary:hover { filter: brightness(1.05); }
  .btn-ghost { background: transparent; color: #fff; border-color: rgba(255,255,255,0.35); }
  .btn-ghost:hover { background: rgba(255,255,255,0.08); }
  .btn-dark { background: var(--navy); color: #fff; }
  .btn-outline {
    background: transparent; color: var(--navy);
    border-color: rgba(10,31,68,0.2);
  }

  .section { padding: 5rem 0; }
  .section-tight { padding: 3.5rem 0; }
  .eyebrow {
    margin: 0 0 0.75rem;
    font-size: 0.78rem; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;
    color: var(--gold);
  }
  .section h2 {
    margin: 0; font-family: "Fraunces", Georgia, serif;
    font-size: clamp(1.9rem, 4vw, 2.8rem); letter-spacing: -0.03em; line-height: 1.1;
    color: var(--navy);
  }
  .section-lead { margin: 0.9rem 0 0; max-width: 36rem; color: var(--muted); font-size: 1.05rem; }

  .feature-grid {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.25rem;
    margin-top: 2.5rem;
  }
  .feature {
    padding: 1.5rem 1.35rem 1.6rem;
    border-top: 2px solid var(--navy);
    background: linear-gradient(180deg, rgba(10,31,68,0.03), transparent);
  }
  .feature h3 {
    margin: 0 0 0.55rem; font-family: "Fraunces", Georgia, serif;
    font-size: 1.35rem; color: var(--navy); letter-spacing: -0.02em;
  }
  .feature p { margin: 0; color: var(--muted); }

  .band {
    background: var(--navy);
    color: rgba(255,255,255,0.88);
  }
  .band h2 { color: #fff; }
  .band .section-lead { color: rgba(255,255,255,0.7); }
  .band-grid {
    display: grid; grid-template-columns: 1.2fr 1fr; gap: 2rem; align-items: center;
    margin-top: 1.5rem;
  }
  .band-points { display: grid; gap: 0.85rem; margin: 0; padding: 0; list-style: none; }
  .band-points li {
    padding-left: 1.4rem; position: relative;
  }
  .band-points li::before {
    content: ""; position: absolute; left: 0; top: 0.55rem;
    width: 0.55rem; height: 0.55rem; border-radius: 50%; background: var(--gold);
  }

  .page-hero {
    padding: 3.5rem 0 2rem;
    background:
      radial-gradient(circle at 90% 10%, rgba(201,168,76,0.18), transparent 40%),
      linear-gradient(180deg, #ebe6dc, var(--cream));
  }
  .page-hero h1 {
    margin: 0.35rem 0 0;
    font-family: "Fraunces", Georgia, serif;
    font-size: clamp(2.2rem, 5vw, 3.4rem);
    letter-spacing: -0.03em; color: var(--navy); line-height: 1.05;
  }
  .page-hero p { margin: 0.9rem 0 0; max-width: 40rem; color: var(--muted); font-size: 1.05rem; }

  .tabs {
    display: flex; gap: 0.4rem; flex-wrap: wrap; margin: 1.5rem 0 0;
  }
  .tabs a {
    padding: 0.55rem 0.95rem; border-radius: 999px; font-weight: 700; font-size: 0.9rem;
    color: var(--muted); background: rgba(10,31,68,0.04);
  }
  .tabs a.active { background: var(--navy); color: #fff; }

  .legal-article, .support-panel {
    background: var(--white);
    border: 1px solid var(--line);
    border-radius: 22px;
    padding: clamp(1.4rem, 3vw, 2.4rem);
    box-shadow: 0 18px 50px rgba(7, 25, 51, 0.05);
  }
  .legal-article h1 { display: none; }
  .legal-article h2 {
    margin: 1.7em 0 0.55em; font-family: "Fraunces", Georgia, serif;
    font-size: 1.25rem; color: var(--navy); letter-spacing: -0.02em;
  }
  .legal-article h2:first-of-type { margin-top: 0.2em; }
  .legal-article h3 { margin: 1.2em 0 0.4em; font-size: 1.02rem; color: var(--ink); }
  .legal-article p { margin: 0.7em 0; }
  .legal-article ul { margin: 0.5em 0 0.95em; padding-left: 1.2em; }
  .legal-article li { margin: 0.35em 0; }
  .legal-article a { color: #1a5fd0; text-decoration: underline; }

  .support-grid {
    display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 1.25rem;
  }
  .support-card {
    padding: 1.35rem 1.3rem; border-radius: 18px;
    border: 1px solid var(--line); background: #fff;
  }
  .support-card h3 {
    margin: 0 0 0.45rem; font-family: "Fraunces", Georgia, serif;
    font-size: 1.25rem; color: var(--navy);
  }
  .support-card p { margin: 0; color: var(--muted); }
  .support-email {
    display: inline-block; margin-top: 1rem;
    font-size: 1.15rem; font-weight: 700; color: var(--navy);
  }
  .faq { margin-top: 1.5rem; display: grid; gap: 0.85rem; }
  .faq details {
    border: 1px solid var(--line); border-radius: 14px; padding: 0.95rem 1.05rem; background: #fff;
  }
  .faq summary {
    cursor: pointer; font-weight: 700; color: var(--navy); list-style: none;
  }
  .faq summary::-webkit-details-marker { display: none; }
  .faq details p { margin: 0.65rem 0 0; color: var(--muted); }

  .site-footer {
    margin-top: 3rem; padding: 2.5rem 0 2rem;
    border-top: 1px solid var(--line); background: #efebe2;
  }
  .footer-grid {
    display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 1.5rem;
  }
  .footer-brand {
    font-family: "Fraunces", Georgia, serif; font-size: 1.4rem; color: var(--navy);
  }
  .footer-copy { margin: 0.55rem 0 0; color: var(--muted); max-width: 28rem; }
  .footer-col h4 {
    margin: 0 0 0.7rem; font-size: 0.78rem; letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--muted);
  }
  .footer-col a { display: block; margin: 0.35rem 0; color: var(--navy); font-weight: 600; }
  .footer-bottom {
    margin-top: 1.75rem; padding-top: 1rem; border-top: 1px solid var(--line);
    color: var(--muted); font-size: 0.88rem;
    display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap;
  }

  @media (max-width: 900px) {
    .feature-grid, .band-grid, .support-grid, .footer-grid { grid-template-columns: 1fr; }
    .hero-inner { padding-top: 4.5rem; }
  }
`;

function layout(opts: {
  title: string;
  description: string;
  active?: "home" | "support" | "privacy" | "terms";
  body: string;
}): string {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(opts.title)}</title>
  <meta name="description" content="${escapeHtml(opts.description)}" />
  <meta name="theme-color" content="#0A1F44" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,600;0,9..40,700;1,9..40,400&family=Fraunces:opsz,wght@9..144,500;9..144,600&display=swap" rel="stylesheet" />
  <style>${SHARED_STYLES}</style>
</head>
<body>
  <header class="site-header">
    <div class="container nav">
      <a class="brand" href="/"><span class="brand-mark">P+</span> Path+</a>
      <nav class="nav-links" aria-label="Primary">
        <a href="/" class="${opts.active === "home" ? "active" : ""}">Home</a>
        <a href="/support" class="${opts.active === "support" ? "active" : ""}">Support</a>
        <a href="/privacy" class="${opts.active === "privacy" ? "active" : ""}">Privacy</a>
        <a href="/terms" class="${opts.active === "terms" ? "active" : ""}">Terms</a>
        <a class="nav-cta" href="mailto:${SUPPORT_EMAIL}">Contact</a>
      </nav>
    </div>
  </header>
  ${opts.body}
  <footer class="site-footer">
    <div class="container">
      <div class="footer-grid">
        <div>
          <div class="footer-brand">Path+</div>
          <p class="footer-copy">A private social space for sharing life moments with the people who matter most.</p>
        </div>
        <div class="footer-col">
          <h4>Product</h4>
          <a href="/">Home</a>
          <a href="/support">Support</a>
        </div>
        <div class="footer-col">
          <h4>Legal</h4>
          <a href="/privacy">Privacy Policy</a>
          <a href="/terms">Terms of Service</a>
        </div>
      </div>
      <div class="footer-bottom">
        <span>© ${year} Path+. All rights reserved.</span>
        <span>Support: <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></span>
      </div>
    </div>
  </footer>
</body>
</html>`;
}

export function renderMarketingHome(): string {
  return layout({
    title: "Path+ — Share life with your close circle",
    description:
      "Path+ is a private social app for sharing moments with friends. Download on the App Store.",
    active: "home",
    body: `
    <section class="hero">
      <div class="container hero-inner">
        <div class="hero-kicker">Private by design</div>
        <h1>Path+</h1>
        <p class="hero-lead">Share the moments that matter with a close circle of friends — photos, check-ins, and everyday life, without the noise of a public feed.</p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="/support">Get support</a>
          <a class="btn btn-ghost" href="/privacy">Privacy Policy</a>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <p class="eyebrow">Built for closeness</p>
        <h2>Moments for the people who already know you.</h2>
        <p class="section-lead">Path+ keeps your world small on purpose — so sharing feels natural, not performative.</p>
        <div class="feature-grid">
          <article class="feature">
            <h3>Close circle</h3>
            <p>Share with friends or your closest people. Your timeline stays personal.</p>
          </article>
          <article class="feature">
            <h3>Life as it happens</h3>
            <p>Post photos, short notes, and place check-ins when you want to mark the day.</p>
          </article>
          <article class="feature">
            <h3>Safety first</h3>
            <p>Report and block tools, clear community rules, and account deletion whenever you need it.</p>
          </article>
        </div>
      </div>
    </section>

    <section class="section band">
      <div class="container band-grid">
        <div>
          <p class="eyebrow" style="color: var(--gold-soft);">App Store ready</p>
          <h2>Transparent policies. Real support.</h2>
          <p class="section-lead">Everything Apple asks for in your listing — Privacy, Terms, and a public Support page — lives here.</p>
        </div>
        <ul class="band-points">
          <li><a href="/privacy" style="color:#fff;text-decoration:underline;">Privacy Policy</a> — what we collect and how to delete your data</li>
          <li><a href="/terms" style="color:#fff;text-decoration:underline;">Terms of Service</a> — community rules, reporting, and blocking</li>
          <li><a href="/support" style="color:#fff;text-decoration:underline;">Support</a> — reach us at ${SUPPORT_EMAIL}</li>
        </ul>
      </div>
    </section>
    `,
  });
}

export function renderSupportPage(): string {
  return layout({
    title: "Support · Path+",
    description: `Get help with Path+. Contact ${SUPPORT_EMAIL} for account, privacy, or app support.`,
    active: "support",
    body: `
    <section class="page-hero">
      <div class="container">
        <p class="eyebrow">Support</p>
        <h1>We're here to help.</h1>
        <p>Questions about your account, privacy, safety, or the app itself — email our team and we’ll get back to you.</p>
      </div>
    </section>
    <section class="section-tight">
      <div class="container support-grid">
        <div class="support-panel">
          <p class="eyebrow">Official support</p>
          <h2 style="margin:0;font-family:Fraunces,Georgia,serif;font-size:1.8rem;color:var(--navy);">Email us</h2>
          <p style="margin:0.7rem 0 0;color:var(--muted);">Our public support channel for Path+ users and App Store reviewers.</p>
          <a class="support-email" href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>
          <div style="margin-top:1.4rem;display:flex;gap:0.65rem;flex-wrap:wrap;">
            <a class="btn btn-dark" href="mailto:${SUPPORT_EMAIL}?subject=Path%2B%20Support">Write an email</a>
            <a class="btn btn-outline" href="/privacy">Privacy Policy</a>
          </div>
          <div class="faq">
            <details open>
              <summary>How do I delete my account?</summary>
              <p>In the Path+ app, go to <strong>Settings → Delete Account</strong>. This permanently removes your profile, moments, messages, and friend connections. You can also email ${SUPPORT_EMAIL} from your registered address if you cannot access the app.</p>
            </details>
            <details>
              <summary>How do I report content or a user?</summary>
              <p>Use the report controls on a moment, comment, or profile inside the app. You can also block a user to stop further interaction. We review reports and take action, including removing content or suspending accounts when needed.</p>
            </details>
            <details>
              <summary>Privacy questions?</summary>
              <p>Read our <a href="/privacy">Privacy Policy</a>, or email <a href="mailto:${PRIVACY_EMAIL}">${PRIVACY_EMAIL}</a> for data access or deletion requests.</p>
            </details>
          </div>
        </div>
        <div style="display:grid;gap:1rem;align-content:start;">
          <div class="support-card">
            <h3>Response time</h3>
            <p>We aim to respond to support emails within 1–2 business days. Safety reports submitted in-app are reviewed as a priority.</p>
          </div>
          <div class="support-card">
            <h3>App Store</h3>
            <p>This page is the official Support URL for Path+. Include it in App Store Connect under Support URL.</p>
          </div>
          <div class="support-card">
            <h3>Legal</h3>
            <p><a href="/terms">Terms of Service</a> · <a href="/privacy">Privacy Policy</a></p>
          </div>
        </div>
      </div>
    </section>
    `,
  });
}

export function renderMarketingLegalPage(opts: {
  title: string;
  bodyMarkdown: string;
  active: "privacy" | "terms";
  updatedAt?: string | null;
}): string {
  const updated = opts.updatedAt
    ? new Date(opts.updatedAt).toLocaleDateString("en-GB", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return layout({
    title: `${opts.title} · Path+`,
    description: `Path+ ${opts.title}`,
    active: opts.active,
    body: `
    <section class="page-hero">
      <div class="container">
        <p class="eyebrow">Legal Center</p>
        <h1>${escapeHtml(opts.title)}</h1>
        <p>${
          updated
            ? `Last updated ${escapeHtml(updated)}. `
            : ""
        }Managed from the Path+ control panel. Questions? <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>
        <nav class="tabs" aria-label="Legal pages">
          <a href="/privacy" class="${opts.active === "privacy" ? "active" : ""}">Privacy Policy</a>
          <a href="/terms" class="${opts.active === "terms" ? "active" : ""}">Terms of Service</a>
          <a href="/support">Support</a>
        </nav>
      </div>
    </section>
    <section class="section-tight">
      <div class="container">
        <article class="legal-article">
          ${markdownToHtml(opts.bodyMarkdown)}
        </article>
      </div>
    </section>
    `,
  });
}
