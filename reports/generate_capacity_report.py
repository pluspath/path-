#!/usr/bin/env python3
"""
Path+ Infrastructure Capacity Assessment — PDF report generator.
Read-only analysis artifact. Does not modify application source.
Uses stdlib only for HTML generation; Chrome headless prints the PDF.
"""
from __future__ import annotations

import html
import math
import os
from datetime import date
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent
HTML_PATH = OUT_DIR / "PathPlus_Infrastructure_Capacity_Assessment_100K_Users.html"
PDF_NAME = "PathPlus_Infrastructure_Capacity_Assessment_100K_Users.pdf"

# ---------------------------------------------------------------------------
# Modeled workload assumptions (NOT measured production metrics)
# ---------------------------------------------------------------------------
REGISTERED = 100_000

SCENARIOS = {
    "Conservative": {
        "dau_pct": 0.30,
        "sessions": 4,
        "session_min": 6,
        "api_per_session": 28,
        "db_rtt_per_api": 8,
        "msg_users_pct": 0.18,
        "msgs_per_sender": 6,
        "notif_per_dau": 4,
        "photo_users_pct": 0.05,
        "photos_per_uploader": 1.2,
        "video_users_pct": 0.010,
        "videos_per_uploader": 1.0,
        "photo_view_per_dau": 18,
        "video_view_per_dau": 1.5,
        "photo_cache_miss": 0.35,  # fraction of views that hit origin/CDN miss
        "video_mb_transferred": 2.2,  # avg MB pulled per video start (partial play / preload)
        "peak_factor": 4.0,
        "rt_channels_per_user": 4.2,
    },
    "Normal": {
        "dau_pct": 0.40,
        "sessions": 6,
        "session_min": 10,
        "api_per_session": 48,
        "db_rtt_per_api": 10,
        "msg_users_pct": 0.28,
        "msgs_per_sender": 12,
        "notif_per_dau": 8,
        "photo_users_pct": 0.08,
        "photos_per_uploader": 1.6,
        "video_users_pct": 0.020,
        "videos_per_uploader": 1.1,
        "photo_view_per_dau": 28,
        "video_view_per_dau": 3.0,
        "photo_cache_miss": 0.40,
        "video_mb_transferred": 3.0,
        "peak_factor": 5.0,
        "rt_channels_per_user": 4.5,
    },
    "Heavy": {
        "dau_pct": 0.50,
        "sessions": 8,
        "session_min": 14,
        "api_per_session": 75,
        "db_rtt_per_api": 14,
        "msg_users_pct": 0.40,
        "msgs_per_sender": 22,
        "notif_per_dau": 14,
        "photo_users_pct": 0.12,
        "photos_per_uploader": 2.2,
        "video_users_pct": 0.040,
        "videos_per_uploader": 1.3,
        "photo_view_per_dau": 45,
        "video_view_per_dau": 6.0,
        "photo_cache_miss": 0.55,  # worse without transforms/CDN tuning
        "video_mb_transferred": 5.5,  # preload=auto amplification
        "peak_factor": 6.0,
        "rt_channels_per_user": 5.0,
    },
}

# Media size assumptions (client already compresses photos ~1280px JPEG q=0.8)
PHOTO_KB = 420
VIDEO_MB = 9.5  # average stored object size
THUMB_KB = 28
AVATAR_KB = 180
API_KB_AVG = 18
MSG_RT_KB = 0.8


def fmt(n: float, digits: int = 0) -> str:
    if digits == 0:
        return f"{int(round(n)):,}"
    return f"{n:,.{digits}f}"


def fmt_bytes_gb(gb: float) -> str:
    if gb >= 1000:
        return f"{gb/1000:.2f} TB"
    return f"{gb:.1f} GB"


def compute(name: str, a: dict) -> dict:
    dau = REGISTERED * a["dau_pct"]
    sessions = dau * a["sessions"]
    api = sessions * a["api_per_session"]
    avg_rps = api / 86_400
    peak_rps = avg_rps * a["peak_factor"]
    avg_concurrent = dau * a["sessions"] * a["session_min"] / (24 * 60)
    peak_concurrent = avg_concurrent * a["peak_factor"]
    # Concurrent in-flight API: peak RPS * typical latency seconds
    concurrent_api = peak_rps * 0.35
    rt_conn = peak_concurrent * a["rt_channels_per_user"]
    db_q = api * a["db_rtt_per_api"]
    # Read/write split assumption for social apps
    db_reads = db_q * 0.82
    db_writes = db_q * 0.18
    messages = dau * a["msg_users_pct"] * a["msgs_per_sender"]
    notifications = dau * a["notif_per_dau"]
    photos = dau * a["photo_users_pct"] * a["photos_per_uploader"]
    videos = dau * a["video_users_pct"] * a["videos_per_uploader"]
    photo_dl = dau * a["photo_view_per_dau"]
    video_dl = dau * a["video_view_per_dau"]

    api_gb_mo = api * API_KB_AVG / 1024 / 1024 * 30
    photo_up_gb_mo = photos * PHOTO_KB / 1024 / 1024 * 30
    video_up_gb_mo = videos * VIDEO_MB / 1024 * 30
    # Origin/CDN bytes: views × cache-miss × object size
    photo_dl_gb_mo = photo_dl * a["photo_cache_miss"] * PHOTO_KB / 1024 / 1024 * 30
    video_dl_gb_mo = video_dl * a["video_mb_transferred"] / 1024 * 30
    rt_gb_mo = messages * MSG_RT_KB / 1024 / 1024 * 30 * 2  # fanout factor rough
    other_gb_mo = api_gb_mo * 0.15
    total_bw = (
        api_gb_mo
        + photo_up_gb_mo
        + video_up_gb_mo
        + photo_dl_gb_mo
        + video_dl_gb_mo
        + rt_gb_mo
        + other_gb_mo
    )

    # Daily storage growth
    daily_media_gb = (photos * PHOTO_KB / 1024 / 1024) + (videos * VIDEO_MB / 1024)
    # DB row growth rough
    daily_db_mb = (
        photos * 2.5  # posts + media meta
        + messages * 0.8
        + notifications * 0.4
        + (dau * 0.15) * 0.3  # reactions/comments approx
    ) / 1024

    return {
        "name": name,
        "dau": dau,
        "sessions": sessions,
        "api": api,
        "avg_rps": avg_rps,
        "peak_rps": peak_rps,
        "avg_concurrent": avg_concurrent,
        "peak_concurrent": peak_concurrent,
        "concurrent_api": concurrent_api,
        "rt_conn": rt_conn,
        "db_q": db_q,
        "db_reads": db_reads,
        "db_writes": db_writes,
        "messages": messages,
        "notifications": notifications,
        "photos": photos,
        "videos": videos,
        "photo_dl": photo_dl,
        "video_dl": video_dl,
        "api_gb_mo": api_gb_mo,
        "photo_up_gb_mo": photo_up_gb_mo,
        "video_up_gb_mo": video_up_gb_mo,
        "photo_dl_gb_mo": photo_dl_gb_mo,
        "video_dl_gb_mo": video_dl_gb_mo,
        "rt_gb_mo": rt_gb_mo,
        "other_gb_mo": other_gb_mo,
        "total_bw": total_bw,
        "daily_media_gb": daily_media_gb,
        "daily_db_mb": daily_db_mb,
        **a,
    }


RESULTS = {k: compute(k, v) for k, v in SCENARIOS.items()}
N = RESULTS["Normal"]


def db_growth_table():
    """Projected DB + media growth using Normal daily rates; cumulative from go-live at 100k users steady state."""
    # Steady-state daily growth at 100k registered (Normal model)
    media = N["daily_media_gb"]
    db = N["daily_db_mb"] / 1024  # GB
    # Baseline at day 0 when hitting 100k: existing content assumption
    baseline_db_gb = 12.0  # modeled, not measured
    baseline_media_gb = 180.0
    rows = []
    for months, label in [(3, "3 months"), (6, "6 months"), (12, "12 months"), (24, "24 months")]:
        days = months * 30
        rows.append(
            {
                "label": label,
                "db_gb": baseline_db_gb + db * days,
                "media_gb": baseline_media_gb + media * days,
                "index_gb": (baseline_db_gb + db * days) * 0.35,
                "backup_gb": (baseline_db_gb + db * days) * 2.2,  # 7-day daily + weekly
            }
        )
    return rows


GROWTH = db_growth_table()


def table_records():
    """Expected record counts at 100k users (modeled)."""
    return [
        ("profiles / auth.users", "100,000", "1:1 with registered users"),
        ("posts", "1.8M – 4.5M", "0.5–1.2 posts/user/month × 12–24 mo accumulation"),
        ("reactions", "12M – 40M", "High-volume; unique (post,user,type)"),
        ("comments", "2M – 8M", "Social interaction growth"),
        ("friendships", "1.5M – 4M", "~15–40 friends average"),
        ("conversations", "400k – 1.2M", "1:1 dominant"),
        ("messages", "25M – 120M", "Fastest growing chat table"),
        ("notifications", "40M – 150M", "Requires retention policy"),
        ("user_devices", "120k – 200k", "Multi-device tokens"),
        ("reports / blocks", "50k – 250k", "Moderation volume"),
        ("hashtags / post_hashtags", "200k – 2M", "Search & discovery"),
        ("admin_* / settings", "< 50k", "Low volume"),
    ]


CSS = r"""
:root {
  --ink: #1a2332;
  --muted: #5a6577;
  --line: #d8dee8;
  --bg: #ffffff;
  --panel: #f4f6fa;
  --brand: #0b3d5c;
  --accent: #1f7a6c;
  --warn: #b45309;
  --danger: #9f1239;
  --ok: #166534;
}
* { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0;
  font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  color: var(--ink); background: var(--bg);
  font-size: 10.5pt; line-height: 1.45;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
@page { size: A4; margin: 16mm 14mm 18mm 14mm; }
.page { page-break-after: always; position: relative; min-height: 250mm; }
.page:last-child { page-break-after: auto; }
.cover {
  display: flex; flex-direction: column; justify-content: space-between;
  min-height: 262mm; padding: 18mm 8mm;
  background: linear-gradient(165deg, #0b3d5c 0%, #124866 42%, #1a5f5a 100%);
  color: #fff; border-radius: 0;
}
.cover-badge {
  display: inline-block; border: 1px solid rgba(255,255,255,.35);
  padding: 6px 14px; border-radius: 999px; font-size: 9pt; letter-spacing: .08em;
  text-transform: uppercase; opacity: .9;
}
.cover h1 { font-size: 28pt; font-weight: 700; margin: 28px 0 12px; letter-spacing: -0.02em; max-width: 90%; }
.cover .subtitle { font-size: 13pt; opacity: .92; max-width: 85%; font-weight: 400; }
.cover-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 36px; }
.cover-meta div { background: rgba(255,255,255,.08); padding: 12px 14px; border-radius: 8px; }
.cover-meta strong { display: block; font-size: 8pt; text-transform: uppercase; letter-spacing: .06em; opacity: .7; margin-bottom: 4px; }
.cover-footer { font-size: 9pt; opacity: .75; border-top: 1px solid rgba(255,255,255,.2); padding-top: 14px; margin-top: 40px; }
h2 { color: var(--brand); font-size: 16pt; margin: 0 0 10px; border-bottom: 2px solid var(--accent); padding-bottom: 6px; }
h3 { color: var(--brand); font-size: 12pt; margin: 16px 0 8px; }
h4 { color: var(--ink); font-size: 10.5pt; margin: 12px 0 6px; }
p { margin: 0 0 8px; }
.lead { font-size: 11pt; color: var(--muted); }
.tag {
  display: inline-block; font-size: 8pt; font-weight: 600; padding: 2px 8px;
  border-radius: 4px; margin-right: 4px; vertical-align: middle;
}
.tag-f { background: #dbeafe; color: #1e3a8a; }
.tag-a { background: #fef3c7; color: #92400e; }
.tag-u { background: #f3e8ff; color: #6b21a8; }
.tag-p0 { background: #ffe4e6; color: #9f1239; }
.tag-p1 { background: #ffedd5; color: #9a3412; }
.tag-p2 { background: #e0e7ff; color: #3730a3; }
.tag-p3 { background: #ecfdf5; color: #065f46; }
.kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 12px 0 16px; }
.kpi {
  background: var(--panel); border: 1px solid var(--line); border-radius: 8px;
  padding: 12px 14px;
}
.kpi .label { font-size: 8pt; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
.kpi .value { font-size: 16pt; font-weight: 700; color: var(--brand); margin-top: 4px; }
.kpi .hint { font-size: 8pt; color: var(--muted); margin-top: 2px; }
table { width: 100%; border-collapse: collapse; margin: 8px 0 14px; font-size: 9pt; }
th, td { border: 1px solid var(--line); padding: 6px 8px; text-align: left; vertical-align: top; }
th { background: var(--brand); color: #fff; font-weight: 600; }
tr:nth-child(even) td { background: #f8fafc; }
.note {
  background: #fffbeb; border-left: 3px solid var(--warn); padding: 8px 12px;
  margin: 10px 0; font-size: 9pt; color: #78350f;
}
.fact {
  background: #ecfdf5; border-left: 3px solid var(--ok); padding: 8px 12px;
  margin: 10px 0; font-size: 9pt;
}
.danger {
  background: #fff1f2; border-left: 3px solid var(--danger); padding: 8px 12px;
  margin: 10px 0; font-size: 9pt;
}
.toc ol { margin: 0; padding-left: 22px; }
.toc li { margin: 5px 0; }
.toc a { color: var(--brand); text-decoration: none; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.bar-chart { margin: 12px 0 6px; }
.bar-row { display: grid; grid-template-columns: 100px 1fr 70px; gap: 8px; align-items: center; margin: 5px 0; font-size: 9pt; }
.bar-track { background: #e8eef5; height: 14px; border-radius: 7px; overflow: hidden; }
.bar-fill { height: 100%; background: linear-gradient(90deg, var(--brand), var(--accent)); border-radius: 7px; }
.arch {
  background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
  padding: 14px; margin: 10px 0 14px;
}
.arch svg { width: 100%; height: auto; }
.small { font-size: 8.5pt; color: var(--muted); }
.footer-line {
  margin-top: 18px; padding-top: 8px; border-top: 1px solid var(--line);
  font-size: 8pt; color: var(--muted); display: flex; justify-content: space-between;
}
ul.tight li { margin: 3px 0; }
.code { font-family: Consolas, "Courier New", monospace; font-size: 8.5pt; background: #f1f5f9; padding: 1px 4px; border-radius: 3px; }
.section-num { color: var(--accent); font-weight: 700; margin-right: 6px; }
"""


def esc(s: object) -> str:
    return html.escape(str(s))


def bar(label: str, value: float, max_v: float, display: str) -> str:
    pct = min(100, max(2, (value / max_v) * 100)) if max_v else 0
    return f"""
    <div class="bar-row">
      <div>{esc(label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:{pct:.1f}%"></div></div>
      <div style="text-align:right">{esc(display)}</div>
    </div>"""


def workload_table() -> str:
    keys = [
        ("Daily active users", "dau", 0),
        ("Daily sessions", "sessions", 0),
        ("Daily API requests", "api", 0),
        ("Average API RPS", "avg_rps", 1),
        ("Peak API RPS", "peak_rps", 1),
        ("Peak concurrent users", "peak_concurrent", 0),
        ("Peak concurrent API in-flight", "concurrent_api", 0),
        ("Peak realtime channels", "rt_conn", 0),
        ("Daily DB round-trips (modeled)", "db_q", 0),
        ("Daily DB reads", "db_reads", 0),
        ("Daily DB writes", "db_writes", 0),
        ("Daily messages", "messages", 0),
        ("Daily notifications", "notifications", 0),
        ("Daily photo uploads", "photos", 0),
        ("Daily video uploads", "videos", 0),
        ("Daily photo downloads/views", "photo_dl", 0),
        ("Daily video plays (starts)", "video_dl", 0),
        ("Monthly total bandwidth (GB)", "total_bw", 0),
        ("Daily media growth (GB)", "daily_media_gb", 2),
        ("Daily DB growth (MB)", "daily_db_mb", 1),
    ]
    head = "<tr><th>Metric</th><th>Conservative</th><th>Normal</th><th>Heavy</th></tr>"
    rows = []
    for label, key, digits in keys:
        cells = "".join(f"<td>{fmt(RESULTS[s][key], digits)}</td>" for s in ("Conservative", "Normal", "Heavy"))
        rows.append(f"<tr><td>{esc(label)}</td>{cells}</tr>")
    return f"<table>{head}{''.join(rows)}</table>"


def bw_breakdown() -> str:
    head = "<tr><th>Traffic type</th><th>Conservative</th><th>Normal</th><th>Heavy</th></tr>"
    items = [
        ("API responses", "api_gb_mo"),
        ("Photo uploads", "photo_up_gb_mo"),
        ("Video uploads", "video_up_gb_mo"),
        ("Photo downloads", "photo_dl_gb_mo"),
        ("Video streaming (partial)", "video_dl_gb_mo"),
        ("Realtime messaging", "rt_gb_mo"),
        ("Other / overhead", "other_gb_mo"),
        ("TOTAL monthly", "total_bw"),
    ]
    rows = []
    for label, key in items:
        cells = "".join(f"<td>{fmt(RESULTS[s][key], 1)} GB</td>" for s in ("Conservative", "Normal", "Heavy"))
        bold = " style='font-weight:700'" if key == "total_bw" else ""
        rows.append(f"<tr{bold}><td>{esc(label)}</td>{cells}</tr>")
    return f"<table>{head}{''.join(rows)}</table>"


def arch_svg() -> str:
    return r"""
<svg viewBox="0 0 860 520" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Path+ recommended architecture">
  <defs>
    <marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#5a6577"/></marker>
    <style>
      .b{fill:#fff;stroke:#0b3d5c;stroke-width:1.5}
      .bp{fill:#e8f5f2;stroke:#1f7a6c;stroke-width:1.5;stroke-dasharray:4 3}
      .be{fill:#eef4fa;stroke:#0b3d5c;stroke-width:1.5}
      .t{font:600 11px 'Segoe UI',sans-serif;fill:#1a2332}
      .s{font:9px 'Segoe UI',sans-serif;fill:#5a6577}
      .l{stroke:#5a6577;stroke-width:1.2;fill:none;marker-end:url(#arr)}
      .title{font:700 13px 'Segoe UI',sans-serif;fill:#0b3d5c}
    </style>
  </defs>
  <text x="20" y="22" class="title">Recommended production architecture at 100k registered users</text>
  <text x="20" y="40" class="s">Solid = existing in Path+ today · Dashed green = proposed additions</text>

  <rect class="be" x="30" y="60" width="120" height="54" rx="8"/>
  <text class="t" x="48" y="82">iOS App</text>
  <text class="s" x="48" y="98">Expo / RN</text>

  <rect class="be" x="190" y="60" width="140" height="54" rx="8"/>
  <text class="t" x="205" y="82">DNS + CDN</text>
  <text class="s" x="205" y="98">Cloudflare (prop.)</text>

  <rect class="be" x="370" y="55" width="160" height="64" rx="8"/>
  <text class="t" x="385" y="78">nginx + Bun API</text>
  <text class="s" x="385" y="94">Hono · Hostinger VPS</text>
  <text class="s" x="385" y="108">existing (scale out)</text>

  <rect class="bp" x="570" y="55" width="130" height="64" rx="8"/>
  <text class="t" x="585" y="78">Load balancer</text>
  <text class="s" x="585" y="94">2+ API instances</text>
  <text class="s" x="585" y="108">proposed</text>

  <rect class="bp" x="720" y="55" width="120" height="64" rx="8"/>
  <text class="t" x="735" y="78">Redis</text>
  <text class="s" x="735" y="94">cache / rate limit</text>
  <text class="s" x="735" y="108">proposed</text>

  <rect class="be" x="30" y="160" width="150" height="64" rx="8"/>
  <text class="t" x="45" y="183">Supabase Auth</text>
  <text class="s" x="45" y="199">JWT / sessions</text>
  <text class="s" x="45" y="213">existing</text>

  <rect class="be" x="210" y="160" width="170" height="64" rx="8"/>
  <text class="t" x="225" y="183">PostgreSQL</text>
  <text class="s" x="225" y="199">Supabase Pro+ compute</text>
  <text class="s" x="225" y="213">existing (upgrade)</text>

  <rect class="be" x="410" y="160" width="160" height="64" rx="8"/>
  <text class="t" x="425" y="183">Supabase Realtime</text>
  <text class="s" x="425" y="199">postgres_changes</text>
  <text class="s" x="425" y="213">existing (client-direct)</text>

  <rect class="be" x="600" y="160" width="150" height="64" rx="8"/>
  <text class="t" x="615" y="183">Object Storage</text>
  <text class="s" x="615" y="199">Avatars/Covers/Posts</text>
  <text class="s" x="615" y="213">existing Supabase</text>

  <rect class="bp" x="770" y="160" width="70" height="64" rx="8"/>
  <text class="t" x="780" y="183">R2</text>
  <text class="s" x="780" y="199">opt.</text>
  <text class="s" x="780" y="213">CDN</text>

  <rect class="be" x="30" y="270" width="150" height="64" rx="8"/>
  <text class="t" x="45" y="293">Expo Push</text>
  <text class="s" x="45" y="309">APNs / FCM</text>
  <text class="s" x="45" y="323">existing</text>

  <rect class="be" x="210" y="270" width="150" height="64" rx="8"/>
  <text class="t" x="225" y="293">Resend Email</text>
  <text class="s" x="225" y="309">OTP / auth mail</text>
  <text class="s" x="225" y="323">existing</text>

  <rect class="be" x="390" y="270" width="150" height="64" rx="8"/>
  <text class="t" x="405" y="293">Admin (Next.js)</text>
  <text class="s" x="405" y="309">PM2 :3001</text>
  <text class="s" x="405" y="323">existing</text>

  <rect class="bp" x="570" y="270" width="150" height="64" rx="8"/>
  <text class="t" x="585" y="293">Workers / queue</text>
  <text class="s" x="585" y="309">push · media · cron</text>
  <text class="s" x="585" y="323">proposed</text>

  <rect class="bp" x="740" y="270" width="100" height="64" rx="8"/>
  <text class="t" x="752" y="293">Monitoring</text>
  <text class="s" x="752" y="309">APM + alerts</text>
  <text class="s" x="752" y="323">proposed</text>

  <rect class="bp" x="30" y="380" width="200" height="64" rx="8"/>
  <text class="t" x="45" y="403">Backups / PITR</text>
  <text class="s" x="45" y="419">Supabase + offsite</text>
  <text class="s" x="45" y="433">proposed hardening</text>

  <rect class="bp" x="260" y="380" width="200" height="64" rx="8"/>
  <text class="t" x="275" y="403">Media processing</text>
  <text class="s" x="275" y="419">thumbs · transcode</text>
  <text class="s" x="275" y="433">proposed (async)</text>

  <rect class="be" x="490" y="380" width="200" height="64" rx="8"/>
  <text class="t" x="505" y="403">Google Places</text>
  <text class="s" x="505" y="419">location proxy</text>
  <text class="s" x="505" y="433">existing</text>

  <line class="l" x1="150" y1="87" x2="188" y2="87"/>
  <line class="l" x1="330" y1="87" x2="368" y2="87"/>
  <line class="l" x1="530" y1="87" x2="568" y2="87"/>
  <line class="l" x1="450" y1="119" x2="450" y2="158"/>
  <line class="l" x1="450" y1="224" x2="450" y2="268"/>
  <line class="l" x1="105" y1="224" x2="105" y2="268"/>
  <line class="l" x1="680" y1="192" x2="768" y2="192"/>
</svg>
"""


def build_html() -> str:
    today = date.today().isoformat()
    growth_rows = "".join(
        f"<tr><td>{r['label']}</td><td>{fmt(r['db_gb'],1)} GB</td>"
        f"<td>{fmt(r['index_gb'],1)} GB</td><td>{fmt_bytes_gb(r['media_gb'])}</td>"
        f"<td>{fmt(r['backup_gb'],1)} GB</td></tr>"
        for r in GROWTH
    )
    record_rows = "".join(
        f"<tr><td>{esc(a)}</td><td>{esc(b)}</td><td>{esc(c)}</td></tr>" for a, b, c in table_records()
    )
    max_api = RESULTS["Heavy"]["api"]
    max_bw = RESULTS["Heavy"]["total_bw"]

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Path+ Infrastructure Capacity Assessment — 100,000 Users</title>
<style>{CSS}</style>
</head>
<body>

<!-- COVER -->
<section class="page cover">
  <div>
    <div class="cover-badge">Confidential · Technical Assessment</div>
    <h1>Path+ Infrastructure Capacity &amp; Scalability Assessment</h1>
    <p class="subtitle">Evidence-based capacity plan for supporting 100,000 registered users with normal daily social networking activity.</p>
    <div class="cover-meta">
      <div><strong>Prepared for</strong>Path+ Product &amp; Engineering Leadership</div>
      <div><strong>Assessment date</strong>{esc(today)}</div>
      <div><strong>Scope</strong>Backend, database, storage, VPS, CDN, cost, security</div>
      <div><strong>Classification</strong>Analysis only — no application code was modified</div>
    </div>
  </div>
  <div class="cover-footer">
    Authoritative backend inspected: C:\\Users\\admin\\Downloads\\new\\path-plus-main\\path-plus-main\\backend<br/>
    Mobile workspace inspected: C:\\Users\\admin\\Downloads\\path-plus-main\\path-plus-main\\mobile<br/>
    Legend used throughout: <span class="tag tag-f">Fact</span> from source · <span class="tag tag-a">Assumption</span> modeled · <span class="tag tag-u">Unknown</span> needs measurement
  </div>
</section>

<!-- TOC -->
<section class="page">
  <h2><span class="section-num">0</span>Table of Contents</h2>
  <div class="toc">
    <ol>
      <li>Executive Summary</li>
      <li>Existing Architecture Assessment</li>
      <li>Project Technology Stack</li>
      <li>Capacity Assumptions &amp; Methodology</li>
      <li>Three Workload Scenarios</li>
      <li>Database Capacity Analysis</li>
      <li>VPS Resource Analysis</li>
      <li>Image &amp; Video Storage Analysis</li>
      <li>Bandwidth &amp; CDN Analysis</li>
      <li>Security, Reliability &amp; Backup</li>
      <li>Performance Bottlenecks &amp; Required Improvements</li>
      <li>Monthly Cost Estimation</li>
      <li>Recommended Infrastructure Architecture</li>
      <li>Scaling Roadmap</li>
      <li>Final Technical Recommendations</li>
      <li>Sources &amp; References</li>
    </ol>
  </div>
  <div class="note">
    <strong>Important:</strong> No production usage telemetry was available during this assessment.
    Workload figures are <em>modeled</em> from published social-app heuristics and Path+ feature surface area.
    They are not measured production statistics.
  </div>
  <div class="footer-line"><span>Path+ · Infrastructure Capacity Assessment</span><span>Confidential</span></div>
</section>

<!-- 1 EXEC -->
<section class="page">
  <h2><span class="section-num">1</span>Executive Summary</h2>
  <p class="lead">Path+ can reach 100,000 registered users, but <strong>not on the current Free-tier Supabase + single 512&nbsp;MB Bun process configuration</strong> without material reliability and performance risk. The limiting factors are database/API fan-out patterns and media egress—not raw VPS CPU alone.</p>

  <div class="kpis">
    <div class="kpi"><div class="label">Modeled DAU (Normal)</div><div class="value">{fmt(N['dau'])}</div><div class="hint">40% of 100k registered · assumption</div></div>
    <div class="kpi"><div class="label">Peak API RPS (Normal)</div><div class="value">{fmt(N['peak_rps'],1)}</div><div class="hint">≈5× average · assumption</div></div>
    <div class="kpi"><div class="label">Recommended monthly OpEx</div><div class="value">~$650–1,400</div><div class="hint">After media optimization; egress is the swing factor</div></div>
  </div>

  <h3>Verdict</h3>
  <ul class="tight">
    <li><span class="tag tag-f">Fact</span> Backend is a single Bun/Hono process (PM2 fork, 512&nbsp;MB restart limit) behind nginx on a VPS; data plane is Supabase Postgres + Storage + Realtime + Auth.</li>
    <li><span class="tag tag-f">Fact</span> Mobile client disables Supabase image transforms (<span class="code">IMAGE_TRANSFORMS_ENABLED = false</span>) because the current tenant returns FeatureNotEnabled—full-size media egress today.</li>
    <li><span class="tag tag-a">Assumption</span> At Normal usage, ~{fmt(N['api'])} API requests/day and ~{fmt(N['total_bw'],0)}&nbsp;GB/month combined transfer.</li>
    <li><strong>Supabase Free Plan is not suitable</strong> for this target (500&nbsp;MB DB, 1&nbsp;GB storage, 200 realtime connections, pausing risk, no PITR).</li>
    <li>Stay on Supabase (upgrade compute + Pro/Team). Add Redis, CDN/object-storage egress control, and fix P0 code bottlenecks before or while scaling users.</li>
  </ul>

  <h3>Most critical scalability risks discovered</h3>
  <div class="danger">
    <ol>
      <li><strong>P0 — Shared rate-limit key</strong> (<span class="code">src/lib/rate-limit.ts</span>): Authorization header sliced to 48 chars likely collapses authenticated users into one global 400&nbsp;req/min bucket.</li>
      <li><strong>P0 — Feed / inbox query fan-out</strong>: hot paths issue ~10–25 Supabase HTTP round-trips per request; inbox unread COUNTs scale with conversations.</li>
      <li><strong>P0/P1 — Unfiltered global messages realtime subscription</strong> on mobile amplifies Realtime fan-out.</li>
      <li><strong>P1 — Single process + in-memory caches + base64 uploads</strong>: cannot horizontally scale safely; 512&nbsp;MB restart under concurrent uploads.</li>
      <li><strong>P1 — Full-size media without transforms/CDN strategy</strong>: egress and latency dominate cost before API CPU does.</li>
    </ol>
  </div>
  <div class="footer-line"><span>Path+ · Infrastructure Capacity Assessment</span><span>§1 Executive Summary</span></div>
</section>

<!-- 2 EXISTING ARCH -->
<section class="page">
  <h2><span class="section-num">2</span>Existing Architecture Assessment</h2>
  <p>Path+ is a production iOS social network (Saudi Arabia focus, worldwide availability) with registration, profiles, moments (photo/video/text), chronological feed, friendships, DMs, reactions/comments, push, reporting/blocking, and an admin dashboard.</p>

  <h3>As-deployed topology (from repository evidence)</h3>
  <table>
    <tr><th>Layer</th><th>Current implementation</th><th>Evidence</th></tr>
    <tr><td>Client</td><td>Expo / React Native iOS app → HTTPS API + direct Supabase Auth/Storage/Realtime</td><td>mobile <span class="code">src/lib/api.ts</span>, <span class="code">supabase.ts</span></td></tr>
    <tr><td>Edge</td><td>nginx TLS termination; hosts api / admin / site.pathplus.store</td><td><span class="code">deploy/nginx.pathplus.conf</span></td></tr>
    <tr><td>API</td><td>Bun + Hono on port 3000; PM2 app <span class="code">pathplus-api</span>; 1 fork instance; max_memory_restart 512M</td><td><span class="code">ecosystem.config.cjs</span></td></tr>
    <tr><td>Admin</td><td>Next.js standalone on port 3001; PM2 <span class="code">pathplus-admin</span></td><td>same</td></tr>
    <tr><td>Database</td><td>Supabase Postgres via <span class="code">@supabase/supabase-js</span> (PostgREST). No app-level pool.</td><td><span class="code">package.json</span>, routes</td></tr>
    <tr><td>Auth</td><td>Supabase Auth (Bearer JWT). Custom OTP signup/reset via Resend. Separate admin JWT (jose).</td><td><span class="code">routes/auth.ts</span>, admin auth</td></tr>
    <tr><td>Realtime</td><td>No WebSocket server on VPS. Mobile uses Supabase Realtime <span class="code">postgres_changes</span>.</td><td>mobile hooks</td></tr>
    <tr><td>Media</td><td>Supabase Storage buckets <span class="code">Avatars</span>, <span class="code">Covers</span>, <span class="code">Posts</span> (public). Limits 15/50/25&nbsp;MB.</td><td><span class="code">routes/upload.ts</span></td></tr>
    <tr><td>Push</td><td>Expo Push API → APNs/FCM; tokens in <span class="code">user_devices</span></td><td><span class="code">lib/push.ts</span></td></tr>
    <tr><td>Cache / queue</td><td>None (Redis/workers absent). In-process Maps + setInterval crons.</td><td>grep / package.json</td></tr>
  </table>

  <div class="fact">
    <strong>Hostinger:</strong> User context states Hostinger VPS hosting. Repository confirms generic Linux VPS paths (<span class="code">/root/.bun/bin/bun</span>, nginx, PM2) but does <em>not</em> embed Hostinger plan SKUs. Exact current vCPU/RAM is <span class="tag tag-u">Unknown</span> and should be confirmed on the VPS.
  </div>
  <div class="note">
    The authoritative backend path contains nested legacy copies (<span class="code">backend/backend/</span>, <span class="code">backend/Path-Plus/</span>). Live runtime code is <span class="code">backend/src</span>. Treat nested trees as archival risk, not production.
  </div>
  <div class="footer-line"><span>Path+ · Infrastructure Capacity Assessment</span><span>§2 Existing Architecture</span></div>
</section>

<!-- 3 STACK -->
<section class="page">
  <h2><span class="section-num">3</span>Project Technology Stack</h2>
  <div class="two">
    <div>
      <h3>Backend (authoritative path)</h3>
      <ul class="tight">
        <li>Runtime: Bun</li>
        <li>Framework: Hono ^4.12.18</li>
        <li>Validation: Zod 4.1.11</li>
        <li>DB client: @supabase/supabase-js ^2.101.1</li>
        <li>DDL helper: postgres ^3.4.9 (max:1)</li>
        <li>Admin JWT: jose; passwords: bcryptjs</li>
        <li>Email: Resend</li>
        <li>Rate limit: hono-rate-limiter (memory store)</li>
        <li>Admin UI: Next.js 15 standalone</li>
        <li>Prisma/Better Auth: stubbed / unused at runtime</li>
      </ul>
    </div>
    <div>
      <h3>Mobile (inspected workspace)</h3>
      <ul class="tight">
        <li>Expo ~58 / RN 0.88 (workspace; docs partially stale)</li>
        <li>React Query 5; Zustand; FlashList</li>
        <li>Supabase JS for Auth/Storage/Realtime</li>
        <li>expo-notifications (Expo push tokens)</li>
        <li>Client JPEG resize (~1280px, q≈0.8)</li>
        <li>Video picker H264 960×540, ≤50&nbsp;MB / 60s</li>
        <li>API base: <span class="code">EXPO_PUBLIC_BACKEND_URL</span> → api.pathplus.store</li>
      </ul>
    </div>
  </div>

  <h3>Core API surface (mounted)</h3>
  <p class="small">/api/auth · /api/posts · /api/friends · /api/notifications · /api/conversations · /api/upload · /api/social · /api/admin · moderation &amp; users routers · health endpoints</p>

  <h3>Environment variable names (no secret values)</h3>
  <p class="small">SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL, PORT, BACKEND_URL, PUBLIC_APP_URL, RESEND_API_KEY, RESEND_FROM_EMAIL, ADMIN_JWT_SECRET, ADMIN_JWT_EXPIRES_IN, ADMIN_CORS_ORIGIN, ADMIN_DEFAULT_PASSWORD, CONFIG_ENCRYPTION_KEY, GOOGLE_PLACES_API_KEY, OPENAI_API_KEY, BETTER_AUTH_SECRET, EXPO_ACCESS_TOKEN; mobile EXPO_PUBLIC_BACKEND_URL, EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY.</p>
  <div class="footer-line"><span>Path+ · Infrastructure Capacity Assessment</span><span>§3 Technology Stack</span></div>
</section>

<!-- 4 METHOD -->
<section class="page">
  <h2><span class="section-num">4</span>Capacity Assumptions &amp; Methodology</h2>
  <h3>Inputs from the brief (accepted)</h3>
  <ul class="tight">
    <li>Registered users: <strong>100,000</strong></li>
    <li>DAU band: 30%–50% → 30k–50k</li>
    <li>Sessions/active user/day: 4–8</li>
    <li>Session duration: 5–15 minutes</li>
    <li>Geography: Saudi Arabia heavy + international</li>
  </ul>

  <h3>Additional modeling assumptions (explicit)</h3>
  <table>
    <tr><th>Parameter</th><th>Conservative</th><th>Normal</th><th>Heavy</th><th>Rationale</th></tr>
    <tr><td>DAU %</td><td>30%</td><td>40%</td><td>50%</td><td>Brief band</td></tr>
    <tr><td>Sessions / DAU</td><td>4</td><td>6</td><td>8</td><td>Brief band</td></tr>
    <tr><td>Session minutes</td><td>6</td><td>10</td><td>14</td><td>Within 5–15</td></tr>
    <tr><td>API calls / session</td><td>28</td><td>48</td><td>75</td><td>Feed, badges, chat, RT invalidations observed in client</td></tr>
    <tr><td>DB RTTs / API call</td><td>8</td><td>10</td><td>14</td><td>Current fan-out architecture (feed often higher)</td></tr>
    <tr><td>Peak multiplier</td><td>4×</td><td>5×</td><td>6×</td><td>Evening KSA peak heuristic</td></tr>
    <tr><td>Photo size</td><td colspan="3">~420 KB JPEG after client compress</td><td>Client manipulator settings</td></tr>
    <tr><td>Video size</td><td colspan="3">~9.5 MB average retained</td><td>960×540 export; ≤50 MB cap</td></tr>
  </table>

  <h3>Calculation method</h3>
  <p>Daily API = DAU × sessions × API/session.&nbsp;&nbsp;Avg RPS = daily API / 86,400.&nbsp;&nbsp;Peak RPS = Avg × peak factor.&nbsp;&nbsp;
  Avg concurrent users ≈ DAU × sessions × session_min / (24×60).&nbsp;&nbsp;
  Peak concurrent ≈ Avg × peak factor.&nbsp;&nbsp;
  Realtime channels ≈ peak concurrent × ~4.2–5 channels/user (tabs layout subscriptions + chat).</p>
  <div class="note">Where Path+ source shows heavier multipliers (e.g., 15–25 RTTs on feed), Normal/Heavy DB figures intentionally sit above a “clean” 2–3 RTT design to reflect <em>current</em> code cost.</div>
  <div class="footer-line"><span>Path+ · Infrastructure Capacity Assessment</span><span>§4 Methodology</span></div>
</section>

<!-- 5 SCENARIOS -->
<section class="page">
  <h2><span class="section-num">5</span>Three Workload Scenarios</h2>
  <p>All figures below are <span class="tag tag-a">Assumption</span> modeled outputs for 100,000 registered users—not measured telemetry.</p>
  {workload_table()}

  <h3>Daily API volume comparison</h3>
  <div class="bar-chart">
    {bar("Conservative", RESULTS["Conservative"]["api"], max_api, fmt(RESULTS["Conservative"]["api"]))}
    {bar("Normal", RESULTS["Normal"]["api"], max_api, fmt(RESULTS["Normal"]["api"]))}
    {bar("Heavy", RESULTS["Heavy"]["api"], max_api, fmt(RESULTS["Heavy"]["api"]))}
  </div>

  <h3>Interpretation for Path+</h3>
  <ul class="tight">
    <li><strong>Conservative</strong> (~{fmt(RESULTS['Conservative']['peak_rps'],0)} peak RPS): achievable on a modest VPS <em>after</em> P0 fixes; Free Supabase still inadequate.</li>
    <li><strong>Normal</strong> (~{fmt(RESULTS['Normal']['peak_rps'],0)} peak RPS): design target for this report. Needs Pro Supabase with Large/XL compute class, Redis, CDN, and query consolidation.</li>
    <li><strong>Heavy</strong> (~{fmt(RESULTS['Heavy']['peak_rps'],0)} peak RPS): requires multi-instance API, stronger DB (XL/2XL), realtime connection overages, and media CDN offload.</li>
  </ul>
  <div class="footer-line"><span>Path+ · Infrastructure Capacity Assessment</span><span>§5 Workload Scenarios</span></div>
</section>

<!-- 6 DATABASE -->
<section class="page">
  <h2><span class="section-num">6</span>Database Capacity Analysis</h2>
  <h3>Engine &amp; hosting</h3>
  <p><span class="tag tag-f">Fact</span> PostgreSQL on Supabase, accessed exclusively through PostgREST/supabase-js (service role + user JWT clients). Prisma schema is an unused SQLite stub. No application connection pool; concurrency bounded by Supabase PostgREST / Supavisor limits.</p>

  <h3>Schema coverage (from migrations + boot SQL)</h3>
  <p class="small">profiles, posts, reactions, comments, friendships, notifications, conversations, conversation_participants, messages, close_friends, user_blocks, saved_posts, hashtags, post_hashtags, mentions, post_shares, post_views, reports, user_devices, account_deletion_requests, pending_registrations, password_reset_otps, admin_*, app_settings/content, external_service_settings. Storage buckets: Avatars, Covers, Posts.</p>
  <p class="small">Indexes exist on major foreign keys and time-ordered access paths (posts, messages, notifications, friendships). Likely gaps: pg_trgm for ILIKE search; composite keys matching ORDER BY created_at,id; notification dedupe composites.</p>

  <h3>Expected records at 100k users (modeled)</h3>
  <table>
    <tr><th>Table group</th><th>Expected rows</th><th>Notes</th></tr>
    {record_rows}
  </table>

  <h3>Growth forecast (Normal daily growth model)</h3>
  <table>
    <tr><th>Horizon</th><th>DB data</th><th>Indexes (~35%)</th><th>Object storage</th><th>Backup store</th></tr>
    {growth_rows}
  </table>
  <p class="small">Baseline at “day 0 of 100k steady state” modeled as ~12&nbsp;GB DB + ~180&nbsp;GB media — <span class="tag tag-a">Assumption</span>, replace with Supabase dashboard measurements.</p>

  <h3>Free plan suitability</h3>
  <div class="danger">
    <strong>Supabase Free is not suitable</strong> for 100k users: 500&nbsp;MB DB, 1&nbsp;GB file storage, 5&nbsp;GB egress, 200 peak realtime connections, 50k MAU, project pausing, no automatic backups/PITR. Path+ already uses Auth + Storage + Realtime + heavy PostgREST traffic.
  </div>

  <h3>Recommended Postgres sizing (100k, Normal)</h3>
  <table>
    <tr><th>Item</th><th>Recommendation</th><th>Why</th></tr>
    <tr><td>Plan</td><td>Supabase Pro (or Team if compliance)</td><td>Backups, MAU headroom, Smart CDN, no pause</td></tr>
    <tr><td>Compute</td><td>Large (2 vCPU / 8&nbsp;GB) → XL (4 / 16&nbsp;GB) if feed RPCs not added</td><td>Fan-out + realtime RLS CPU</td></tr>
    <tr><td>Disk</td><td>Start 40–80&nbsp;GB GP, monitor</td><td>Data + indexes + bloat</td></tr>
    <tr><td>Pooler connections</td><td>Keep service-role chattiness down; prefer SQL RPCs</td><td>App opens many short HTTP queries today</td></tr>
    <tr><td>PITR</td><td>Enable 7–14 day PITR</td><td>Social data RPO minutes–hours</td></tr>
    <tr><td>Retention</td><td>Notifications 90 days; message media lifecycle; admin_logs 180 days</td><td>Contain fastest tables</td></tr>
  </table>
  <p><strong>Independent Postgres</strong> (e.g., managed RDS/Cloud SQL) is optional later; migrating off Supabase is <em>not</em> recommended now because Auth, Realtime, and Storage are deeply integrated. Cost delta does not justify rewrite risk at this stage.</p>
  <div class="footer-line"><span>Path+ · Infrastructure Capacity Assessment</span><span>§6 Database</span></div>
</section>

<!-- 7 VPS -->
<section class="page">
  <h2><span class="section-num">7</span>VPS Server Capacity Analysis</h2>
  <p><span class="tag tag-f">Fact</span> Process model: one Bun API + one Next admin, both 512&nbsp;MB PM2 limits, fork mode. Marketing HTML also served from the API process. Uploads may buffer base64 in memory. No Redis. Boot runs ~190 exec_sql statements + backfills.</p>

  <h3>Three infrastructure configurations</h3>
  <table>
    <tr><th>Config</th><th>Compute</th><th>Roles</th><th>When</th></tr>
    <tr><td><strong>1. Minimum viable production</strong></td><td>Hostinger KVM 4 — 4 vCPU / 16&nbsp;GB / 200&nbsp;GB NVMe / 16&nbsp;TB BW<br/><span class="small">Intro ~$12.99/mo · renews ~$28.99/mo (verified Hostinger public pricing, 24-mo term)</span></td><td>API+admin+nginx only. DB/storage remain on Supabase. Raise PM2 memory to 1–1.5&nbsp;GB. Fix P0 rate-limit &amp; boot jobs.</td><td>After code hotfixes; ≤~10–30k users transitioning up</td></tr>
    <tr><td><strong>2. Recommended production (100k)</strong></td><td>Hostinger KVM 8 — 8 vCPU / 32&nbsp;GB / 400&nbsp;GB / 32&nbsp;TB<br/><span class="small">Intro ~$25.99/mo · renews ~$49.99/mo</span><br/>or 2× KVM 4 (API primary + worker/admin)</td><td>2 Bun instances behind nginx upstream once Redis added; separate worker for push/cron; admin on same or second box.</td><td>50k–100k with Normal load</td></tr>
    <tr><td><strong>3. High availability</strong></td><td>2–3 VPS (API) + managed Redis + optional staging VPS; multi-AZ mindset</td><td>Active-active API, health-checked LB (Cloudflare/nginx), isolated workers, offsite backups</td><td>&gt;100k or stricter uptime</td></tr>
  </table>

  <h3>Resource rationale</h3>
  <ul class="tight">
    <li><strong>CPU:</strong> Bun is single-threaded per process; PNG avatar generation + bcryptjs + JSON media inflate compete on one core today → need multiple processes, not only bigger RAM.</li>
    <li><strong>RAM:</strong> 512&nbsp;MB restart limit is unsafe for 50&nbsp;MB video base64 paths; budget ≥2&nbsp;GB RSS headroom per API instance after fixes.</li>
    <li><strong>Disk:</strong> App+logs only on VPS (50–100&nbsp;GB fine). Do not store user media on VPS.</li>
    <li><strong>Bandwidth:</strong> Hostinger 16–32&nbsp;TB is ample for API JSON; media must not hairpin through VPS.</li>
  </ul>
  <div class="note">4 vCPU/16&nbsp;GB is a valid <em>API host</em> size only if DB/media/realtime stay off-box and P0/P1 code issues are fixed. It is insufficient as a “everything on one VPS including Postgres/media” design—and Path+ already correctly externalizes DB/media to Supabase.</div>
  <div class="footer-line"><span>Path+ · Infrastructure Capacity Assessment</span><span>§7 VPS</span></div>
</section>

<!-- 8 STORAGE -->
<section class="page">
  <h2><span class="section-num">8</span>Image &amp; Video Storage Analysis</h2>
  <table>
    <tr><th>Question</th><th>Finding</th></tr>
    <tr><td>Where are photos stored?</td><td><span class="tag tag-f">Fact</span> Supabase Storage public buckets Avatars, Covers, Posts</td></tr>
    <tr><td>Where are videos stored?</td><td><span class="tag tag-f">Fact</span> Same Posts bucket; client often uploads direct to Supabase</td></tr>
    <tr><td>CDN?</td><td>Supabase Smart CDN on paid plans; no separate Cloudflare/R2 config in repo. Image transforms disabled in app.</td></tr>
    <tr><td>Served from VPS?</td><td>Only default generated avatars under <span class="code">/static/default-avatars</span></td></tr>
    <tr><td>Compression?</td><td>Client-side JPEG resize; no server sharp/ffmpeg</td></tr>
    <tr><td>Transcoding / multi-bitrate?</td><td><span class="tag tag-f">Fact</span> None</td></tr>
    <tr><td>Thumbnails?</td><td>Not generated server-side</td></tr>
  </table>

  <h3>Storage estimate for 100k users (Normal accumulation ~12 months)</h3>
  <table>
    <tr><th>Category</th><th>Estimate</th><th>Basis</th></tr>
    <tr><td>Compressed photos</td><td>~{fmt(N['photos']*PHOTO_KB/1024/1024*365,0)} GB / year incremental</td><td>{fmt(N['photos'],0)} photos/day × {PHOTO_KB} KB</td></tr>
    <tr><td>Original photos</td><td>≈0 (not retained separately)</td><td>Client uploads already compressed</td></tr>
    <tr><td>Videos (single rendition)</td><td>~{fmt(N['videos']*VIDEO_MB/1024*365,0)} GB / year</td><td>{fmt(N['videos'],0)}/day × {VIDEO_MB} MB</td></tr>
    <tr><td>Transcoded ladder</td><td>+0 today; +1.6–2.2× if added</td><td>Proposed only</td></tr>
    <tr><td>Thumbnails</td><td>~{fmt(N['photos']*THUMB_KB/1024/1024*365,1)} GB / year if generated</td><td>{THUMB_KB} KB each</td></tr>
    <tr><td>Avatars/covers</td><td>~15–40 GB cumulative</td><td>~{AVATAR_KB} KB × users × revisions</td></tr>
    <tr><td>Temp uploads</td><td>&lt;5 GB</td><td>Should be ephemeral</td></tr>
    <tr><td>Backup/archive of media</td><td>+100% cold copy optional</td><td>R2 IA / Glacier-class</td></tr>
  </table>
  <p>Using growth table: ~{fmt_bytes_gb(GROWTH[2]['media_gb'])} object storage at 12 months and ~{fmt_bytes_gb(GROWTH[3]['media_gb'])} at 24 months under Normal model (includes baseline).</p>

  <h3>Storage platform comparison</h3>
  <table>
    <tr><th>Option</th><th>Pros</th><th>Cons / cost signal</th></tr>
    <tr><td>Stay Supabase Storage + enable Image Transforms</td><td>Already integrated; Smart CDN; least code change</td><td>Egress $0.09/GB uncached / $0.03 cached beyond 250&nbsp;GB; transforms billed; Free transforms unavailable</td></tr>
    <tr><td>Cloudflare R2 + CDN</td><td>Egress $0; $0.015/GB-mo storage (verified)</td><td>Migration + signed URL upload rewrite; ops ownership</td></tr>
    <tr><td>Amazon S3 + CloudFront</td><td>Mature ecosystem, lifecycle rules</td><td>Egress fees dominate social apps; more complex than R2 for this use case</td></tr>
  </table>
  <p><strong>Recommendation:</strong> Short term — upgrade Supabase, enable image transformations, turn <span class="code">IMAGE_TRANSFORMS_ENABLED</span> on after verifying. Medium term — evaluate R2 for hot media if monthly egress charges exceed ~$150–200.</p>
  <div class="footer-line"><span>Path+ · Infrastructure Capacity Assessment</span><span>§8 Storage</span></div>
</section>

<!-- 9 BANDWIDTH -->
<section class="page">
  <h2><span class="section-num">9</span>Bandwidth &amp; CDN Analysis</h2>
  <p>Monthly transfer model (GB). Photo downloads apply a cache-miss factor (device/CDN). Video uses average megabytes transferred per play-start (partial play / <span class="code">preload</span>), not full object size every time.</p>
  {bw_breakdown()}

  <h3>Monthly bandwidth comparison</h3>
  <div class="bar-chart">
    {bar("Conservative", RESULTS["Conservative"]["total_bw"], max_bw, fmt(RESULTS["Conservative"]["total_bw"],0)+" GB")}
    {bar("Normal", RESULTS["Normal"]["total_bw"], max_bw, fmt(RESULTS["Normal"]["total_bw"],0)+" GB")}
    {bar("Heavy", RESULTS["Heavy"]["total_bw"], max_bw, fmt(RESULTS["Heavy"]["total_bw"],0)+" GB")}
  </div>

  <h3>Hostinger VPS bandwidth</h3>
  <p>KVM 4/8 advertise 16–32&nbsp;TB/month — sufficient for API JSON and admin traffic. <strong>It is the wrong place to terminate media downloads.</strong> If media were proxied via VPS, Normal/Heavy video+photo traffic would waste CPU/RAM and risk fair-use scrutiny.</p>

  <h3>Saudi Arabia &amp; international delivery</h3>
  <ul class="tight">
    <li>Prefer a CDN with Middle East PoPs (Cloudflare or Supabase Smart CDN).</li>
    <li>Keep API region close to DB (Supabase project region). Confirm current region <span class="tag tag-u">Unknown</span>.</li>
    <li>Adaptive image sizes (avatar 150², feed ~720–1080) cut photo egress dramatically.</li>
  </ul>

  <h3>Cost reduction levers</h3>
  <ol>
    <li>Enable image transforms / responsive URLs</li>
    <li>Generate posters/thumbnails; change video <span class="code">preload</span> to metadata</li>
    <li>Optional HLS / dual-resolution later</li>
    <li>CDN cache immutable object paths</li>
    <li>Keep timeline cursor pagination (already present on feed)</li>
    <li>Avoid base64 upload path through API</li>
  </ol>
  <div class="footer-line"><span>Path+ · Infrastructure Capacity Assessment</span><span>§9 Bandwidth</span></div>
</section>

<!-- 10 SECURITY -->
<section class="page">
  <h2><span class="section-num">10</span>Security, Reliability &amp; Backup</h2>
  <table>
    <tr><th>Area</th><th>Current state</th><th>Target for 100k</th></tr>
    <tr><td>DB security</td><td>Supabase RLS + service role on server</td><td>Audit RLS; least-privilege; rotate service role; restrict exec_sql</td></tr>
    <tr><td>API protection</td><td>Rate limits present but keying flawed; CORS allows broad localhost/LAN patterns</td><td>Per-user limits; tighten CORS; nginx limit_req; WAF</td></tr>
    <tr><td>Auth</td><td>Supabase JWT; OTP hashed; admin jose JWT + denylist</td><td>Confirm admin default password rotated; local JWT verify to cut Auth RTT</td></tr>
    <tr><td>DDoS</td><td>No Cloudflare/WAF in repo</td><td>Cloudflare proxy for api/site</td></tr>
    <tr><td>Media uploads</td><td>MIME allowlists + size caps; public buckets</td><td>Signed upload URLs; private buckets + signed read for DMs if needed</td></tr>
    <tr><td>Backups</td><td>Depends on Supabase plan — Free has none</td><td>Daily + PITR; monthly offsite export</td></tr>
    <tr><td>RTO / RPO</td><td>Not defined in repo</td><td>RTO ≤ 4h API; RPO ≤ 15m DB (PITR)</td></tr>
    <tr><td>Monitoring</td><td>console + PM2; public health endpoints leak readiness detail</td><td>APM, error tracking, uptime checks; auth-protect ready probes</td></tr>
  </table>

  <h3>Critical weaknesses observed in code</h3>
  <ul class="tight">
    <li>Shared authenticated rate-limit bucket (P0)</li>
    <li><span class="code">cf-connecting-ip</span> trusted without Cloudflare → auth limiter bypass</li>
    <li>Unauthenticated <span class="code">/api/upload/test-storage</span> bucket listing</li>
    <li>Public <span class="code">/health?ready=1</span> exposes configuration flags</li>
    <li>Unlimited CPU path on default avatar generator</li>
    <li>Docs mention default admin credentials historically — verify rotation (<span class="tag tag-u">Unknown</span>)</li>
  </ul>
  <div class="footer-line"><span>Path+ · Infrastructure Capacity Assessment</span><span>§10 Security</span></div>
</section>

<!-- 11 BOTTLENECKS -->
<section class="page">
  <h2><span class="section-num">11</span>Performance Bottlenecks &amp; Required Improvements</h2>
  <table>
    <tr><th>ID</th><th>Issue / location</th><th>Impact</th><th>Solution</th><th>Pri</th><th>Type</th></tr>
    <tr><td>A</td><td>Rate-limit key <span class="code">authorization.slice(0,48)</span> — <span class="code">src/lib/rate-limit.ts</span></td><td>Global 429s under modest concurrency</td><td>Key by verified userId / full token hash</td><td><span class="tag tag-p0">P0</span></td><td>Code</td></tr>
    <tr><td>B</td><td>Feed fan-out — <span class="code">routes/posts.ts</span>, <span class="code">lib/load-posts.ts</span></td><td>15–25 Supabase RTTs / feed page</td><td>SQL RPC / view; denormalize reaction summaries</td><td><span class="tag tag-p0">P0</span></td><td>Code+DB</td></tr>
    <tr><td>C</td><td>Inbox unread N+1 — <span class="code">routes/conversations.ts</span></td><td>Linear with chats; also on every push badge</td><td>last_message + unread counters</td><td><span class="tag tag-p0">P0</span></td><td>Code+DB</td></tr>
    <tr><td>D</td><td>Global messages realtime — mobile <span class="code">use-unread-messages.ts</span></td><td>Realtime fan-out &amp; connection cost</td><td>Filter by participant; server badge channel</td><td><span class="tag tag-p0">P0</span></td><td>Code</td></tr>
    <tr><td>E</td><td>20s friendship poll fallback</td><td>Steady background API load</td><td>Subscribe-first; backoff poll</td><td><span class="tag tag-p1">P1</span></td><td>Code</td></tr>
    <tr><td>F</td><td>Boot DDL/backfills — <span class="code">src/index.ts</span></td><td>Restart storms hit DB</td><td>One-shot migrations; feature flag</td><td><span class="tag tag-p1">P1</span></td><td>Code</td></tr>
    <tr><td>G</td><td>Push per-token HTTP + receipt polls — <span class="code">lib/push.ts</span></td><td>Latency &amp; outbound amplification</td><td>Batch 100; queue worker</td><td><span class="tag tag-p1">P1</span></td><td>Code+Infra</td></tr>
    <tr><td>H</td><td>Single Bun instance / memory caches</td><td>No HA; sticky cache</td><td>Redis + 2+ instances</td><td><span class="tag tag-p1">P1</span></td><td>Infra+Code</td></tr>
    <tr><td>I</td><td>Base64 upload buffering — <span class="code">routes/upload.ts</span></td><td>OOM / PM2 restart</td><td>Signed direct uploads only</td><td><span class="tag tag-p1">P1</span></td><td>Code</td></tr>
    <tr><td>J</td><td>ILIKE search w/o trigram</td><td>Seq scans as tables grow</td><td>pg_trgm GIN; use post_hashtags</td><td><span class="tag tag-p2">P2</span></td><td>DB+Code</td></tr>
    <tr><td>K</td><td>Image transforms off — <span class="code">lib/images.ts</span></td><td>Egress &amp; latency</td><td>Enable on Pro; or R2+image resizing</td><td><span class="tag tag-p1">P1</span></td><td>Infra+Code</td></tr>
    <tr><td>L</td><td>Video WebView preload=auto</td><td>Bandwidth amplification</td><td>metadata preload; virtualize</td><td><span class="tag tag-p2">P2</span></td><td>Code</td></tr>
    <tr><td>M</td><td>No APM / metrics</td><td>Blind scaling</td><td>OpenTelemetry + uptime + pg_stat_statements</td><td><span class="tag tag-p2">P2</span></td><td>Infra</td></tr>
  </table>
  <div class="footer-line"><span>Path+ · Infrastructure Capacity Assessment</span><span>§11 Bottlenecks</span></div>
</section>

<!-- 12 COSTS -->
<section class="page">
  <h2><span class="section-num">12</span>Monthly Cost Estimation (USD)</h2>
  <p>Prices marked <strong>Verified</strong> were checked against public provider pages on the assessment date. Usage lines are <strong>Estimates</strong>. Taxes excluded. Hostinger shows intro vs renewal; table uses renewal-oriented planning rates for conservatism on Budget/Recommended where noted.</p>

  <h3>A. Budget configuration</h3>
  <table>
    <tr><th>Service</th><th>Plan / size</th><th>Monthly</th><th>Status</th></tr>
    <tr><td>Hostinger VPS</td><td>KVM 4 (4 vCPU / 16 GB) — plan using renewal rate</td><td>$29</td><td>Verified list (~$12.99 intro / ~$28.99 renew)</td></tr>
    <tr><td>Supabase</td><td>Pro + Large compute (2 vCPU / 8 GB); $25 plan includes $10 Micro credit → compute net ~$100</td><td>~$125</td><td>Verified list + estimate</td></tr>
    <tr><td>Supabase disk / storage overage</td><td>DB disk + file storage beyond included</td><td>$40–90</td><td>Estimate (usage-based)</td></tr>
    <tr><td>Supabase egress overage</td><td>Must enable transforms + CDN caching; otherwise Normal model (~{fmt(N['total_bw'],0)} GB) is not affordable on Supabase egress rates</td><td>$150–400</td><td>Estimate if optimized to ~2–6 TB cached</td></tr>
    <tr><td>PITR add-on</td><td>7 days</td><td>$100</td><td>Verified list</td></tr>
    <tr><td>Redis</td><td>Upstash / Redis Cloud free–small</td><td>$0–10</td><td>Estimate</td></tr>
    <tr><td>Monitoring</td><td>Uptime + basic error tracking</td><td>$0–29</td><td>Estimate</td></tr>
    <tr><td>Resend / Expo / Places</td><td>Existing transactional usage</td><td>$20–60</td><td>Estimate variable</td></tr>
    <tr><td colspan="2"><strong>Budget total (typical)</strong></td><td><strong>~$450–750</strong></td><td>Requires media optimization; unoptimized egress can exceed $1k alone</td></tr>
  </table>

  <h3>B. Recommended production</h3>
  <table>
    <tr><th>Service</th><th>Plan / size</th><th>Monthly</th><th>Status</th></tr>
    <tr><td>Hostinger VPS</td><td>KVM 8 or 2× KVM 4</td><td>$50–60</td><td>Verified (~$49.99 KVM8 renew; or 2×$29)</td></tr>
    <tr><td>Supabase</td><td>Pro + XL compute (4 vCPU / 16 GB) ≈ $25 + ($210−$10 credit)</td><td>~$225</td><td>Verified compute table</td></tr>
    <tr><td>Realtime overage</td><td>Peak connections &gt;500 @ $10 / 1k</td><td>$50–150</td><td>Estimate from peak concurrent model</td></tr>
    <tr><td>Media egress strategy</td><td><strong>Preferred:</strong> Cloudflare R2 (~$0.015/GB-mo, egress free) for Posts bucket<br/><strong>Alt:</strong> Supabase Storage + transforms + Smart CDN cached egress ($0.03/GB overage)</td><td>$40–120 (R2 path)<br/>or $200–500 (Supabase path)</td><td>R2 rates verified; egress volume estimated</td></tr>
    <tr><td>PITR 14 days</td><td>2× 7-day units</td><td>$200</td><td>Verified unit price ×2</td></tr>
    <tr><td>Redis</td><td>Managed 1–2 GB</td><td>$15–45</td><td>Estimate</td></tr>
    <tr><td>Cloudflare</td><td>Proxied DNS/WAF for api/site</td><td>$0–20</td><td>Free tier often enough; Pro optional</td></tr>
    <tr><td>Monitoring / logs</td><td>APM + alerts</td><td>$30–80</td><td>Estimate</td></tr>
    <tr><td>Email / push / Places</td><td>Production volume</td><td>$40–100</td><td>Estimate</td></tr>
    <tr><td colspan="2"><strong>Recommended total (R2 media path)</strong></td><td><strong>~$650–1,000</strong></td><td>Most likely mid ~$800</td></tr>
    <tr><td colspan="2"><strong>Recommended total (Supabase media only, optimized)</strong></td><td><strong>~$850–1,400</strong></td><td>Egress swing factor</td></tr>
  </table>
  <div class="danger">
    <strong>Unoptimized warning:</strong> The Normal bandwidth model (~{fmt(N['total_bw'],0)} GB/month) at Supabase uncached egress ($0.09/GB beyond 250 GB) would imply roughly <em>thousands of dollars per month in egress alone</em>.
    That is why image transforms, video preload changes, and/or R2 (zero egress) are mandatory for a 100k-user Path+ — not optional polish.
  </div>

  <h3>C. High-availability configuration</h3>
  <table>
    <tr><th>Service</th><th>Plan / size</th><th>Monthly</th><th>Status</th></tr>
    <tr><td>VPS / compute</td><td>3× API-capable hosts or upgraded fleet</td><td>$120–220</td><td>Estimate on Hostinger list rates</td></tr>
    <tr><td>Supabase</td><td>Team ($599) + 2XL compute ($410) − credits</td><td>~$1,000+</td><td>Verified list</td></tr>
    <tr><td>R2 media + Cloudflare</td><td>1–2 TB storage, free egress</td><td>$30–80</td><td>Verified storage rate</td></tr>
    <tr><td>Redis HA + workers</td><td>Production cluster</td><td>$60–150</td><td>Estimate</td></tr>
    <tr><td>PITR + offsite backups</td><td>14–28 days + object versioning</td><td>$200–350</td><td>Mix verified/estimate</td></tr>
    <tr><td>Observability</td><td>Full APM/log drain</td><td>$100–250</td><td>Estimate (Supabase log drain $60+)</td></tr>
    <tr><td colspan="2"><strong>HA total</strong></td><td><strong>~$1,700–2,600+</strong></td><td>Team plan drives step-up; keep media on R2</td></tr>
  </table>
  <div class="note">MAU note: Supabase Pro includes 100,000 MAU; if monthly active approaches registered 100k, overage is $0.00325/MAU (verified). Path+ DAU model is lower than MAU; still monitor Auth MAU separately from DAU.</div>
  <div class="footer-line"><span>Path+ · Infrastructure Capacity Assessment</span><span>§12 Costs</span></div>
</section>

<!-- 13 ARCHITECTURE -->
<section class="page">
  <h2><span class="section-num">13</span>Recommended Infrastructure Architecture</h2>
  <div class="arch">{arch_svg()}</div>
  <h3>Existing vs proposed</h3>
  <ul class="tight">
    <li><strong>Keep:</strong> iOS app, nginx, Bun/Hono API, Next admin, Supabase Auth/DB/Realtime/Storage, Expo Push, Resend, Google Places proxy.</li>
    <li><strong>Upgrade:</strong> Supabase plan/compute; PM2 memory; enable image transforms; protect health/test endpoints.</li>
    <li><strong>Add:</strong> Redis (rate limit + auth/block caches), background worker, CDN/WAF, monitoring, PITR, optional R2 for egress-sensitive media, load-balanced API instances.</li>
  </ul>
  <div class="footer-line"><span>Path+ · Infrastructure Capacity Assessment</span><span>§13 Architecture</span></div>
</section>

<!-- 14 ROADMAP -->
<section class="page">
  <h2><span class="section-num">14</span>Scaling Roadmap</h2>
  <table>
    <tr><th>Stage</th><th>Users</th><th>Infra</th><th>Triggers to advance</th></tr>
    <tr><td><strong>1</strong></td><td>≤10k</td><td>KVM 2–4; Supabase Pro Micro/Small; fix P0 rate-limit; remove boot backfills; basic uptime</td><td>p95 API &gt;800ms; 429s; DB CPU &gt;60%</td></tr>
    <tr><td><strong>2</strong></td><td>10–50k</td><td>KVM 4; Supabase Medium/Large; enable transforms; signed uploads; Redis; push batching; notification retention</td><td>Realtime connection near 500; egress bill spike; feed p95</td></tr>
    <tr><td><strong>3</strong></td><td>50–100k</td><td>KVM 8 or dual VPS; Supabase Large/XL; 2 API instances; workers; CDN/WAF; PITR; query RPCs for feed/inbox</td><td>Need HA; MAU near 100k; multi-region latency complaints</td></tr>
    <tr><td><strong>4</strong></td><td>&gt;100k</td><td>HA topology; Team/Enterprise Supabase or read replicas; R2 media; consider message partitioning / cold storage</td><td>Sustained Heavy scenario metrics</td></tr>
  </table>
  <p>Avoid premature Kubernetes. Path+’s bottleneck is chatty PostgREST access patterns and media egress—fix those before orchestrating containers.</p>
  <div class="footer-line"><span>Path+ · Infrastructure Capacity Assessment</span><span>§14 Roadmap</span></div>
</section>

<!-- 15 RECS -->
<section class="page">
  <h2><span class="section-num">15</span>Final Technical Recommendations</h2>
  <ol>
    <li><strong>Immediately (code):</strong> Fix rate-limit keying; gate boot migrations; remove or auth-protect test/ready leaks; filter realtime message subscriptions.</li>
    <li><strong>Immediately (infra):</strong> Move off Supabase Free to Pro; size compute to Large minimum for 100k target planning; enable PITR; raise PM2 memory limits.</li>
    <li><strong>Next sprint:</strong> Collapse feed/inbox/badge into SQL RPCs; batch Expo pushes; signed direct uploads; enable image transforms.</li>
    <li><strong>Before 50k DAU-equivalent:</strong> Redis + dual API processes; Cloudflare in front; video preload tuning; notification retention job.</li>
    <li><strong>Do not:</strong> Host Postgres or user media on the Hostinger VPS; scale instances before fixing shared in-memory caches; treat modeled RPS as live metrics.</li>
  </ol>

  <div class="kpis">
    <div class="kpi"><div class="label">VPS target</div><div class="value">8 vCPU / 32 GB</div><div class="hint">or 2× 4 vCPU / 16 GB</div></div>
    <div class="kpi"><div class="label">Database target</div><div class="value">Supabase XL</div><div class="hint">Pro + 4 vCPU / 16 GB RAM</div></div>
    <div class="kpi"><div class="label">Media / CDN</div><div class="value">R2 + CDN</div><div class="hint">~$650–1,000 / mo recommended OpEx</div></div>
  </div>
  <div class="footer-line"><span>Path+ · Infrastructure Capacity Assessment</span><span>§15 Recommendations</span></div>
</section>

<!-- 16 SOURCES -->
<section class="page">
  <h2><span class="section-num">16</span>Sources &amp; References</h2>
  <h3>Primary evidence (inspected)</h3>
  <ul class="tight">
    <li>Backend tree: <span class="code">C:\\Users\\admin\\Downloads\\new\\path-plus-main\\path-plus-main\\backend</span> — package.json, ecosystem.config.cjs, .env.example, src/**, deploy/**, prisma stub, migrations</li>
    <li>Mobile tree: <span class="code">C:\\Users\\admin\\Downloads\\path-plus-main\\path-plus-main\\mobile</span> — app.config.js, src/lib/**, feed/chat/push hooks</li>
  </ul>
  <h3>Pricing pages consulted (public)</h3>
  <ul class="tight">
    <li>https://supabase.com/pricing — Pro/Team, compute sizes, egress, storage, realtime, PITR, MAU</li>
    <li>https://supabase.com/docs/guides/platform/compute-and-disk</li>
    <li>https://www.hostinger.com/vps-hosting — KVM 1/2/4/8 intro &amp; renewal</li>
    <li>https://developers.cloudflare.com/r2/pricing/ — storage &amp; operations; egress free</li>
  </ul>
  <h3>Not available / requires measurement</h3>
  <ul class="tight">
    <li>Live VPS CPU/RAM/disk utilization and exact Hostinger SKU</li>
    <li>Supabase project region, current plan tier, row counts, pg_stat_statements</li>
    <li>Production nginx access-log RPS and p95 latencies</li>
    <li>Actual average media object sizes in Storage</li>
  </ul>
  <div class="fact">
    This document is an infrastructure assessment of the <strong>existing</strong> Path+ application. No application source, schema, or production configuration was modified to produce this report.
  </div>
  <div class="footer-line"><span>Path+ · Infrastructure Capacity Assessment</span><span>§16 Sources · End of report</span></div>
</section>

</body>
</html>
"""


def main() -> None:
    HTML_PATH.write_text(build_html(), encoding="utf-8")
    print(f"Wrote {HTML_PATH}")
    # Also mirror calculations summary for validation
    for name, r in RESULTS.items():
        print(
            f"{name}: DAU={r['dau']:.0f} API/day={r['api']:.0f} "
            f"avgRPS={r['avg_rps']:.1f} peakRPS={r['peak_rps']:.1f} "
            f"BW={r['total_bw']:.0f}GB/mo media/day={r['daily_media_gb']:.2f}GB"
        )


if __name__ == "__main__":
    main()
