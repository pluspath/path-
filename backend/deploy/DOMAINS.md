# Path+ domains

| Host | URL | Purpose |
|------|-----|---------|
| **Marketing** | https://www.pathplus.store | App Store marketing site |
| **Support** | https://www.pathplus.store/support | App Store Support URL |
| **Privacy** | https://www.pathplus.store/privacy | App Store Privacy Policy URL |
| **Terms** | https://www.pathplus.store/terms | Terms of Service / EULA |
| **API** | https://api.pathplus.store | Mobile API |
| **Admin** | https://admin.pathplus.store | Control panel |

Nginx proxies:

- `pathplus.store` / `www.pathplus.store` → `127.0.0.1:3000` (marketing + legal pages + API)
- `api.pathplus.store` → `127.0.0.1:3000`
- `admin.pathplus.store` → `127.0.0.1:3001`

## 1. DNS

| Type | Name | Value |
|------|------|--------|
| A | `@` (apex) | your VPS public IP |
| A | `www` | your VPS public IP |
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
# Expand cert to include marketing hosts:
sudo certbot --nginx -d api.pathplus.store -d admin.pathplus.store -d www.pathplus.store -d pathplus.store
```

If you see `conflicting server name "api.pathplus.store"`, remove the old duplicate and reload:

```bash
sudo rm -f /etc/nginx/sites-enabled/pathplus-api
sudo nginx -t && sudo systemctl reload nginx
```

## 4. App Store Connect URLs

Use these in App Store Connect:

- **Marketing URL:** `https://www.pathplus.store`
- **Support URL:** `https://www.pathplus.store/support`
- **Privacy Policy URL:** `https://www.pathplus.store/privacy`

Until DNS/nginx for `www` is live, the same pages are also available on the API host:

- https://api.pathplus.store/
- https://api.pathplus.store/support
- https://api.pathplus.store/privacy
- https://api.pathplus.store/terms

## 5. Check

```bash
curl https://api.pathplus.store/health
# {"status":"ok"}

curl -I https://www.pathplus.store/
# HTTP 200

curl -I https://www.pathplus.store/support
# HTTP 200

curl -I https://admin.pathplus.store/
# HTTP 200
```

After SSL, rebuild admin so it uses HTTPS:

```bash
cd admin && bun run build && cd ..
pm2 restart all --update-env && pm2 save
```
