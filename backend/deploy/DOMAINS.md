# Path+ domains

| Host | URL |
|------|-----|
| **API** | https://api.pathplus.store |
| **Admin** | https://admin.pathplus.store |

Nginx proxies:

- `api.pathplus.store` → `127.0.0.1:3000`
- `admin.pathplus.store` → `127.0.0.1:3001`

## 1. DNS

| Type | Name | Value |
|------|------|--------|
| A | `api` | your VPS public IP |
| A | `admin` | your VPS public IP |

## 2. Apps (PM2)

```bash
cd /path/to/backend
bash deploy/pm2-setup.sh
```

## 3. Nginx + SSL

```bash
sudo bash deploy/nginx-setup.sh
sudo bash deploy/nginx-setup.sh --ssl
```

If you see `conflicting server name "api.pathplus.store"`, remove the old duplicate and reload:

```bash
sudo rm -f /etc/nginx/sites-enabled/pathplus-api
sudo nginx -t && sudo systemctl reload nginx
```

## 4. Check

```bash
curl https://api.pathplus.store/health
# {"status":"ok"}

curl -I https://admin.pathplus.store/
# HTTP 200
```

After SSL, rebuild admin so it uses HTTPS:

```bash
cd admin && bun run build && cd ..
pm2 restart all --update-env && pm2 save
```
