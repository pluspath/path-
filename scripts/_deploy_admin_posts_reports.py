from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import paramiko

LOCAL = Path(__file__).resolve().parents[1]
REMOTE = "/root/path-/backend"
FILES = [
    "src/admin/services/posts.service.ts",
    "src/admin/services/reports.service.ts",
    "src/admin/services/comments.service.ts",
    "src/admin/repositories/data.repository.ts",
    "src/admin/repositories/report.repository.ts",
    "src/admin/routes/posts.routes.ts",
    "src/admin/routes/reports.routes.ts",
    "src/admin/routes/comments.routes.ts",
    "src/lib/moment-feed.ts",
    "src/routes/posts.ts",
    "admin/src/app/(console)/posts/page.tsx",
    "admin/src/app/(console)/posts/[id]/page.tsx",
    "admin/src/app/(console)/reports/page.tsx",
    "admin/src/app/(console)/reports/[id]/page.tsx",
    "admin/src/components/ui/button.tsx",
    "admin/src/components/ui/badge.tsx",
]


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    host = os.environ.get("VPS_HOST", "187.55.230.171")
    user = os.environ.get("VPS_USER", "root")
    password = os.environ.get("VPS_PASS")
    if not password:
        print("VPS_PASS is required", file=sys.stderr)
        return 2

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, username=user, password=password, timeout=25)

    def run(cmd: str, timeout: int = 300) -> tuple[int, str, str]:
        stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode("utf-8", "replace")
        err = stderr.read().decode("utf-8", "replace")
        code = stdout.channel.recv_exit_status()
        return code, out, err

    print("=== inspect production ===")
    for cmd in [
        "hostname; date -u",
        f"test -d {REMOTE} && echo REMOTE_OK || echo REMOTE_MISSING",
        f"cd {REMOTE} && (git rev-parse --short HEAD 2>/dev/null || echo NO_GIT); git status -sb 2>/dev/null | head -n 5 || true",
        "systemctl is-active pathplus-backend; systemctl is-active pathplus-admin || true",
        "curl -sS -m 8 -o /tmp/pathplus-health.txt -w '%{http_code}' https://api.pathplus.store/api/health || true; echo; head -c 200 /tmp/pathplus-health.txt; echo",
    ]:
        code, out, err = run(cmd)
        print(f"$ {cmd}\n[{code}]\n{out}")
        if err.strip():
            print("ERR", err[:500])

    stamp = time.strftime("%Y%m%d%H%M%S")
    backup = f"/root/pathplus-backups/admin-posts-reports-{stamp}"
    run(f"mkdir -p {backup}")

    sftp = client.open_sftp()
    for rel in FILES:
        parent = str(Path(rel).parent).replace("\\", "/")
        run(f"mkdir -p {backup}/{parent} {REMOTE}/{parent}")
        run(f"if [ -f {REMOTE}/{rel} ]; then cp -a {REMOTE}/{rel} {backup}/{rel}; fi")
        local_path = LOCAL / rel
        if not local_path.exists():
            print("MISSING_LOCAL", rel)
            continue
        print("upload", rel)
        sftp.put(str(local_path), f"{REMOTE}/{rel}")
    sftp.close()
    print("backup", backup)

    print("=== prefer git sync if available ===")
    code, out, err = run(
        f"cd {REMOTE} && if [ -d .git ]; then git fetch --all --prune 2>&1 | tail -n 20; git rev-parse --short HEAD; else echo NO_GIT; fi"
    )
    print(out)
    if err.strip():
        print("ERR", err[:1000])

    print("=== import check ===")
    code, out, err = run(
        f"""cd {REMOTE} && /root/.bun/bin/bun -e "import './src/admin/services/posts.service.ts'; import './src/admin/services/reports.service.ts'; import './src/lib/moment-feed.ts'; console.log('imports-ok')" """
    )
    print(out)
    if err.strip():
        print("ERR", err[:1500])
    if code != 0:
        print("IMPORT_FAILED", code)
        client.close()
        return code

    print("=== restart backend ===")
    code, out, err = run(
        "systemctl reset-failed pathplus-backend; systemctl restart pathplus-backend; sleep 8; systemctl is-active pathplus-backend"
    )
    print(out)
    if err.strip():
        print("ERR", err[:800])
    if "active" not in out:
        code2, out2, err2 = run("journalctl -u pathplus-backend -n 50 --no-pager")
        print(out2)
        if err2.strip():
            print("ERR", err2[:800])
        client.close()
        return 1

    print("=== rebuild admin dashboard ===")
    code, out, err = run(
        f"""
set -e
cd {REMOTE}/admin
if [ -f bun.lock ]; then /root/.bun/bin/bun install --frozen-lockfile || /root/.bun/bin/bun install; else /root/.bun/bin/bun install; fi
/root/.bun/bin/bun run build
systemctl reset-failed pathplus-admin || true
systemctl restart pathplus-admin
sleep 5
systemctl is-active pathplus-admin || true
""",
        timeout=600,
    )
    print(out[-4000:] if len(out) > 4000 else out)
    if err.strip():
        print("ERR", err[:2000])

    print("=== production verification ===")
    for cmd in [
        "systemctl is-active pathplus-backend; systemctl is-active pathplus-admin || true",
        "curl -sS -m 10 -o /tmp/pathplus-health2.txt -w '%{http_code}' https://api.pathplus.store/api/health; echo; head -c 300 /tmp/pathplus-health2.txt; echo",
        "curl -sS -m 10 -o /tmp/admin-login.txt -w '%{http_code}' https://admin.pathplus.store/login; echo; head -c 120 /tmp/admin-login.txt; echo",
        "curl -sS -m 10 -o /dev/null -w '%{http_code}' https://api.pathplus.store/api/admin/posts; echo",
        f"cd {REMOTE} && /root/.bun/bin/bun -e \"import {{ postsService }} from './src/admin/services/posts.service.ts'; const r = await postsService.list({{ page:1, limit:1, offset:0 }}); console.log('PROD_POSTS', r.total, r.items?.[0]?.id || 'none')\"",
    ]:
        code, out, err = run(cmd, timeout=120)
        print(f"$ {cmd}\n[{code}]\n{out}")
        if err.strip():
            print("ERR", err[:800])

    client.close()
    print("DEPLOY_DONE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
