from __future__ import annotations

"""Deploy per-user chat deletion boundary fix + comment author-only delete.

Requires env VPS_PASS (never hardcode secrets). DB migration 026 is applied
via Supabase separately; this script syncs application code only.
"""

import os
import sys
import time
from pathlib import Path

import paramiko

LOCAL = Path(__file__).resolve().parents[1]
REMOTE = "/root/path-/backend"
FILES = [
    "migrations/025_chat_message_unhide.sql",
    "migrations/026_per_user_chat_deletion_boundary.sql",
    "src/routes/conversations.ts",
    "src/routes/posts.ts",
    "src/lib/unread-counts.ts",
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

    def run(cmd: str, timeout: int = 180) -> tuple[int, str, str]:
        stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode("utf-8", "replace")
        err = stderr.read().decode("utf-8", "replace")
        code = stdout.channel.recv_exit_status()
        return code, out, err

    print("=== inspect production ===")
    for cmd in [
        "hostname; date -u",
        f"test -d {REMOTE} && echo REMOTE_OK || echo REMOTE_MISSING",
        f"cd {REMOTE} && (git rev-parse --short HEAD 2>/dev/null || echo NO_GIT)",
        "systemctl is-active pathplus-backend",
        "curl -sS -m 8 -o /tmp/pathplus-health.txt -w '%{http_code}' https://api.pathplus.store/api/health || true; echo; head -c 240 /tmp/pathplus-health.txt; echo",
    ]:
        code, out, err = run(cmd)
        print(f"$ {cmd}\n[{code}]\n{out}")
        if err.strip():
            print("ERR", err[:500])

    stamp = time.strftime("%Y%m%d%H%M%S")
    backup = f"/root/pathplus-backups/chat-boundary-{stamp}"
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

    print("=== import check ===")
    code, out, err = run(
        f"cd {REMOTE} && /root/.bun/bin/bun -e \"import './src/routes/conversations.ts'; import './src/routes/posts.ts'; import './src/lib/unread-counts.ts'; console.log('imports-ok')\""
    )
    print(out)
    if err.strip():
        print("ERR", err[:1500])
    if code != 0:
        print("IMPORT_FAILED — restoring backup and aborting restart")
        for rel in FILES:
            run(f"if [ -f {backup}/{rel} ]; then cp -a {backup}/{rel} {REMOTE}/{rel}; fi")
        client.close()
        return code

    print("=== restart service ===")
    code, out, err = run(
        "systemctl reset-failed pathplus-backend; systemctl restart pathplus-backend; sleep 7; systemctl is-active pathplus-backend"
    )
    print(out)
    if err.strip():
        print("ERR", err[:1000])
    if code != 0 or "active" not in out:
        print("SERVICE_UNHEALTHY")
        code2, out2, err2 = run("journalctl -u pathplus-backend -n 40 --no-pager")
        print(out2)
        if err2.strip():
            print("ERR", err2[:1000])
        client.close()
        return 1

    print("=== health ===")
    for cmd in [
        "curl -sS -m 8 -o /tmp/pathplus-health.txt -w '%{http_code}' https://api.pathplus.store/api/health || true; echo; head -c 240 /tmp/pathplus-health.txt; echo",
        "journalctl -u pathplus-backend -n 20 --no-pager",
    ]:
        code, out, err = run(cmd)
        print(f"$ {cmd}\n[{code}]\n{out}")
        if err.strip():
            print("ERR", err[:500])

    client.close()
    print("DEPLOY_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
