from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import paramiko

LOCAL = Path(__file__).resolve().parents[1]
REMOTE = "/root/path-/backend"
FILES = [
    "src/routes/posts.ts",
    "src/lib/moment-visibility.ts",
    "src/lib/feed-mode.test.ts",
]


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    password = os.environ.get("VPS_PASS")
    if not password:
        print("VPS_PASS is required", file=sys.stderr)
        return 2

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        os.environ.get("VPS_HOST", "187.55.230.171"),
        username=os.environ.get("VPS_USER", "root"),
        password=password,
        timeout=25,
    )

    def run(cmd: str, timeout: int = 180) -> tuple[int, str, str]:
        stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode("utf-8", "replace")
        err = stderr.read().decode("utf-8", "replace")
        return stdout.channel.recv_exit_status(), out, err

    stamp = time.strftime("%Y%m%d%H%M%S")
    backup = f"/root/pathplus-backups/feed-modes-{stamp}"
    run(f"mkdir -p {backup}/src/routes {backup}/src/lib")

    sftp = client.open_sftp()
    for rel in FILES:
        remote = f"{REMOTE}/{rel}"
        run(f"mkdir -p $(dirname {remote})")
        run(f"if [ -f {remote} ]; then cp -a {remote} {backup}/{rel}; fi")
        print("upload", rel)
        sftp.put(str(LOCAL / rel), remote)
    sftp.close()
    print("backup", backup)

    code, out, err = run(
        f"cd {REMOTE} && /root/.bun/bin/bun test src/lib/feed-mode.test.ts src/lib/moment-visibility.test.ts"
    )
    print(out[-2000:] if len(out) > 2000 else out)
    if err.strip():
        print("ERR", err[:1500])
    if code != 0:
        client.close()
        return code

    code, out, err = run(
        "systemctl reset-failed pathplus-backend; systemctl restart pathplus-backend; sleep 8; systemctl is-active pathplus-backend"
    )
    print("backend", out.strip())
    if "active" not in out:
        print(run("journalctl -u pathplus-backend -n 40 --no-pager")[1])
        client.close()
        return 1

    code, out, err = run(
        "curl -sS -m 10 -o /tmp/feed-unauth.txt -w '%{http_code}' 'https://api.pathplus.store/api/posts?mode=private&limit=1'; echo; head -c 160 /tmp/feed-unauth.txt; echo"
    )
    print("unauth_private", out.strip())
    client.close()
    print("DEPLOY_DONE", 0)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
