from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import paramiko

LOCAL = Path(__file__).resolve().parents[1]
REMOTE = "/root/path-/backend"

FILES = [
    "src/admin/services/reports.service.ts",
    "admin/src/app/(console)/reports/[id]/page.tsx",
    "admin/src/app/(console)/reports/page.tsx",
    "admin/src/app/(console)/posts/page.tsx",
    "admin/src/app/(console)/posts/[id]/page.tsx",
]


def ensure_remote_dirs(sftp: paramiko.SFTPClient, remote_dir: str) -> None:
    parts = [p for p in remote_dir.split("/") if p]
    path = ""
    for part in parts:
        path += "/" + part
        try:
            sftp.stat(path)
        except OSError:
            try:
                sftp.mkdir(path)
            except OSError:
                sftp.stat(path)


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

    def run(cmd: str, timeout: int = 600) -> tuple[int, str, str]:
        stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode("utf-8", "replace")
        err = stderr.read().decode("utf-8", "replace")
        return stdout.channel.recv_exit_status(), out, err

    stamp = time.strftime("%Y%m%d%H%M%S")
    backup = f"/root/pathplus-backups/comment-admin-fixes-{stamp}"
    run(f"mkdir -p {backup}")

    sftp = client.open_sftp()
    for rel in FILES:
        parent = str(Path(rel).parent).replace("\\", "/")
        run(f"mkdir -p -- '{backup}/{parent}'")
        ensure_remote_dirs(sftp, f"{REMOTE}/{parent}")
        remote_file = f"{REMOTE}/{rel}"
        run(f"if [ -f '{remote_file}' ]; then cp -a -- '{remote_file}' '{backup}/{rel}'; fi")
        print("upload", rel)
        sftp.put(str(LOCAL / rel), remote_file)
    sftp.close()
    print("backup", backup)

    code, out, err = run(
        f"cd {REMOTE} && /root/.bun/bin/bun -e \"import './src/admin/services/reports.service.ts'; console.log('imports-ok')\""
    )
    print(out)
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
        f"""
set -e
cd {REMOTE}/admin
/root/.bun/bin/bun run build
systemctl reset-failed pathplus-admin || true
systemctl restart pathplus-admin
sleep 5
systemctl is-active pathplus-admin
curl -sS -m 10 -o /dev/null -w '%{{http_code}}' https://admin.pathplus.store/reports; echo
curl -sS -m 10 -o /dev/null -w '%{{http_code}}' https://admin.pathplus.store/posts; echo
"""
    )
    print(out[-4500:] if len(out) > 4500 else out)
    if err.strip():
        print("ERR", err[:2000])
    client.close()
    print("DEPLOY_DONE", code)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
